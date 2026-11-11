import { describe, expect, it } from 'vitest';
import { buildLabel, getDefaultData, listFields, readPackage, validateGraphicData } from '../src/index.ts';

const enc = new TextEncoder();
const manifest = (extra: Record<string, unknown> = {}) => enc.encode(JSON.stringify({
  $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
  id: 'pkg-test', name: 'Pkg', main: 'graphic.mjs', supportsRealTime: true, supportsNonRealTime: false, ...extra,
}));

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', label: 'Name', default: 'John', order: 2 },
    title: { type: 'string', default: 'Reporter', order: 1 },
    secret: { type: 'string', default: 'x', hidden: true },
    score: { type: 'integer', minimum: 0 },
    team: { type: 'object', properties: { color: { type: 'string', default: '#ff0000' } } },
  },
  required: ['name'],
};

describe('GDD helpers', () => {
  it('builds default data', () => {
    expect(getDefaultData(schema)).toEqual({ name: 'John', title: 'Reporter', secret: 'x', team: { color: '#ff0000' } });
  });
  it('lists fields by order', () => {
    expect(listFields(schema).map((f) => f.key)).toEqual(['title', 'name', 'secret', 'score', 'team']);
  });
  it('builds labels without hidden fields', () => {
    expect(buildLabel(schema, { name: 'Anna', title: 'Coach', secret: 'nope' })).toBe('Coach – Anna');
  });
});

describe('validateGraphicData', () => {
  it('validates full data', () => {
    expect(validateGraphicData(schema, { name: 'A', score: 1 }).valid).toBe(true);
    expect(validateGraphicData(schema, { score: 1 }).valid).toBe(false);
    expect(validateGraphicData(schema, { name: 'A', score: -1 }).valid).toBe(false);
  });
  it('allows partial data for updates', () => {
    expect(validateGraphicData(schema, { score: 3 }, { partial: true }).valid).toBe(true);
    expect(validateGraphicData(schema, { score: 'x' }, { partial: true }).valid).toBe(false);
  });
  it('accepts anything without a schema', () => {
    expect(validateGraphicData(undefined, 42).valid).toBe(true);
  });
});

describe('readPackage', () => {
  it('finds manifests and strips a common top-level folder', () => {
    const r = readPackage({ 'my-pkg/a.ograf.json': manifest(), 'my-pkg/graphic.mjs': enc.encode('export default class {}') });
    expect(r.errors).toEqual([]);
    expect(r.graphics).toHaveLength(1);
    expect(r.graphics[0]!.manifestPath).toBe('a.ograf.json');
    expect(r.graphics[0]!.valid).toBe(true);
    expect([...r.files.keys()].sort()).toEqual(['a.ograf.json', 'graphic.mjs']);
  });
  it('supports several manifests in subfolders', () => {
    const r = readPackage({
      'one/one.ograf.json': manifest({ id: 'one' }), 'one/graphic.mjs': enc.encode(''),
      'two/two.ograf.json': manifest({ id: 'two' }), 'two/graphic.mjs': enc.encode(''),
    });
    expect(r.graphics.map((g) => [g.baseDir, g.manifest?.id, g.valid])).toEqual([['one', 'one', true], ['two', 'two', true]]);
  });
  it('reports a missing main file', () => {
    const r = readPackage({ 'a.ograf.json': manifest() });
    expect(r.graphics[0]!.valid).toBe(false);
    expect(r.graphics[0]!.errors.some((e) => e.code === 'main-missing')).toBe(true);
  });
  it('rejects path traversal', () => {
    const r = readPackage({ '../evil.mjs': enc.encode(''), 'a.ograf.json': manifest(), 'graphic.mjs': enc.encode('') });
    expect(r.errors.some((e) => e.code === 'unsafe-path')).toBe(true);
    expect(r.files.has('evil.mjs')).toBe(false);
  });
  it('rejects main paths outside the package', () => {
    const r = readPackage({ 'a.ograf.json': manifest({ main: '../x.mjs' }) });
    expect(r.graphics[0]!.errors.some((e) => e.code === 'main-path')).toBe(true);
  });
  it('reports invalid JSON and missing manifests', () => {
    expect(readPackage({ 'a.ograf.json': enc.encode('{nope') }).graphics[0]!.errors[0]!.code).toBe('json');
    expect(readPackage({ 'graphic.mjs': enc.encode('') }).errors[0]!.code).toBe('no-manifest');
  });
  it('ignores macOS junk', () => {
    const r = readPackage({ '__MACOSX/._a.ograf.json': enc.encode('x'), 'a.ograf.json': manifest(), 'graphic.mjs': enc.encode('') });
    expect(r.graphics).toHaveLength(1);
  });
});
