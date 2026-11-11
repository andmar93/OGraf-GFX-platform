/**
 * Project -> OGraf package files (manifest + self-contained module + assets) and back.
 */
import { validateManifest, type ValidationIssue } from '@ogp/ograf-core';
import { animDuration, PROJECT_FORMAT, slugify, walk, type Layer, type Project } from './model.ts';
import { RUNTIME_SOURCE, PROJECT_PLACEHOLDER } from './runtime.ts';
import { projectSchema } from './schema.ts';

export const OGRAF_SCHEMA = 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json';
export const MODULE_FILE = 'graphic.mjs';

/** Server asset URLs (/assets/…) used by image layers. */
export function assetUrls(project: Project): string[] {
  const urls = new Set<string>();
  walk(project.layers, (l) => {
    if (l.type === 'image' && l.src.startsWith('/assets/')) urls.add(l.src);
  });
  return [...urls];
}

/** Package-relative path for a server asset URL. */
export const assetPath = (url: string) => `assets/${url.split('/').pop()}`;

/** Copy of the project with image sources rewritten (e.g. server URLs -> package paths). */
export function mapImageSources(project: Project, map: (src: string) => string): Project {
  const p = structuredClone(project);
  const rec = (layers: Layer[]) => layers.forEach((l) => {
    if (l.type === 'image') l.src = map(l.src);
    if (l.type === 'group') rec(l.children);
  });
  rec(p.layers);
  return p;
}

/** The graphic's JavaScript module for a project. */
export function generateModule(project: Project): string {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  // safe to embed in a JS source file
  const json = JSON.stringify(project).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
  return RUNTIME_SOURCE.replace(PROJECT_PLACEHOLDER, () => json);
}

export function manifestFileName(project: Project): string {
  return `${slugify(project.graphicId.split('.').pop() ?? project.name) || 'graphic'}.ograf.json`;
}

export function generateManifest(project: Project): Record<string, unknown> {
  const inMs = animDuration(project, 'in');
  const outMs = animDuration(project, 'out');
  return {
    $schema: OGRAF_SCHEMA,
    id: project.graphicId,
    version: String(project.revision || 1),
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    author: { name: 'OGraf GFX Platform editor' },
    main: MODULE_FILE,
    supportsRealTime: true,
    supportsNonRealTime: false,
    stepCount: 1,
    schema: projectSchema(project),
    actionDurations: [
      { type: 'playAction', duration: inMs },
      { type: 'stopAction', duration: outMs },
      { type: 'updateAction', duration: 0 },
    ],
    renderRequirements: [{ resolution: { width: { ideal: project.width }, height: { ideal: project.height } } }],
    v_ogp_defaultLayer: project.defaultLayer,
    // the project itself, so the package can be opened in the editor again
    v_ogp_editor: { format: PROJECT_FORMAT, project },
  };
}

export interface ExportResult {
  files: Record<string, Uint8Array>;
  manifest: Record<string, unknown>;
  errors: ValidationIssue[];
}

/**
 * Builds the package files. `fetchAsset` loads server assets (/assets/…) so they are bundled into the package.
 */
export async function exportPackage(project: Project, fetchAsset: (url: string) => Promise<Uint8Array>): Promise<ExportResult> {
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  for (const url of assetUrls(project)) files[assetPath(url)] = await fetchAsset(url);
  const packaged = mapImageSources(project, (src) => (src.startsWith('/assets/') ? assetPath(src) : src));
  const manifest = generateManifest(packaged);
  files[manifestFileName(project)] = enc.encode(JSON.stringify(manifest, null, 2));
  files[MODULE_FILE] = enc.encode(generateModule(packaged));
  const v = validateManifest(manifest, { fileName: manifestFileName(project) });
  return { files, manifest, errors: v.errors };
}

/**
 * Reads an editor project from package files (manifest with v_ogp_editor). `uploadAsset` stores bundled
 * images on the server and returns their URL.
 */
export async function importPackage(files: Record<string, Uint8Array>, uploadAsset: (path: string, data: Uint8Array) => Promise<string>): Promise<Project> {
  const dec = new TextDecoder();
  const manifestPath = Object.keys(files).find((p) => p.endsWith('.ograf.json'));
  if (!manifestPath) throw new Error('no .ograf.json manifest in the package');
  const manifest = JSON.parse(dec.decode(files[manifestPath]!)) as Record<string, unknown>;
  const ed = manifest.v_ogp_editor as { format?: number; project?: Project } | undefined;
  if (!ed?.project) throw new Error('this package was not made with the editor (no v_ogp_editor project)');
  const base = manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1) : '';
  const uploaded = new Map<string, string>();
  for (const src of collectSources(ed.project)) {
    if (src.startsWith('assets/') && files[base + src]) uploaded.set(src, await uploadAsset(src, files[base + src]!));
  }
  return normaliseProject(mapImageSources(ed.project, (src) => uploaded.get(src) ?? src));
}

function collectSources(project: Project): string[] {
  const out: string[] = [];
  walk(project.layers, (l) => {
    if (l.type === 'image' && l.src) out.push(l.src);
  });
  return out;
}

/** Fills in defaults for projects from older/partial JSON. */
export function normaliseProject(p: Partial<Project> & { layers?: Layer[] }): Project {
  return {
    format: PROJECT_FORMAT,
    id: p.id ?? `p${Date.now().toString(36)}`,
    name: p.name ?? 'Imported graphic',
    graphicId: p.graphicId ?? `user.${slugify(p.name ?? 'graphic') || 'graphic'}`,
    description: p.description ?? '',
    width: p.width ?? 1920,
    height: p.height ?? 1080,
    defaultLayer: p.defaultLayer ?? 20,
    fields: Array.isArray(p.fields) ? p.fields : [],
    layers: Array.isArray(p.layers) ? p.layers : [],
    revision: p.revision ?? 0,
  };
}
