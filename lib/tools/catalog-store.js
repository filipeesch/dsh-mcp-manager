/**
 * Persistence for the retained tool catalog.
 *
 * The catalog lives in its own file so the credential-bearing state file keeps
 * its size and its lock uncontended: a catalog is written on every successful
 * listing, and losing one only costs a stale tool list, never a session.
 *
 * Writes are atomic (temporary file, fsync, rename) and read-modify-write of a
 * single server key under a lock this module owns, so two processes cannot drop
 * each other's entries. A missing, unreadable or corrupt file reads as empty and
 * is rewritten by the next successful listing.
 */

import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Current on-disk document version. */
export const CATALOG_VERSION = 1;

/** A lock older than this is treated as abandoned by a crashed writer. */
const STALE_LOCK_MS = 10_000;

/**
 * Create the catalog store for one file.
 *
 * @param options.filePath - catalog file path.
 * @param options.logger - logger receiving the one-time unreadable-catalog warning.
 * @param options.now - clock for the `listedAt` stamp, injected for tests.
 * @param options.lockWaitMs - how long a write waits for the lock.
 * @param options.lockStepMs - delay between lock attempts.
 * @returns the reader and the writers.
 */
export function createCatalogStore({ filePath, logger, now = Date.now, lockWaitMs = 2000, lockStepMs = 25 }) {
  const lockPath = `${filePath}.lock`;
  let unreadableReported = false;

  function emptyDocument() {
    return { version: CATALOG_VERSION, servers: {} };
  }

  // Any read failure — missing, unreadable, a path that is not a directory, or a
  // document with the wrong shape — reads as empty. The catalog is an
  // optimization; it must never be able to fail a connection or an HTTP response.
  function reportUnreadable(error) {
    if (unreadableReported) return;
    unreadableReported = true;
    logger?.warn?.(`mcp-manager: ignoring an unreadable tool catalog (${error?.message ?? error})`);
  }

  function readDocument() {
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') reportUnreadable(error);
      return emptyDocument();
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('the document is not an object');
      if (!parsed.servers || typeof parsed.servers !== 'object' || Array.isArray(parsed.servers)) throw new Error('the document has no servers map');
      return { version: CATALOG_VERSION, servers: parsed.servers };
    } catch (error) {
      reportUnreadable(error);
      return emptyDocument();
    }
  }

  function writeAtomically(document) {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.${process.pid}.${randomBytes(12).toString('hex')}.tmp`;
    let fd;
    try {
      fd = openSync(tmp, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify(document, null, 2));
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(tmp, filePath);
    } catch (error) {
      if (fd !== undefined) { try { closeSync(fd); } catch {} }
      try { unlinkSync(tmp); } catch {}
      throw error;
    }
  }

  // Reclaim an abandoned lock without deleting one another writer just created:
  // the lock is renamed away first, so a racing reclaimer loses the rename
  // (ENOENT) instead of unlinking a fresh lock. A live but slow owner keeps its
  // file, because the threshold is far above any write this store performs.
  function reclaimStaleLock() {
    let age;
    try { age = Date.now() - statSync(lockPath).mtimeMs; } catch { return; }
    if (age <= STALE_LOCK_MS) return;
    const abandoned = `${lockPath}.${process.pid}.${randomBytes(6).toString('hex')}.stale`;
    try { renameSync(lockPath, abandoned); } catch { return; }
    try { unlinkSync(abandoned); } catch {}
  }

  function tryLock() {
    // The token makes release conditional: a reclaimer may have taken the file
    // already, and then this owner must not delete the new lock.
    const token = `${process.pid}\n${randomBytes(8).toString('hex')}\n`;
    try {
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
      const fd = openSync(lockPath, 'wx', 0o600);
      try { writeFileSync(fd, token); } finally { closeSync(fd); }
      return () => {
        try { if (readFileSync(lockPath, 'utf8') === token) unlinkSync(lockPath); } catch {}
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      reclaimStaleLock();
      return null;
    }
  }

  async function acquireLock() {
    const deadline = Date.now() + lockWaitMs;
    for (;;) {
      let release;
      try {
        release = tryLock();
      } catch (error) {
        logger?.warn?.(`mcp-manager: could not lock the tool catalog (${error?.message ?? error})`);
        return null;
      }
      if (release) return release;
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => { setTimeout(resolve, lockStepMs); });
    }
  }

  /**
   * Read one server's catalog.
   * @param key - server key (`id:<id>` or the workspace form used by the auth gate).
   * @returns the retained catalog, or null when the server has none.
   */
  function catalogOf(key) {
    const entry = readDocument().servers[key];
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.tools)) return null;
    return {
      name: typeof entry.name === 'string' ? entry.name : '',
      listedAt: typeof entry.listedAt === 'number' ? entry.listedAt : 0,
      tools: entry.tools.filter((tool) => tool && typeof tool === 'object' && typeof tool.name === 'string'),
    };
  }

  /**
   * Replace one server's catalog.
   * @param key - server key.
   * @param value.name - server name, for diagnostics and presentation.
   * @param value.tools - catalog entries.
   * @returns whether the write happened; a lock timeout or a write failure is reported, never thrown.
   */
  async function save(key, { name, tools }) {
    let release;
    try {
      release = await acquireLock();
    } catch (error) {
      logger?.warn?.(`mcp-manager: could not record the tool catalog (${error?.message ?? error})`);
      return false;
    }
    if (!release) {
      logger?.warn?.('mcp-manager: could not record the tool catalog (the file is locked)');
      return false;
    }
    try {
      const document = readDocument();
      document.servers[key] = { name, listedAt: now(), tools: Array.isArray(tools) ? tools : [] };
      writeAtomically(document);
      return true;
    } catch (error) {
      logger?.warn?.(`mcp-manager: could not record the tool catalog (${error?.message ?? error})`);
      return false;
    } finally {
      release();
    }
  }

  /**
   * Discard one server's catalog.
   * @param key - server key.
   * @returns whether the file no longer holds the entry.
   */
  async function remove(key) {
    let release;
    try {
      release = await acquireLock();
    } catch (error) {
      logger?.warn?.(`mcp-manager: could not discard the tool catalog (${error?.message ?? error})`);
      return false;
    }
    if (!release) return false;
    try {
      const document = readDocument();
      if (!Object.hasOwn(document.servers, key)) return true;
      delete document.servers[key];
      writeAtomically(document);
      return true;
    } catch (error) {
      logger?.warn?.(`mcp-manager: could not discard the tool catalog (${error?.message ?? error})`);
      return false;
    } finally {
      release();
    }
  }

  return { catalogOf, save, remove };
}
