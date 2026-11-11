/**
 * Reads an OGraf package (a set of files, e.g. from a zip or a folder) and finds all Graphics in it.
 * Pure function: no file system access, so it runs in Node and in the browser.
 */
import { validateManifest } from '../validate/manifest.ts';
import type { ValidationIssue } from '../validate/issues.ts';
import { MANIFEST_SUFFIX, type GraphicsManifest } from '../types.ts';

export type PackageFiles = Map<string, Uint8Array>;

export interface PackageGraphic {
  /** Path of the manifest inside the package (posix, no leading slash). */
  manifestPath: string;
  /** Directory of the manifest ('' for package root); main/thumbnails are relative to it. */
  baseDir: string;
  manifest: GraphicsManifest | undefined;
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ReadPackageResult {
  files: PackageFiles;
  graphics: PackageGraphic[];
  /** Package-level problems (e.g. unsafe paths, no manifests). */
  errors: ValidationIssue[];
}

const IGNORED = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/];

/** Normalises a path inside a package. Returns undefined for unsafe paths. */
export function normalisePackagePath(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return undefined;
    parts.push(part);
  }
  if (parts.length === 0) return undefined;
  if (/^[a-zA-Z]:$/.test(parts[0]!)) return undefined;
  return parts.join('/');
}

export function joinPackagePath(baseDir: string, rel: string): string | undefined {
  if (/^[a-z]+:\/\//i.test(rel) || rel.startsWith('/')) return undefined;
  return normalisePackagePath(baseDir ? `${baseDir}/${rel}` : rel);
}

export function readPackage(input: PackageFiles | Record<string, Uint8Array>): ReadPackageResult {
  const errors: ValidationIssue[] = [];
  let files: PackageFiles = new Map();
  const entries = input instanceof Map ? [...input.entries()] : Object.entries(input);
  for (const [rawPath, content] of entries) {
    if (rawPath.endsWith('/')) continue;
    const p = normalisePackagePath(rawPath);
    if (!p) {
      errors.push({ path: rawPath, code: 'unsafe-path', message: `unsafe path in package: "${rawPath}"` });
      continue;
    }
    if (IGNORED.some((re) => re.test(p))) continue;
    files.set(p, content);
  }

  // Strip a single common top-level folder (typical for zips made by "compress folder").
  const tops = new Set([...files.keys()].map((p) => (p.includes('/') ? p.split('/')[0] : '')));
  if (tops.size === 1 && !tops.has('')) {
    const prefix = [...tops][0] + '/';
    files = new Map([...files.entries()].map(([p, c]) => [p.slice(prefix.length), c]));
  }

  const decoder = new TextDecoder();
  const graphics: PackageGraphic[] = [];
  for (const [path, content] of files) {
    if (!path.toLowerCase().endsWith(MANIFEST_SUFFIX)) continue;
    const baseDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const g: PackageGraphic = { manifestPath: path, baseDir, manifest: undefined, valid: false, errors: [], warnings: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoder.decode(content).replace(/^﻿/, ''));
    } catch (err) {
      g.errors.push({ path: '', code: 'json', message: `invalid JSON: ${(err as Error).message}` });
      graphics.push(g);
      continue;
    }
    const fileName = path.split('/').pop()!;
    const res = validateManifest(parsed, { fileName });
    g.errors.push(...res.errors);
    g.warnings.push(...res.warnings);
    const m = parsed as Partial<GraphicsManifest>;
    if (typeof m.main === 'string') {
      const mainPath = joinPackagePath(baseDir, m.main);
      if (!mainPath) g.errors.push({ path: '/main', code: 'main-path', message: `main must be a relative path inside the package ("${m.main}")` });
      else if (!files.has(mainPath)) g.errors.push({ path: '/main', code: 'main-missing', message: `main file "${m.main}" not found in package` });
    }
    if (Array.isArray(m.thumbnails)) {
      m.thumbnails.forEach((t, i) => {
        const tp = typeof t?.file === 'string' ? joinPackagePath(baseDir, t.file) : undefined;
        if (tp && !files.has(tp)) g.warnings.push({ path: `/thumbnails/${i}/file`, code: 'thumbnail-missing', message: `thumbnail "${t.file}" not found in package` });
      });
    }
    g.manifest = parsed as GraphicsManifest;
    g.valid = g.errors.length === 0;
    graphics.push(g);
  }

  graphics.sort((a, b) => a.manifestPath.localeCompare(b.manifestPath));
  if (graphics.length === 0) errors.push({ path: '', code: 'no-manifest', message: `package contains no "*${MANIFEST_SUFFIX}" manifest` });
  return { files, graphics, errors };
}
