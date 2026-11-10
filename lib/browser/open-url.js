/**
 * Opens one URL in the operator's default browser.
 *
 * The harness exposes no public "open a URL" service, so the plugin owns the
 * platform launcher. A launch is always best effort: the URL is returned to the
 * caller either way, and a host reached over SSH must never open a window on the
 * machine running the server.
 */

/** Whether the host was reached over SSH, in which case a browser would open on the wrong machine. */
export function isRemoteSession(env = process.env) {
  return Boolean(env?.SSH_CONNECTION || env?.SSH_TTY);
}

/**
 * The platform launcher for one URL.
 * @param platform - node platform identifier.
 * @param url - absolute authorization URL.
 * @returns the command and its arguments.
 */
export function resolveLauncher(platform, url) {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  // `cmd /c start` would hand the URL to cmd.exe, which reads `&` in a query
  // string as a command separator. rundll32 receives the URL as a plain argument.
  if (platform === 'win32') return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  return { command: 'xdg-open', args: [url] };
}

/**
 * Create the URL opener for one plugin instance.
 *
 * @param options.spawn - child_process spawn, injected for tests.
 * @param options.platform - platform identifier.
 * @param options.env - environment carrying the SSH markers.
 * @param options.logger - logger for a failed launch.
 * @returns an opener reporting whether a browser was actually launched.
 */
export function createUrlOpener({ spawn, platform = process.platform, env = process.env, logger }) {
  return function open(url) {
    if (isRemoteSession(env)) return Promise.resolve({ opened: false, reason: 'remote' });
    const launcher = resolveLauncher(platform, url);
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
      try {
        const child = spawn(launcher.command, launcher.args, { detached: true, stdio: 'ignore' });
        child.once?.('error', (error) => {
          logger?.warn?.(`mcp-manager: could not open the browser (${error?.message ?? error})`);
          settle({ opened: false, reason: String(error?.message ?? error) });
        });
        child.once?.('spawn', () => {
          child.unref?.();
          settle({ opened: true });
        });
      } catch (error) {
        logger?.warn?.(`mcp-manager: could not open the browser (${error?.message ?? error})`);
        settle({ opened: false, reason: String(error?.message ?? error) });
      }
    });
  };
}
