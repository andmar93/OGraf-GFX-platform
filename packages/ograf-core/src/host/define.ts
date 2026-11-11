/**
 * Loading a Graphic module and registering its Web Component.
 */

/** Imports a Graphic's main module (an ES module whose default export is the element class). */
export async function importGraphicModule(url: string): Promise<CustomElementConstructor> {
  const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
  const ctor = mod.default;
  if (typeof ctor !== 'function') {
    throw new Error(`Graphic module ${url} has no default export class (OGraf requires "export default class extends HTMLElement")`);
  }
  return ctor as CustomElementConstructor;
}

/** Converts any string into a valid custom element name fragment. */
export function toTagFragment(input: string): string {
  const s = input.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  return s || 'graphic';
}

let counter = 0;

/**
 * Registers the Graphic class under a unique tag name in the given registry and returns the tag.
 * A constructor can only be defined once per registry, so an already-used class is subclassed.
 */
export function defineGraphicElement(ctor: CustomElementConstructor, key: string, registry: CustomElementRegistry = customElements): string {
  const existing = registry.getName?.(ctor);
  if (existing) return existing;
  let tag = `ograf-${toTagFragment(key)}`;
  while (registry.get(tag)) tag = `ograf-${toTagFragment(key)}-${++counter}`;
  try {
    registry.define(tag, ctor);
  } catch {
    // e.g. "this constructor has already been used with this registry"
    registry.define(tag, class extends (ctor as unknown as typeof HTMLElement) {} as CustomElementConstructor);
  }
  return tag;
}
