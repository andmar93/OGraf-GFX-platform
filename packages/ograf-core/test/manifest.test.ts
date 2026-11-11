import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../src/index.ts';

const fixtures = join(import.meta.dirname, 'fixtures');
const load = (f: string) => JSON.parse(readFileSync(join(fixtures, f), 'utf8'));
const repoGraphics = join(import.meta.dirname, '..', '..', '..', 'graphics');

const minimal = () => ({
  $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
  id: 'test',
  name: 'Test',
  main: 'graphic.mjs',
  supportsRealTime: true,
  supportsNonRealTime: false,
});

describe('validateManifest – official EBU examples', () => {
  const files = readdirSync(fixtures).filter((f) => f.startsWith('ebu-'));
  it('has fixtures', () => expect(files.length).toBeGreaterThan(5));
  for (const f of files) {
    it(`accepts ${f}`, () => {
      const r = validateManifest(load(f), { fileName: f });
      expect(r.errors).toEqual([]);
      expect(r.valid).toBe(true);
    });
  }
});

describe('validateManifest – our example graphics', () => {
  for (const dir of readdirSync(repoGraphics)) {
    for (const f of readdirSync(join(repoGraphics, dir)).filter((x) => x.endsWith('.ograf.json'))) {
      it(`accepts graphics/${dir}/${f}`, () => {
        const r = validateManifest(JSON.parse(readFileSync(join(repoGraphics, dir, f), 'utf8')), { fileName: f });
        expect(r.errors).toEqual([]);
      });
    }
  }
});

describe('validateManifest – invalid manifests', () => {
  it('accepts the bare minimum', () => {
    expect(validateManifest(minimal()).valid).toBe(true);
  });

  it.each(['$schema', 'id', 'name', 'main', 'supportsRealTime', 'supportsNonRealTime'])('requires %s', (key) => {
    const m: Record<string, unknown> = minimal();
    delete m[key];
    const r = validateManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes(`"${key}"`))).toBe(true);
  });

  it('rejects a wrong $schema url', () => {
    const r = validateManifest({ ...minimal(), $schema: 'https://example.com/schema.json' });
    expect(r.valid).toBe(false);
  });

  it('rejects unknown properties but allows v_ vendor properties', () => {
    expect(validateManifest({ ...minimal(), editor: 'x' }).valid).toBe(false);
    expect(validateManifest({ ...minimal(), v_ogp_editor: { any: 'thing' } }).valid).toBe(true);
    expect(validateManifest({ ...minimal(), author: { name: 'A', twitter: '@a' } }).valid).toBe(false);
  });

  it('rejects stepCount below -1 and non-integer stepCount', () => {
    expect(validateManifest({ ...minimal(), stepCount: -2 }).valid).toBe(false);
    expect(validateManifest({ ...minimal(), stepCount: 1.5 }).valid).toBe(false);
    expect(validateManifest({ ...minimal(), stepCount: -1 }).valid).toBe(true);
  });

  it('requires a manifest file name ending with .ograf.json', () => {
    expect(validateManifest(minimal(), { fileName: 'manifest.json' }).valid).toBe(false);
    expect(validateManifest(minimal(), { fileName: 'x.ograf.json' }).valid).toBe(true);
  });

  it('rejects ids containing "/"', () => {
    expect(validateManifest({ ...minimal(), id: 'a/b' }).valid).toBe(false);
  });

  it('rejects graphics supporting neither realtime nor non-realtime', () => {
    expect(validateManifest({ ...minimal(), supportsRealTime: false }).valid).toBe(false);
  });

  it('validates customActions', () => {
    expect(validateManifest({ ...minimal(), customActions: [{ id: 'a', name: 'A', schema: null }] }).valid).toBe(true);
    expect(validateManifest({ ...minimal(), customActions: [{ id: 'a' }] }).valid).toBe(false);
    expect(validateManifest({ ...minimal(), customActions: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }).valid).toBe(false);
  });

  it('validates actionDurations', () => {
    const ok = { ...minimal(), customActions: [{ id: 'goal', name: 'Goal' }], actionDurations: [
      { type: 'playAction', duration: 500, steps: [{ step: 1, duration: 300 }, { duration: 400 }] },
      { type: 'stopAction', duration: 400 },
      { type: 'customAction', customActionId: 'goal', duration: 600 },
    ] };
    expect(validateManifest(ok).errors).toEqual([]);
    // duplicate type
    expect(validateManifest({ ...minimal(), actionDurations: [{ type: 'stopAction', duration: 1 }, { type: 'stopAction', duration: 2 }] }).valid).toBe(false);
    // dangling custom action reference
    expect(validateManifest({ ...minimal(), actionDurations: [{ type: 'customAction', customActionId: 'nope', duration: 1 }] }).valid).toBe(false);
    // missing customActionId
    expect(validateManifest({ ...minimal(), actionDurations: [{ type: 'customAction', duration: 1 }] }).valid).toBe(false);
    // duration below -1
    expect(validateManifest({ ...minimal(), actionDurations: [{ type: 'stopAction', duration: -5 }] }).valid).toBe(false);
    // steps only allowed on playAction
    expect(validateManifest({ ...minimal(), actionDurations: [{ type: 'stopAction', duration: 1, steps: [] }] }).valid).toBe(false);
  });

  it('validates the GDD schema field', () => {
    const withSchema = (schema: unknown) => validateManifest({ ...minimal(), schema });
    expect(withSchema({ type: 'object', properties: { name: { type: 'string', gddType: 'single-line' } } }).valid).toBe(true);
    // object without properties
    expect(withSchema({ type: 'object' }).valid).toBe(false);
    // unsupported type
    expect(withSchema({ type: 'object', properties: { x: { type: 'null' } } }).valid).toBe(false);
    // gddType constrains the basic type
    expect(withSchema({ type: 'object', properties: { c: { type: 'number', gddType: 'color-rrggbb' } } }).valid).toBe(false);
  });

  it('gives readable messages', () => {
    const r = validateManifest({ ...minimal(), foo: 1 });
    expect(r.errors[0]?.message).toMatch(/unknown property "foo"/);
  });
});
