/**
 * Tool registration for MCP servers.
 *
 * One definition builder and one synchronization algorithm serve every tier:
 * the global (profile) registry, each workspace agent's registry, and the cached
 * catalog exposed while a server needs authentication. The factory receives its
 * collaborators instead of reaching into plugin state, so the module stays free
 * of transports, OAuth and configuration.
 *
 * A definition's `call` resolves the live connection at attempt time. A cached
 * catalog and a live listing therefore produce the same definition shape, and a
 * registration never holds a stale handle: when the connection is gone the call
 * rejects with the error the caller injected.
 */

/**
 * Stable identity of what the model sees for one registration. A definition may
 * be re-registered only when its model-facing shape changes; keeping the
 * signature stable keeps prompt caches warm and avoids transiently removing
 * unrelated tools when a server announces a `tools/list` change.
 * @param definition - tool definition about to be registered.
 * @returns the serialized model-facing shape.
 */
export function registrationSignature(definition) {
  return JSON.stringify({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    deferLoading: definition.deferLoading === true,
  });
}

/**
 * Dispose every registration of one map and empty it.
 * @param registrations - raw name -> registration.
 */
export function disposeRegistrations(registrations) {
  for (const entry of registrations.values()) { try { entry.dispose(); } catch {} }
  registrations.clear();
}

/**
 * Create the registration helpers for one plugin instance.
 *
 * @param options.publicNameOf - maps (server name, raw tool name) to the public model-facing name.
 * @param options.toParameters - converts an MCP input schema to the harness parameter schema.
 * @param options.resultSchema - output schema shared by every MCP tool.
 * @param options.renderResult - renders one MCP result for the conversation.
 * @param options.isConcurrencySafe - classifies one raw tool name for concurrent execution.
 * @param options.imageHandlersFor - builds the image projection handlers for one raw tool name.
 * @param options.decorate - applies the presentation-specific marker (on-demand deferral) to a definition.
 * @returns the definition builder and the synchronization helpers.
 */
export function createToolRegistration({
  publicNameOf,
  toParameters,
  resultSchema,
  renderResult,
  isConcurrencySafe,
  imageHandlersFor,
  decorate = (definition) => definition,
}) {
  /**
   * Build one tool definition from a `tools/list`-shaped entry. Shared by the
   * global tier, the workspace tier and the cached catalog.
   * @param server - configuration row that owns the tool.
   * @param tool - raw listing entry (`name`, `description`, `inputSchema`).
   * @param call - runs the raw `tools/call` for one name and arguments.
   * @returns the definition handed to a tool registry.
   */
  function definitionFor(server, tool, call) {
    const images = imageHandlersFor(tool.name);
    return {
      name: publicNameOf(server.name, tool.name),
      mcpServerName: server.name,
      mcpRawName: tool.name,
      description: `${tool.description ?? ''} [${server.name} MCP]`.slice(0, 2000),
      parameters: toParameters(tool.inputSchema),
      output: { schema: resultSchema, render: renderResult },
      isConcurrencySafe: () => isConcurrencySafe(tool.name),
      async execute(args, exec) {
        const r = await call(tool.name, args ?? {}, exec);
        const content = Array.isArray(r?.content) ? r.content : [];
        const text = content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
        if (r?.isError === true) throw new Error(text || `MCP tool "${tool.name}" failed`);
        const value = { text, content, isError: false };
        await images.prepare(value, exec, args);
        return value;
      },
      finalizeContent: images.finalizeContent,
    };
  }

  /**
   * Re-apply the presentation marker to live registrations after its decision
   * flips: a definition is captured at register time, so the marker has to be
   * re-registered rather than mutated in place.
   * @param registrations - raw name -> registration.
   */
  function retag(registrations) {
    for (const [rawName, entry] of registrations) {
      const next = decorate(entry.base ?? entry.definition);
      if ((next.deferLoading === true) === (entry.definition.deferLoading === true)) continue;
      const registry = entry.registry;
      if (registry === undefined) continue;
      try { entry.dispose(); } catch {}
      entry.definition = next;
      entry.signature = registrationSignature(next);
      entry.dispose = registry.register(next);
      registrations.set(rawName, entry);
    }
  }

  /**
   * Make the registry match `tools`, preserving registrations whose model-facing
   * schema did not change.
   *
   * The whole change is rolled back when a registration throws, so a partially
   * failed sync never leaves a server with half its tools registered.
   *
   * @param registry - tool registry that receives the definitions.
   * @param server - configuration row that owns the tools.
   * @param registrations - raw name -> registration for this server and tier.
   * @param tools - desired raw entries.
   * @param call - runs the raw `tools/call` for one name and arguments.
   * @returns the public names now registered, in listing order.
   */
  function sync(registry, server, registrations, tools, call) {
    const desired = new Map();
    const publicNames = new Set();
    for (const tool of tools) {
      if (!tool || typeof tool.name !== 'string' || !tool.name) throw new Error(`MCP server "${server.name}" returned a tool without a name`);
      if (desired.has(tool.name)) throw new Error(`MCP server "${server.name}" returned duplicate tool "${tool.name}"`);
      const base = definitionFor(server, tool, call);
      const definition = decorate(base);
      if (publicNames.has(definition.name)) throw new Error(`MCP server "${server.name}" returned tools that normalize to duplicate name "${definition.name}"`);
      publicNames.add(definition.name);
      desired.set(tool.name, { definition, base, signature: registrationSignature(definition) });
    }

    const previous = new Map();
    for (const [rawName, current] of registrations) {
      const next = desired.get(rawName);
      if (next && next.signature === current.signature) continue;
      previous.set(rawName, current);
      try { current.dispose(); } catch {}
      registrations.delete(rawName);
    }

    const added = [];
    try {
      for (const [rawName, next] of desired) {
        if (registrations.has(rawName)) continue;
        const entry = { ...next, registry, dispose: registry.register(next.definition) };
        registrations.set(rawName, entry);
        added.push(rawName);
      }
    } catch (error) {
      for (const rawName of added) {
        const entry = registrations.get(rawName);
        try { entry?.dispose(); } catch {}
        registrations.delete(rawName);
      }
      const restoreFailures = [];
      for (const [rawName, entry] of previous) {
        try {
          entry.dispose = registry.register(entry.definition);
          registrations.set(rawName, entry);
        } catch (restoreError) {
          restoreFailures.push(`${rawName}: ${restoreError?.message ?? restoreError}`);
        }
      }
      if (restoreFailures.length > 0) {
        throw new Error(`${error?.message ?? error}; rollback failed for ${restoreFailures.join(', ')}`);
      }
      throw error;
    }
    return [...desired.values()].map((entry) => entry.definition.name);
  }

  return { definitionFor, retag, sync };
}