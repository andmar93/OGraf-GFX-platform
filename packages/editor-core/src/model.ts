/**
 * Editor project model. A project is a tree of layers on a 1920x1080 artboard plus data fields.
 * The same JSON drives the editor canvas and the exported graphic (see runtime.ts).
 */
export const PROJECT_FORMAT = 2;

export type FieldType = 'string' | 'multiline' | 'number' | 'integer' | 'boolean' | 'color' | 'image' | 'clock';

/** A data field of the graphic (becomes a property of the OGraf GDD schema). */
export interface Field {
  key: string;
  label: string;
  type: FieldType;
  default?: string | number | boolean;
  /** Default data path binding for new rundown items (v_ogp_bind), e.g. "match.home.score" */
  bind?: string;
  /** Exclude from the item label in the player (GDD "hidden") */
  hidden?: boolean;
}

/** Animatable properties. Mask values are insets in % from each edge (0 = nothing cropped). */
export type Prop = 'x' | 'y' | 'scale' | 'opacity' | 'rotation' | 'maskL' | 'maskR' | 'maskT' | 'maskB';
export const PROPS: Prop[] = ['x', 'y', 'scale', 'opacity', 'rotation', 'maskL', 'maskR', 'maskT', 'maskB'];

/** Easing of the segment from a keyframe to the next one. */
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'smooth' | 'back' | 'hold';

export interface Keyframe {
  id: string;
  /** ms on the timeline */
  t: number;
  v: number;
  ease: Easing;
}

/** Preset types for generating in/out keyframes (and the format-1 animation presets). */
export type AnimType =
  | 'none' | 'fade' | 'scale' | 'pop'
  | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'
  | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'wipe-down';

/** Format-1 per-layer animation preset (migrated to keyframes). */
export interface AnimPreset {
  type: AnimType;
  duration: number;
  delay: number;
  easing: 'ease-out' | 'ease-in' | 'ease-in-out' | 'linear' | 'smooth' | 'back';
  distance: number;
}

/**
 * The graphic's timeline. `steps` are the times where playback pauses (step 0 = after the take, ...);
 * Out plays from `out` to `duration`.
 */
export interface Timeline {
  duration: number;
  steps: number[];
  out: number;
}

export interface LayerBase {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** 0–1 */
  opacity: number;
  /** uniform scale around the centre, 1 = 100 % */
  scale: number;
  /** crop insets in % */
  maskL: number;
  maskR: number;
  maskT: number;
  maskB: number;
  visible: boolean;
  locked: boolean;
  /** Property bindings to fields: fill/color (color field), src (image field), visible (boolean field) */
  bindings: Partial<Record<'fill' | 'color' | 'src' | 'visible', string>>;
  /** Keyframes per animated property; a property without keyframes uses its static value. */
  tracks: Partial<Record<Prop, Keyframe[]>>;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  /** Text with {field} placeholders */
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  uppercase: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  letterSpacing: number;
  lineHeight: number;
  /** Shrink the font to fit the box width */
  shrinkToFit: boolean;
  shadow: boolean;
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: 'rect' | 'ellipse';
  fill: string;
  /** Optional second colour: linear gradient fill → fill2 */
  fill2: string | null;
  gradientAngle: number;
  radius: number;
  strokeColor: string;
  strokeWidth: number;
  shadow: boolean;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  src: string;
  fit: 'contain' | 'cover' | 'fill';
}

export interface GroupLayer extends LayerBase {
  type: 'group';
  /** Positions of children are relative to the group */
  children: Layer[];
  /** Clip children to the group box */
  clip: boolean;
}

export type Layer = TextLayer | ShapeLayer | ImageLayer | GroupLayer;
export type LayerType = Layer['type'];

export interface Project {
  format: typeof PROJECT_FORMAT;
  id: string;
  name: string;
  /** OGraf graphic id of the export */
  graphicId: string;
  description: string;
  width: number;
  height: number;
  /** v_ogp_defaultLayer of the export */
  defaultLayer: number;
  fields: Field[];
  /** Bottom-most first (later = on top) */
  layers: Layer[];
  timeline: Timeline;
  /** Incremented on every publish (manifest version) */
  revision: number;
}

// ---------------------------------------------------------------- factories

let counter = 0;
export function newId(prefix = 'l'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function base(name: string, x: number, y: number, width: number, height: number): LayerBase {
  return {
    id: newId(), name, x, y, width, height, rotation: 0, opacity: 1, scale: 1, maskL: 0, maskR: 0, maskT: 0, maskB: 0,
    visible: true, locked: false, bindings: {}, tracks: {},
  };
}

export const defaultTimeline = (): Timeline => ({ duration: 2000, steps: [800], out: 800 });

export function createLayer(type: LayerType, at: { x: number; y: number } = { x: 760, y: 440 }): Layer {
  switch (type) {
    case 'text':
      return {
        ...base('Text', at.x, at.y, 600, 90), type: 'text', text: 'Text', fontFamily: 'Inter, "Segoe UI", Roboto, Arial, sans-serif',
        fontSize: 56, fontWeight: 800, italic: false, uppercase: true, color: '#ffffff', align: 'left', vAlign: 'middle',
        letterSpacing: 0, lineHeight: 1.1, shrinkToFit: true, shadow: false,
      };
    case 'shape':
      return {
        ...base('Rectangle', at.x, at.y, 600, 120), type: 'shape', shape: 'rect', fill: '#0b1230', fill2: null, gradientAngle: 90,
        radius: 0, strokeColor: '#ffffff', strokeWidth: 0, shadow: true,
      };
    case 'image':
      return { ...base('Image', at.x, at.y, 200, 200), type: 'image', src: '', fit: 'contain' };
    case 'group':
      return { ...base('Group', at.x, at.y, 600, 200), type: 'group', children: [], clip: false };
  }
}

export function createProject(name = 'New graphic'): Project {
  const id = newId('p');
  const slug = slugify(name) || 'graphic';
  const bg: ShapeLayer = { ...(createLayer('shape', { x: 150, y: 830 }) as ShapeLayer), name: 'Background', width: 760, height: 132, fill: '#0b1230', fill2: '#18245a' };
  const accent: ShapeLayer = { ...(createLayer('shape', { x: 150, y: 830 }) as ShapeLayer), name: 'Accent', width: 10, height: 132, fill: '#00d1ff', shadow: false };
  const title: TextLayer = { ...(createLayer('text', { x: 190, y: 842 }) as TextLayer), name: 'Title', text: '{title}', width: 680, height: 66, fontSize: 52 };
  const sub: TextLayer = { ...(createLayer('text', { x: 190, y: 906 }) as TextLayer), name: 'Subtitle', text: '{subtitle}', width: 680, height: 44, fontSize: 28, fontWeight: 600, color: '#9ecbff' };
  // In: wipe the background, grow the accent, slide the texts in; Out: fade everything.
  bg.tracks = { maskR: [kf(0, 100, 'smooth'), kf(500, 0, 'smooth')], opacity: [kf(800, 1, 'ease-in'), kf(1200, 0, 'linear')] };
  accent.tracks = { maskT: [kf(0, 100, 'smooth'), kf(400, 0, 'smooth')], opacity: [kf(800, 1, 'ease-in'), kf(1200, 0, 'linear')] };
  title.tracks = {
    x: [kf(180, 150, 'smooth'), kf(680, 190, 'smooth')],
    opacity: [kf(180, 0, 'smooth'), kf(680, 1, 'smooth'), kf(800, 1, 'ease-in'), kf(1200, 0, 'linear')],
  };
  sub.tracks = {
    x: [kf(280, 150, 'smooth'), kf(780, 190, 'smooth')],
    opacity: [kf(280, 0, 'smooth'), kf(780, 1, 'smooth'), kf(800, 1, 'ease-in'), kf(1200, 0, 'linear')],
  };
  return {
    format: PROJECT_FORMAT, id, name, graphicId: `user.${slug}`, description: '', width: 1920, height: 1080, defaultLayer: 20, revision: 0,
    fields: [
      { key: 'title', label: 'Title', type: 'string', default: 'Name Surname' },
      { key: 'subtitle', label: 'Subtitle', type: 'string', default: 'Role' },
    ],
    layers: [bg, accent, title, sub],
    timeline: { duration: 1200, steps: [800], out: 800 },
  };
}

/** Keyframe factory. */
export function kf(t: number, v: number, ease: Easing = 'smooth'): Keyframe {
  return { id: newId('k'), t, v, ease };
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

// ---------------------------------------------------------------- tree helpers (immutable)

export function walk(layers: Layer[], fn: (l: Layer, parent: GroupLayer | null) => void, parent: GroupLayer | null = null): void {
  for (const l of layers) {
    fn(l, parent);
    if (l.type === 'group') walk(l.children, fn, l);
  }
}

export function findLayer(layers: Layer[], id: string): Layer | undefined {
  let found: Layer | undefined;
  walk(layers, (l) => {
    if (l.id === id) found = l;
  });
  return found;
}

/** Path of ancestors (outermost first) of a layer, excluding the layer itself. */
export function ancestors(layers: Layer[], id: string): GroupLayer[] {
  const rec = (list: Layer[], trail: GroupLayer[]): GroupLayer[] | undefined => {
    for (const l of list) {
      if (l.id === id) return trail;
      if (l.type === 'group') {
        const r = rec(l.children, [...trail, l]);
        if (r) return r;
      }
    }
    return undefined;
  };
  return rec(layers, []) ?? [];
}

/** Absolute artboard position of a layer (sum of group offsets; group rotation is ignored for editing). */
export function absolutePosition(layers: Layer[], id: string): { x: number; y: number } {
  const l = findLayer(layers, id);
  if (!l) return { x: 0, y: 0 };
  return ancestors(layers, id).reduce((p, g) => ({ x: p.x + g.x, y: p.y + g.y }), { x: l.x, y: l.y });
}

export function updateLayer(layers: Layer[], id: string, patch: Partial<Layer> | ((l: Layer) => Layer)): Layer[] {
  return layers.map((l) => {
    if (l.id === id) return typeof patch === 'function' ? patch(l) : ({ ...l, ...patch } as Layer);
    if (l.type === 'group') return { ...l, children: updateLayer(l.children, id, patch) };
    return l;
  });
}

export function removeLayer(layers: Layer[], id: string): Layer[] {
  return layers.filter((l) => l.id !== id).map((l) => (l.type === 'group' ? { ...l, children: removeLayer(l.children, id) } : l));
}

/** Inserts a layer above `aboveId` in the same parent (or on top of the root). */
export function insertLayer(layers: Layer[], layer: Layer, aboveId?: string | null, intoGroupId?: string | null): Layer[] {
  if (intoGroupId) return updateLayer(layers, intoGroupId, (g) => (g.type === 'group' ? { ...g, children: [...g.children, layer] } : g));
  if (!aboveId) return [...layers, layer];
  const rec = (list: Layer[]): Layer[] | undefined => {
    const i = list.findIndex((l) => l.id === aboveId);
    if (i >= 0) return [...list.slice(0, i + 1), layer, ...list.slice(i + 1)];
    for (let j = 0; j < list.length; j++) {
      const g = list[j]!;
      if (g.type === 'group') {
        const r = rec(g.children);
        if (r) return list.map((x, k) => (k === j ? { ...g, children: r } : x));
      }
    }
    return undefined;
  };
  return rec(layers) ?? [...layers, layer];
}

/** Moves a layer one step up (towards the top / later in its list) or down within its parent. */
export function moveLayer(layers: Layer[], id: string, dir: 1 | -1): Layer[] {
  const rec = (list: Layer[]): Layer[] => {
    const i = list.findIndex((l) => l.id === id);
    if (i >= 0) {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    }
    return list.map((l) => (l.type === 'group' ? { ...l, children: rec(l.children) } : l));
  };
  return rec(layers);
}

/** Deep copy with new ids, offset a little. */
export function cloneLayer(l: Layer, offset = 20): Layer {
  const c = structuredClone(l);
  const renew = (x: Layer) => {
    x.id = newId();
    for (const track of Object.values(x.tracks ?? {})) track?.forEach((k) => { k.id = newId('k'); });
    if (x.type === 'group') x.children.forEach(renew);
  };
  renew(c);
  c.x += offset;
  c.y += offset;
  c.name = `${l.name} copy`;
  return c;
}

/** Field keys referenced by a template: "{homeCode} {homeScore}" -> ["homeCode", "homeScore"] */
export function templateFields(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)(?::[a-z0-9]+)?\}/g)].map((m) => m[1]!);
}

/** All field keys used by layers (templates + bindings). */
export function usedFields(project: Project): Set<string> {
  const used = new Set<string>();
  walk(project.layers, (l) => {
    if (l.type === 'text') templateFields(l.text).forEach((k) => used.add(k));
    Object.values(l.bindings).forEach((k) => k && used.add(k));
  });
  return used;
}

/** Duration (ms) of the in animation (to the first step) or the out animation. */
export function animDuration(project: Project, which: 'in' | 'out'): number {
  const tl = project.timeline;
  return which === 'in' ? (tl.steps[0] ?? 0) : Math.max(0, tl.duration - tl.out);
}
