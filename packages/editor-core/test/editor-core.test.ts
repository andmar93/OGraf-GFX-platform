import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPackage, validateGraphicData } from '@ogp/ograf-core';
import {
  absolutePosition, animDuration, assetUrls, cloneLayer, createLayer, createProject, defaultData, exportPackage,
  findLayer, generateModule, importPackage, insertLayer, moveLayer, projectSchema, removeLayer, templateFields,
  updateLayer, usedFields, type GroupLayer, type ImageLayer, type Project, type TextLayer,
} from '../src/index.ts';

function project(): Project {
  const p = createProject('Score Card');
  p.fields.push(
    { key: 'score', label: 'Score', type: 'integer', default: 3, bind: 'match.home.score' },
    { key: 'color', label: 'Team colour', type: 'color', default: '#D81E3C', hidden: true },
    { key: 'logo', label: 'Logo', type: 'image' },
    { key: 'show', label: 'Show badge', type: 'boolean', default: true },
    { key: 'clock', label: 'Clock', type: 'clock', bind: 'match.clock' },
  );
  const group = { ...(createLayer('group') as GroupLayer), x: 100, y: 100 };
  const img = { ...(createLayer('image') as ImageLayer), x: 10, y: 20, src: '/assets/abc123.png' };
  group.children.push(img);
  p.layers.push(group);
  return p;
}

describe('model', () => {
  it('creates a starter project with fields used by its layers', () => {
    const p = createProject('Lower third');
    expect(p.graphicId).toBe('user.lower-third');
    expect([...usedFields(p)].sort()).toEqual(['subtitle', 'title']);
  });

  it('edits the layer tree immutably', () => {
    const p = project();
    const group = p.layers.at(-1) as GroupLayer;
    const img = group.children[0]!;
    expect(absolutePosition(p.layers, img.id)).toEqual({ x: 110, y: 120 });
    const moved = updateLayer(p.layers, img.id, { x: 50 });
    expect((findLayer(moved, img.id) as ImageLayer).x).toBe(50);
    expect(img.x).toBe(10);
    const text = createLayer('text');
    const withText = insertLayer(p.layers, text, img.id);
    expect((withText.at(-1) as GroupLayer).children.map((c) => c.type)).toEqual(['image', 'text']);
    const into = insertLayer(p.layers, createLayer('shape'), null, group.id);
    expect((into.at(-1) as GroupLayer).children).toHaveLength(2);
    expect(removeLayer(withText, text.id).length).toBe(p.layers.length);
    const firstId = p.layers[0]!.id;
    expect(moveLayer(p.layers, firstId, 1)[1]!.id).toBe(firstId);
    expect(moveLayer(p.layers, firstId, -1)[0]!.id).toBe(firstId);
    const c = cloneLayer(group);
    expect(c.id).not.toBe(group.id);
    expect((c as GroupLayer).children[0]!.id).not.toBe(img.id);
  });

  it('parses template placeholders', () => {
    expect(templateFields('{homeCode} {homeScore}–{awayScore:pad2} {clock:stoppage} {not valid} {}')).toEqual(['homeCode', 'homeScore', 'awayScore', 'clock']);
  });

  it('computes animation durations', () => {
    const p = createProject();
    expect(animDuration(p, 'in')).toBe(780); // subtitle: 280 delay + 500
    expect(animDuration(p, 'out')).toBe(500);
  });
});

describe('schema', () => {
  it('turns fields into a GDD schema with bindings and defaults', () => {
    const s = projectSchema(project()) as { properties: Record<string, Record<string, unknown>> };
    expect(s.properties.score).toMatchObject({ type: 'integer', default: 3, v_ogp_bind: 'match.home.score', order: 3 });
    expect(s.properties.color).toMatchObject({ type: 'string', gddType: 'color-rrggbb', pattern: '^#[0-9a-f]{6}$', default: '#d81e3c', hidden: true });
    expect(s.properties.logo).toMatchObject({ gddType: 'file-path/image-path' });
    expect(s.properties.clock).toMatchObject({ type: 'object', v_ogp_bind: 'match.clock' });
    expect(defaultData(project())).toMatchObject({ title: 'Name Surname', score: 3, show: true, color: '#d81e3c', logo: '' });
  });

  it('validates data against the generated schema', () => {
    const s = projectSchema(project());
    expect(validateGraphicData(s, defaultData(project())).valid).toBe(true);
    expect(validateGraphicData(s, { score: 'x' }, { partial: true }).valid).toBe(false);
  });
});

describe('export / import', () => {
  const fakeAsset = async (url: string) => new TextEncoder().encode(`image:${url}`);

  it('exports a valid OGraf package with bundled assets', async () => {
    const p = project();
    expect(assetUrls(p)).toEqual(['/assets/abc123.png']);
    const r = await exportPackage(p, fakeAsset);
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.files).sort()).toEqual(['assets/abc123.png', 'graphic.mjs', 'score-card.ograf.json']);
    const pkg = readPackage(r.files);
    expect(pkg.errors).toEqual([]);
    expect(pkg.graphics[0]).toMatchObject({ valid: true, manifestPath: 'score-card.ograf.json' });
    expect(r.manifest).toMatchObject({ id: 'user.score-card', main: 'graphic.mjs', stepCount: 1, v_ogp_defaultLayer: 20, actionDurations: [{ type: 'playAction', duration: 780 }, { type: 'stopAction', duration: 500 }, { type: 'updateAction', duration: 0 }] });
    // image source rewritten to the bundled file, relative to the module
    const code = new TextDecoder().decode(r.files['graphic.mjs']);
    expect(code).toContain('"src":"assets/abc123.png"');
    expect(code).not.toContain('/*__OGP_PROJECT__*/null');
  });

  it('generates a syntactically valid ES module, even with tricky text', () => {
    const p = project();
    (p.layers[2] as TextLayer).text = 'A </script> $& $`   "quotes" {title}';
    const dir = mkdtempSync(join(tmpdir(), 'ogp-mod-'));
    const file = join(dir, 'graphic.mjs');
    writeFileSync(file, generateModule(p));
    execFileSync(process.execPath, ['--check', file]);
    expect(generateModule(p)).toContain('$& $`');
  });

  it('round-trips through import (assets are re-uploaded)', async () => {
    const p = project();
    const r = await exportPackage(p, fakeAsset);
    const uploads: string[] = [];
    const back = await importPackage(r.files, async (path) => {
      uploads.push(path);
      return `/assets/re-${path.split('/').pop()}`;
    });
    expect(uploads).toEqual(['assets/abc123.png']);
    expect(back.name).toBe('Score Card');
    expect(back.fields.map((f) => f.key)).toEqual(p.fields.map((f) => f.key));
    const img = (back.layers.at(-1) as GroupLayer).children[0] as ImageLayer;
    expect(img.src).toBe('/assets/re-abc123.png');
  });

  it('refuses packages that were not made with the editor', async () => {
    const files = { 'x.ograf.json': new TextEncoder().encode(JSON.stringify({ id: 'x' })) };
    await expect(importPackage(files, async () => '')).rejects.toThrow(/not made with the editor/);
  });
});
