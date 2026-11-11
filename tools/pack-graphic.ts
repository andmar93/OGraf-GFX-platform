/**
 * Zips each package folder (validated first) so it can be uploaded to the server.
 *   pnpm pack:graphics                       (./graphics/* -> ./dist-graphics/*.zip)
 *   pnpm tsx tools/pack-graphic.ts <srcDir> <outDir>
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { zipSync } from 'fflate';
import { readPackage } from '@ogp/ograf-core';

const [src = 'graphics', out = 'dist-graphics'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

for (const e of readdirSync(src, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  const dir = join(src, e.name);
  const files: Record<string, Uint8Array> = {};
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, f.name);
      if (f.isDirectory()) walk(full);
      else files[relative(dir, full).split(sep).join('/')] = readFileSync(full);
    }
  };
  walk(dir);
  const r = readPackage(files);
  if (r.errors.length || r.graphics.some((g) => !g.valid)) {
    console.error(`✗ ${e.name}: invalid, run "pnpm validate:graphics" for details`);
    process.exitCode = 1;
    continue;
  }
  const target = join(out, `${e.name}.zip`);
  writeFileSync(target, zipSync(files, { level: 9 }));
  console.log(`✓ ${target}`);
}
