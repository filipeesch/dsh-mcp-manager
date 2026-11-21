// In-process acceptance probe for the disposable-profile run.
//
// Patched in beside the real plugin, this module drives the plugin the way the
// application does: it calls the registered MCP tools and reads the HTTP API,
// then writes one JSON report. Nothing here reaches a model.
//
// Phases, released by the runner through control files:
//   ready  -> the plugin registered its tools
//   go     -> the transport session is invalidated; make the repaired call
//   go2    -> the credential is revoked; park a real authentication wait
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const name = 'mm-auth-experience-probe';
export const inject = ['tools'];

/** The names the host actually registered, through the public tool service. */
function toolNames(ctx) {
  try {
    return ctx.tools.definitions().map((definition) => String(definition.name)).sort();
  } catch {
    return [];
  }
}

/** Read the waiters the way the banner and the alert do. */
async function attention(base, cookie) {
  try {
    const response = await fetch(`${base}/mcp-manager/api/attention`, { headers: { cookie } });
    if (!response.ok) return { ok: false, status: response.status };
    const body = await response.json();
    return { ok: true, items: Array.isArray(body.items) ? body.items : [] };
  } catch (error) {
    return { ok: false, error: String(error && error.message) };
  }
}

/** Call one registered tool and capture exactly what the caller observes. */
async function callTool(ctx, name, args, sessionId) {
  const entry = { tool: name, sessionId };
  const definition = ctx.tools.get(name);
  if (!definition) {
    entry.ok = false;
    entry.error = 'not registered';
    return entry;
  }
  try {
    const result = await definition.execute(args, { agent: { id: sessionId } });
    entry.ok = true;
    entry.result = typeof result === 'string' ? result.slice(0, 300) : 'ok';
  } catch (error) {
    entry.ok = false;
    entry.error = String(error && error.message ? error.message : error);
    entry.name = String(error && error.name ? error.name : '');
  }
  return entry;
}

export function apply(ctx) {
  const reportPath = process.env.MM_PROBE_REPORT;
  const originFile = process.env.MM_PROBE_ORIGIN_FILE;
  const cookieFile = process.env.MM_PROBE_COOKIE_FILE;
  const readyFile = process.env.MM_PROBE_READY;
  const goFile = process.env.MM_PROBE_GO;
  const go2File = process.env.MM_PROBE_GO2;
  if (!reportPath) return;

  const read = (file) => {
    try { return readFileSync(file, 'utf8').trim(); } catch { return ''; }
  };
  const waitFor = async (file) => {
    const deadline = Date.now() + 150000;
    while (!existsSync(file) && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 100));
    }
    return existsSync(file);
  };

  const run = async () => {
    const report = {
      ok: true,
      mcpTools: toolNames(ctx).filter((entry) => entry.startsWith('mcp__')),
      toolApiKeys: Object.keys(ctx.tools).sort(),
      calls: [],
    };
    const write = () => {
      try {
        writeFileSync(reportPath, JSON.stringify(report));
      } catch (error) {
        writeFileSync(reportPath, JSON.stringify({ ok: false, error: String(error && error.message) }));
      }
    };

    // Phase A: the transport session was invalidated; the call must still work.
    if (!(await waitFor(goFile))) {
      report.ok = false;
      report.error = 'phase A never released';
      write();
      return;
    }
    report.afterInvalidation = await callTool(ctx, 'mcp__database__echo', { ping: 'after-invalidation' }, 'session-a');
    const base = read(originFile);
    const cookie = read(cookieFile);
    report.attentionAfterRepair = base && cookie ? await attention(base, cookie) : { ok: false, error: 'no handoff' };
    // Publish phase A now: the runner asserts on it before releasing phase B.
    write();

    // Phase B: the credential is revoked, so the next call parks for authorization.
    if (!(await waitFor(go2File))) {
      report.ok = false;
      report.error = 'phase B never released';
      write();
      return;
    }
    // Deliberately not awaited: this is the wait the surfaces report.
    const parked = ctx.tools.get('mcp__blocked__echo');
    if (!parked) {
      report.ok = false;
      report.error = 'mcp__blocked__echo is not registered';
      write();
      return;
    }
    parked.execute({ ping: 'parked' }, { agent: { id: 'session-a' } }).catch(() => {});

    // Give the gate a moment to publish the waiter, then report it.
    await new Promise((done) => setTimeout(done, 750));
    report.attentionParked = await attention(base, cookie);
    write();
  };

  const t0 = Date.now();
  const tick = () => {
    const ready = toolNames(ctx).some((entry) => entry.startsWith('mcp__'));
    if (!ready && Date.now() - t0 < 90000) {
      setTimeout(tick, 250);
      return;
    }
    try { writeFileSync(readyFile, ready ? 'ready' : 'not-ready'); } catch { /* the runner times out */ }
    run().catch((error) => {
      try { writeFileSync(reportPath, JSON.stringify({ ok: false, error: String(error && error.message) })); } catch {}
    });
  };
  setTimeout(tick, 250);
}
