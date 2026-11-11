// Bundles the server and the workspace packages (@ogp/*, TypeScript source) into dist/main.js.
// The server's own npm dependencies stay external and are installed in production (pnpm deploy).
import { build } from 'esbuild';
import { cp, readFile, rm } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@ogp/')).flatMap((d) => [d, `${d}/*`]);

await rm('dist', { recursive: true, force: true });
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
await cp('drizzle', 'dist/drizzle', { recursive: true });
console.log('server built -> dist/main.js');
