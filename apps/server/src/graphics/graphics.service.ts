import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { joinPackagePath, readPackage, type GraphicsManifest, type ValidationIssue } from '@ogp/ograf-core';
import type { GraphicRef } from '@ogp/protocol';
import type { Db } from '../db/client.ts';
import { graphics, packages } from '../db/schema.ts';
import { badRequest, HttpError } from '../errors.ts';
import { Emitter } from '../events.ts';

export interface GraphicRecord {
  graphicId: string;
  packageId: string;
  manifestPath: string;
  baseDir: string;
  version: string | null;
  name: string;
  manifest: GraphicsManifest;
  warnings: ValidationIssue[];
  createdAt: number;
}

export interface ImportReport {
  packageId: string;
  name: string;
  /** false when an identical package was already imported */
  created: boolean;
  graphics: { id: string | undefined; name: string | undefined; manifestPath: string; valid: boolean; imported: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }[];
  errors: ValidationIssue[];
}

export class GraphicsService extends Emitter<{ changed: void }> {
  readonly packagesDir: string;

  constructor(private readonly db: Db, dataDir: string, private readonly maxUnzippedBytes = 1024 * 1024 * 1024) {
    super();
    this.packagesDir = join(dataDir, 'packages');
  }

  // ---------- import ----------

  /** Unpacks a zip and imports it. */
  async importZip(zip: Uint8Array, name: string, opts: { force?: boolean } = {}): Promise<ImportReport> {
    let total = 0;
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(zip, {
        filter: (f) => {
          total += f.originalSize;
          if (total > this.maxUnzippedBytes) throw new HttpError(413, 'package is too large when unpacked');
          return !f.name.endsWith('/');
        },
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw badRequest(`not a valid zip file: ${(err as Error).message}`);
    }
    return this.importFiles(files, name, opts);
  }

  /** Imports a folder from disk as one package. */
  async importDirectory(dir: string, opts: { force?: boolean; name?: string } = {}): Promise<ImportReport> {
    const files: Record<string, Uint8Array> = {};
    const walk = async (d: string) => {
      for (const entry of await readdir(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) files[relative(dir, full).split(sep).join('/')] = await readFile(full);
      }
    };
    await walk(dir);
    return this.importFiles(files, opts.name ?? dir.split(sep).pop() ?? 'package', opts);
  }

  /**
   * Validates and stores a package. By default the package is rejected (400) when any
   * manifest is invalid; with `force` only the valid graphics are imported.
   */
  async importFiles(input: Record<string, Uint8Array>, name: string, opts: { force?: boolean } = {}): Promise<ImportReport> {
    const pkg = readPackage(input);
    const report: ImportReport = {
      packageId: '',
      name,
      created: false,
      errors: pkg.errors,
      graphics: pkg.graphics.map((g) => ({ id: g.manifest?.id, name: g.manifest?.name, manifestPath: g.manifestPath, valid: g.valid, imported: false, errors: g.errors, warnings: g.warnings })),
    };
    const valid = pkg.graphics.filter((g) => g.valid);
    const hasInvalid = pkg.graphics.some((g) => !g.valid) || pkg.errors.some((e) => e.code === 'unsafe-path');
    if (valid.length === 0 || (hasInvalid && !opts.force)) {
      throw new HttpError(400, valid.length === 0 ? 'package contains no valid OGraf graphic' : 'package contains invalid graphics (use force=true to import only the valid ones)', report);
    }
    const ids = valid.map((g) => g.manifest!.id);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'package contains the same graphic id more than once', report);

    // Content hash over sorted paths + contents.
    const hash = createHash('sha256');
    let size = 0;
    for (const p of [...pkg.files.keys()].sort()) {
      const c = pkg.files.get(p)!;
      hash.update(p).update('\0').update(c).update('\0');
      size += c.byteLength;
    }
    const packageId = hash.digest('hex').slice(0, 20);
    report.packageId = packageId;

    const existing = this.db.select().from(packages).where(eq(packages.id, packageId)).get();
    const dir = join(this.packagesDir, packageId);
    if (!existing || !existsSync(dir)) {
      const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
      for (const [p, c] of pkg.files) {
        const target = join(tmp, ...p.split('/'));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, c);
      }
      await rm(dir, { recursive: true, force: true });
      const { rename } = await import('node:fs/promises');
      await rename(tmp, dir);
    }

    const now = Date.now();
    this.db.transaction((tx) => {
      if (!existing) {
        tx.insert(packages).values({ id: packageId, name, fileCount: pkg.files.size, sizeBytes: size, uploadedAt: now }).run();
        report.created = true;
      }
      for (const g of valid) {
        const m = g.manifest!;
        const row = tx.select().from(graphics).where(and(eq(graphics.packageId, packageId), eq(graphics.manifestPath, g.manifestPath))).get();
        tx.update(graphics).set({ isLatest: false }).where(eq(graphics.graphicId, m.id)).run();
        if (row) {
          // Re-import of identical content: make it latest/listed again.
          tx.update(graphics).set({ isLatest: true, deletedAt: null }).where(eq(graphics.rowId, row.rowId)).run();
        } else {
          tx.insert(graphics).values({
            graphicId: m.id, packageId, manifestPath: g.manifestPath, baseDir: g.baseDir, version: m.version ?? null,
            name: m.name, manifest: m, warnings: g.warnings, isLatest: true, deletedAt: null, createdAt: now,
          }).run();
        }
        const rep = report.graphics.find((x) => x.manifestPath === g.manifestPath);
        if (rep) rep.imported = true;
      }
    });
    this.emit('changed', undefined);
    return report;
  }

  /** Imports every sub-folder of `dir` as a package. Returns reports (errors are logged, not thrown). */
  async seedFrom(dir: string, log: (msg: string, err?: unknown) => void): Promise<void> {
    if (!existsSync(dir)) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const r = await this.importDirectory(join(dir, entry.name), { name: entry.name });
        log(`seeded ${entry.name} (${r.created ? 'new' : 'unchanged'}): ${r.graphics.map((g) => g.id).join(', ')}`);
      } catch (err) {
        log(`failed to seed ${entry.name}`, err instanceof HttpError ? JSON.stringify(err.details) : err);
      }
    }
  }

  hasAnyPackage(): boolean {
    return !!this.db.select({ id: packages.id }).from(packages).limit(1).get();
  }

  // ---------- queries ----------

  private toRecord(row: typeof graphics.$inferSelect): GraphicRecord {
    return {
      graphicId: row.graphicId,
      packageId: row.packageId,
      manifestPath: row.manifestPath,
      baseDir: row.baseDir,
      version: row.version,
      name: row.name,
      manifest: row.manifest as GraphicsManifest,
      warnings: row.warnings as ValidationIssue[],
      createdAt: row.createdAt,
    };
  }

  /** Latest version of every listed graphic. */
  list(): GraphicRecord[] {
    return this.db.select().from(graphics).where(and(eq(graphics.isLatest, true), isNull(graphics.deletedAt))).all()
      .map((r) => this.toRecord(r))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Latest listed version of a graphic. */
  get(graphicId: string): GraphicRecord | undefined {
    const row = this.db.select().from(graphics).where(and(eq(graphics.graphicId, graphicId), eq(graphics.isLatest, true), isNull(graphics.deletedAt))).get();
    return row ? this.toRecord(row) : undefined;
  }

  /** Unlists a graphic. With force, rows and unused package files are removed as well. */
  async delete(graphicId: string, force = false): Promise<boolean> {
    const rows = this.db.select().from(graphics).where(eq(graphics.graphicId, graphicId)).all();
    if (rows.length === 0 || (!force && rows.every((r) => r.deletedAt !== null))) return false;
    if (!force) {
      this.db.update(graphics).set({ deletedAt: Date.now() }).where(eq(graphics.graphicId, graphicId)).run();
    } else {
      this.db.delete(graphics).where(eq(graphics.graphicId, graphicId)).run();
      for (const pkgId of new Set(rows.map((r) => r.packageId))) {
        const stillUsed = this.db.select({ id: graphics.rowId }).from(graphics).where(eq(graphics.packageId, pkgId)).get();
        if (!stillUsed) {
          this.db.delete(packages).where(eq(packages.id, pkgId)).run();
          await rm(join(this.packagesDir, pkgId), { recursive: true, force: true });
        }
      }
    }
    this.emit('changed', undefined);
    return true;
  }

  /** URL path (served by the server) of a file in a graphic's package, relative to the manifest. */
  fileUrl(rec: Pick<GraphicRecord, 'packageId' | 'baseDir'>, rel: string): string | undefined {
    const p = joinPackagePath(rec.baseDir, rel);
    return p ? `/packages/${rec.packageId}/${p.split('/').map(encodeURIComponent).join('/')}` : undefined;
  }

  /** Absolute file system path of a file in a graphic's package, relative to the manifest. */
  filePath(rec: Pick<GraphicRecord, 'packageId' | 'baseDir'>, rel: string): string | undefined {
    const p = joinPackagePath(rec.baseDir, rel);
    return p ? join(this.packagesDir, rec.packageId, ...p.split('/')) : undefined;
  }

  toRef(rec: GraphicRecord): GraphicRef {
    const ref: GraphicRef = {
      id: rec.graphicId,
      name: rec.name,
      packageId: rec.packageId,
      mainUrl: this.fileUrl(rec, rec.manifest.main)!,
      supportsRealTime: rec.manifest.supportsRealTime,
      supportsNonRealTime: rec.manifest.supportsNonRealTime,
    };
    if (rec.version) ref.version = rec.version;
    if (typeof rec.manifest.stepCount === 'number') ref.stepCount = rec.manifest.stepCount;
    return ref;
  }
}
