/**
 * Validates OGraf packages: folders (each sub-folder of the given dir, or the dir itself) or .zip files.
 *   pnpm validate:graphics                 (validates ./graphics/*)
 *   pnpm tsx tools/validate-graphics.ts path/to/pkg path/to/other.zip
 * Exit code 1 when any package has errors.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { readPackage } from '@ogp/ograf-core';

function readDir(dir: string): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out[relative(dir, full).split(sep).join('/')] = readFileSync(full);
    }
  };
  walk(dir);
  return out;
}

const targets: string[] = [];
for (const arg of process.argv.slice(2).length ? process.argv.slice(2) : ['graphics']) {
  if (!existsSync(arg)) {
    console.error(`not found: ${arg}`);
    process.exitCode = 1;
    continue;
  }
  if (statSync(arg).isDirectory() && !readdirSync(arg).some((f) => f.endsWith('.ograf.json'))) {
    for (const e of readdirSync(arg, { withFileTypes: true })) if (e.isDirectory() || e.name.endsWith('.zip')) targets.push(join(arg, e.name));
  } else targets.push(arg);
}

let failed = 0;
for (const t of targets) {
  const files = t.endsWith('.zip') ? unzipSync(readFileSync(t)) : readDir(t);
  const r = readPackage(files);
  const bad = r.errors.length > 0 || r.graphics.some((g) => !g.valid);
  if (bad) failed++;
  console.log(`${bad ? '✗' : '✓'} ${t}`);
  for (const e of r.errors) console.log(`    error   ${e.message}`);
  for (const g of r.graphics) {
    console.log(`    ${g.valid ? '✓' : '✗'} ${g.manifestPath}  (${g.manifest?.id ?? '?'})`);
    for (const e of g.errors) console.log(`        error   ${e.path || '/'}: ${e.message}`);
    for (const w of g.warnings) console.log(`        warning ${w.path || '/'}: ${w.message}`);
  }
}
console.log(`\n${targets.length - failed}/${targets.length} package(s) valid`);
if (failed) process.exitCode = 1;
