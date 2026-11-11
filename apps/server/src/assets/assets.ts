/**
 * Image uploads (team logos, player photos): content-addressed files in DATA_DIR/assets, served at /assets/.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { badRequest } from '../errors.ts';

const TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
};
const EXT: Record<string, string> = { png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', webp: 'webp', svg: 'svg' };
const MAX_BYTES = 10 * 1024 * 1024;

export async function registerAssets(app: FastifyInstance, dataDir: string) {
  const dir = join(dataDir, 'assets');
  mkdirSync(dir, { recursive: true });
  await app.register(fastifyStatic, { root: dir, prefix: '/assets/', decorateReply: false, immutable: true, maxAge: '365d', index: false });

  app.post('/api/v1/assets', async (req, reply) => {
    if (!req.isMultipart()) throw badRequest('upload an image as multipart/form-data (field "file")');
    const file = await req.file({ limits: { fileSize: MAX_BYTES } });
    if (!file) throw badRequest('no file in upload');
    const buf = await file.toBuffer();
    const ext = TYPES[file.mimetype] ?? EXT[(file.filename.split('.').pop() ?? '').toLowerCase()];
    if (!ext) throw badRequest('only PNG, JPG, GIF, WebP and SVG images are allowed');
    const name = `${createHash('sha256').update(buf).digest('hex').slice(0, 24)}.${ext}`;
    if (!existsSync(join(dir, name))) await writeFile(join(dir, name), buf);
    return reply.status(201).send({ url: `/assets/${name}`, size: buf.byteLength });
  });
}
