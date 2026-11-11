import { resolve } from 'node:path';

export interface ServerConfig {
  host: string;
  port: number;
  /** SQLite file + uploaded packages live here. */
  dataDir: string;
  /** ':memory:' for tests, otherwise a file path. */
  databaseFile: string;
  migrationsDir: string;
  /** Built renderer app (apps/renderer/dist). */
  rendererDist: string;
  /** Built player app (apps/player/dist). */
  playerDist: string;
  /** Built match data tool (apps/data/dist). */
  dataAppDist: string;
  /** Built graphics editor (apps/editor/dist). */
  editorDist: string;
  /** Static files for the /dev test bench. */
  publicDir: string;
  /** Folder with example graphics packages (one sub-folder per package). */
  seedGraphicsDir: string | undefined;
  /** once: only when the database has no packages; always: on every start (idempotent); never */
  seedMode: 'once' | 'always' | 'never';
  logLevel: string;
  /** Default output format for new channels. */
  defaultChannel: { width: number; height: number; frameRate: number };
  timeouts: { loadMs: number; actionMs: number };
  maxUploadBytes: number;
}

const env = process.env;

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dataDir = resolve(env.DATA_DIR ?? '../../data');
  const seedMode = (env.SEED_MODE ?? 'once') as ServerConfig['seedMode'];
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8080),
    dataDir,
    databaseFile: env.DATABASE_FILE ?? resolve(dataDir, 'ogp.sqlite'),
    migrationsDir: resolve(env.MIGRATIONS_DIR ?? 'drizzle'),
    rendererDist: resolve(env.RENDERER_DIST ?? '../renderer/dist'),
    playerDist: resolve(env.PLAYER_DIST ?? '../player/dist'),
    dataAppDist: resolve(env.DATA_APP_DIST ?? '../data/dist'),
    editorDist: resolve(env.EDITOR_DIST ?? '../editor/dist'),
    publicDir: resolve(env.PUBLIC_DIR ?? 'public'),
    seedGraphicsDir: env.SEED_GRAPHICS_DIR === '' ? undefined : resolve(env.SEED_GRAPHICS_DIR ?? '../../graphics'),
    seedMode: ['once', 'always', 'never'].includes(seedMode) ? seedMode : 'once',
    logLevel: env.LOG_LEVEL ?? 'info',
    defaultChannel: { width: 1920, height: 1080, frameRate: Number(env.FRAME_RATE ?? 50) },
    timeouts: { loadMs: Number(env.LOAD_TIMEOUT_MS ?? 12_000), actionMs: Number(env.ACTION_TIMEOUT_MS ?? 7_000) },
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 200) * 1024 * 1024,
    ...overrides,
  };
}
