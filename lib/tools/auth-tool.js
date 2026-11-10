/**
 * The model-facing tool that starts a browser authorization for one configured
 * MCP server.
 *
 * It is a normal plugin tool, not an \`mcp__<server>__\` tool: the broker and the
 * direct-call guard only act on MCP names, so this one stays callable while the
 * broker is enabled. Every effect is delegated to injected ports, which keeps the
 * definition free of plugin state.
 */

/**
 * Create the definition of \`mcp_authenticate_server\`.
 *
 * @param options.resolveServer - maps (name, exec) to the configured server in the caller's scope, or null.
 * @param options.isDisabled - whether a server is switched off, in the caller's scope when the switch is per workspace.
 * @param options.canAuthorize - whether a server can be authorized through the browser.
 * @param options.pendingUrl - the URL of an authorization already running for that server, if any.
 * @param options.startAuthorization - starts a flow and resolves its authorization URL.
 * @param options.openUrl - opens a URL in the default browser, best effort.
 * @returns the tool definition.
 */
export function createAuthTool({ resolveServer, isDisabled, canAuthorize, pendingUrl, startAuthorization, openUrl }) {
  return {
    name: 'mcp_authenticate_server',
    description: 'Start a browser authorization for one configured MCP server and return the URL to finish it. Use it when an MCP tool reports that its server is not authenticated, then call the tool you wanted again.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        server: { type: 'string', description: 'Name of the configured MCP server to authorize.' },
      },
      required: ['server'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const requested = String(args?.server ?? '').trim();
      if (!requested) throw new Error('mcp_authenticate_server requires the name of a configured MCP server');
      const server = resolveServer(requested, exec);
      if (!server) {
        throw new Error(`No MCP server named "${requested}" is configured for this conversation.`);
      }
      if (isDisabled(server, exec)) {
        throw new Error(`MCP server "${server.name}" is disabled; enable it in Settings → MCP before authorizing it.`);
      }
      if (!canAuthorize(server)) {
        const kind = (server.type ?? 'http') === 'stdio' ? 'a local stdio server' : 'configured with a static token';
        throw new Error(`MCP server "${server.name}" cannot be authorized through the browser because it is ${kind}. Update it in Settings → MCP instead.`);
      }
      const running = pendingUrl(server);
      if (running) {
        // The URL is returned even for a running flow: the operator may have
        // closed the tab, and the model has no other way to hand it over.
        return { text: `An authorization for "${server.name}" is already in progress. Finish it in the browser, then call the tool you wanted again: ${running}` };
      }
      const url = await startAuthorization(server);
      const opened = await openUrl(url);
      return {
        text: opened?.opened
          ? `Authorization started for "${server.name}". A browser window was opened; finish the login there, then call the tool you wanted again: ${url}`
          : `Authorization started for "${server.name}". Open this URL to finish the login, then call the tool you wanted again: ${url}`,
      };
    },
  };
}
