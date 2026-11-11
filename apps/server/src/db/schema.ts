import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** An uploaded OGraf package (zip or folder). Content-addressed: id = hash of the files. */
export const packages = sqliteTable('packages', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  fileCount: integer('file_count').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadedAt: integer('uploaded_at').notNull(),
});

/** One row per manifest per package. The newest upload of a graphic id is `isLatest`. */
export const graphics = sqliteTable(
  'graphics',
  {
    rowId: integer('row_id').primaryKey({ autoIncrement: true }),
    graphicId: text('graphic_id').notNull(),
    packageId: text('package_id').notNull().references(() => packages.id, { onDelete: 'cascade' }),
    manifestPath: text('manifest_path').notNull(),
    baseDir: text('base_dir').notNull(),
    version: text('version'),
    name: text('name').notNull(),
    manifest: text('manifest', { mode: 'json' }).notNull(),
    warnings: text('warnings', { mode: 'json' }).notNull(),
    isLatest: integer('is_latest', { mode: 'boolean' }).notNull(),
    /** Set when unlisted (soft delete). Files stay so on-air graphics keep working. */
    deletedAt: integer('deleted_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('graphics_graphic_id_idx').on(t.graphicId)],
);

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  frameRate: integer('frame_rate').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

/** Persisted layer state (JSON LayerState), so state survives server restarts. */
export const channelLayers = sqliteTable(
  'channel_layers',
  {
    channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
    layer: integer('layer').notNull(),
    state: text('state', { mode: 'json' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.layer] })],
);

/** Data hub: one row per top-level key of the data tree (e.g. "match"). */
export const dataRoots = sqliteTable('data_roots', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at').notNull(),
});
