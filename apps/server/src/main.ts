import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const { app, close } = await buildApp(config);

await app.listen({ host: config.host, port: config.port });

const addresses = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address);
const hosts = ['localhost', ...addresses];
app.log.info(`\n  Player:      http://localhost:${config.port}/player/\n  Match data:  http://localhost:${config.port}/data/\n  Editor:      http://localhost:${config.port}/editor/\n  Test bench:  http://localhost:${config.port}/dev\n  Renderer:    ${hosts.map((h) => `http://${h}:${config.port}/render/main`).join('\n               ')}\n  OGraf API:   http://localhost:${config.port}/ograf/v1/\n  Data dir:    ${config.dataDir}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await close();
    process.exit(0);
  });
}
