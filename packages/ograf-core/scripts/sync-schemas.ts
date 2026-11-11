/**
 * Refreshes the vendored OGraf JSON schemas from GitHub.
 * Usage: pnpm sync-schemas            (main branch)
 *        OGRAF_REF=<sha> pnpm sync-schemas
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ref = process.env.OGRAF_REF ?? 'main';
const base = `https://raw.githubusercontent.com/ebu/ograf/${ref}/v1/specification/json-schemas/`;
const files = [
  'graphics/schema.json',
  'lib/action.json',
  'lib/constraints/number.json',
  'lib/constraints/string.json',
  'lib/constraints/boolean.json',
  'gdd/object.json',
  'gdd/basic-types.json',
  'gdd/gdd-types.json',
  'gdd/playout-options.json',
];
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'v1');

for (const file of files) {
  const res = await fetch(base + file);
  if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.status}`);
  const text = await res.text();
  JSON.parse(text); // sanity check
  const target = join(outDir, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text);
  console.log('updated', file);
}
console.log(`Done. Remember to update schemas/SOURCE.md with the ref (${ref}).`);
