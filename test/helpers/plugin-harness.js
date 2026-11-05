/**
 * Mounts the real host half with a stubbed Cordis context, so tests can drive
 * the HTTP API and execute registered tools without a DSH installation.
 *
 * The caller imports `lib/index.js` after pointing HOME/USERPROFILE/DSH_HOME at
 * a scratch directory and passes the module in: the state path is resolved at
 * import time.
 */
import assert from 'node:assert/strict';

export function mountPlugin(mod, { config = {}, workspacePaths = [] } = {}) {
  let handler;
  const cleanup = [];
  const globalTools = new Map();
  const agents = [];
  const effect = (fn) => {
    const dispose = fn();
    if (typeof dispose === 'function') cleanup.push(dispose);
    return () => {};
  };
  const registryFor = (tools) => ({
    register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name); },
    guard: () => () => {},
    restrict: () => () => {},
    schemas: () => [],
    get: (name) => tools.get(name),
    execute: async () => ({}),
  });
  const agentsRegistry = {
    create(options) {
      const tools = new Map();
      const agent = {
        id: options.sessionId ?? `agent-${agents.length + 1}`,
        session: { header: { cwd: options.cwd } },
        ctx: { tools: registryFor(tools) },
      };
      const record = { agent, tools, cwd: options.cwd };
      agents.push(record);
      const ready = Promise.resolve(options.setup({ effect }, agent));
      return { agent, ready, dispose() {} };
    },
    resume(options) { return this.create(options); },
  };
  const webServer = { register: (route) => { handler = route.handler; return () => { handler = undefined; }; } };
  mod.apply({
    logger: { info() {}, warn() {}, error() {} },
    tools: registryFor(globalTools),
    get: (name) => (name === 'workspaceRegistry' && workspacePaths.length
      ? { list: () => workspacePaths.map((path) => ({ path })) }
      : undefined),
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback !== 'function') return { dispose: () => {} };
      if (names.includes('webServer')) callback({ webServer, get: () => undefined, effect });
      if (names.includes('agents')) callback({ agents: agentsRegistry, get: () => undefined, effect });
      return { dispose: () => {} };
    },
    effect,
  }, config);
  const request = async (method, path, body) => {
    assert.ok(handler, 'the host must have mounted its web route');
    const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    let status;
    let value;
    await handler(
      {
        method,
        url: `/mcp-manager/api${path}`,
        headers: { host: '127.0.0.1:3080' },
        async *[Symbol.asyncIterator]() { for (const chunk of payload) yield chunk; },
      },
      {
        writeHead(code) { status = code; },
        end(data) { value = data ? JSON.parse(data) : undefined; },
      },
    );
    return { status, ...value };
  };
  const dispose = async () => {
    for (const fn of cleanup.splice(0).reverse()) {
      try { await fn(); } catch {}
    }
  };
  return {
    request,
    globalTools,
    agents,
    tool(name) { return globalTools.get(name); },
    /**
     * Open a workspace agent, which installs that workspace's MCP servers and
     * registers their tools on the agent scope.
     * @param cwd - workspace root.
     * @returns the agent record with its own tool map.
     */
    async createAgent(cwd) {
      const before = agents.length;
      const handle = agentsRegistry.create({ cwd, setup() {} });
      await handle.ready;
      return agents[before];
    },
    dispose,
  };
}
