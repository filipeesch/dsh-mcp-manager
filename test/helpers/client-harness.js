/**
 * Runs the real `lib/client.js` module factory inside a `node:vm` sandbox with a
 * tiny React stub and a recording locale/slot harness. No browser, no bundles.
 *
 * The harness renders component functions directly. It does not model React's
 * dependency arrays: effects queue once at mount and `effects()` runs them, so a
 * component must be renderable from plain props for a test to inspect it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

export const clientSource = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8');

export function mountClient(fetch, language = 'en', globals = {}) {
  let dictionaries, spec, disposed = false;
  const effectLabels = [];
  const t = (key, values = {}) => (dictionaries[language]?.[key] ?? dictionaries.en[key] ?? key)
    .replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
  let exported, Section;
  const registrations = [];
  let states = [], cursor = 0, effects = [], cleanups = [], initialized = false;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial) => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      // Match React: a function argument is an updater over the current value.
      return [states[index], (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
      }];
    },
    useEffect: (effect) => { if (!initialized) effects.push(effect); },
    useCallback: (callback) => callback,
  };
  runInNewContext(clientSource, {
    fetch,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    ...globals,
    // `window` is always the module-loader carrier; test extras (open, …)
    // merge onto it instead of replacing it.
    window: {
      __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react); } },
      ...(globals.window ?? {}),
    },
  });
  let dispose;
  exported.apply({
    effect(fn, label) { effectLabels.push(label); dispose = fn(); },
    locale: {
      register(ns, table) {
        assert.equal(ns, 'mcp');
        dictionaries = table;
        return () => { disposed = true; };
      },
      bind(ns) { assert.equal(ns, 'mcp'); return t; },
    },
    slots: {
      inject: (_name, cb) => cb(),
      register: (options, component) => {
        registrations.push({ options, component });
        // Keep `spec`/`render()` pointing at the settings section for the
        // existing suites; the banner is rendered through `slot()`.
        if (options?.name === 'settings.section' || Section === undefined) { spec = options; Section = component; }
      },
    },
  });
  return {
    get dictionaries() { return dictionaries; },
    get t() { return t; },
    get spec() { return spec; },
    get registrations() { return registrations; },
    slot(name) { return registrations.find((entry) => entry.options?.name === name)?.component; },
    slotOptions(name) { return registrations.find((entry) => entry.options?.name === name)?.options; },
    get inject() { return exported.inject; },
    effectLabels,
    dispose() { dispose(); assert.equal(disposed, true); },
    setLocale(next) { language = next; },
    render(component = Section, props = { t }) {
      cursor = 0;
      return component(props);
    },
    effects() {
      initialized = true;
      for (const effect of effects) {
        const cleanup = effect();
        if (typeof cleanup === 'function') cleanups.push(cleanup);
      }
      effects = [];
    },
    /** Run every effect cleanup recorded since mount (React unmount equivalent). */
    unmount() { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); },
    reset() { states = []; },
  };
}

export const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
export const settle = () => new Promise((resolve) => setImmediate(resolve));
export function nodes(tree) {
  return tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
}
export const text = (tree) => typeof tree === 'string' ? tree : tree?.children?.map(text).join(' ') ?? '';
export const content = (tree) => nodes(tree).find((node) => typeof node.type === 'function');
