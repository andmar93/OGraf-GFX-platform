import { getManifestValidator } from './ajv.ts';
import { fromAjvErrors, type ValidationIssue, type ValidationResult } from './issues.ts';
import { MANIFEST_SUFFIX, type GraphicsManifest } from '../types.ts';

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validates a parsed manifest against the official OGraf JSON schema plus the
 * normative rules that the JSON schema cannot express.
 */
export function validateManifest(manifest: unknown, opts: { fileName?: string } = {}): ValidationResult {
  const validator = getManifestValidator();
  const ok = validator(manifest);
  const errors: ValidationIssue[] = ok ? [] : fromAjvErrors(validator.errors);
  const warnings: ValidationIssue[] = [];

  if (opts.fileName !== undefined && !opts.fileName.endsWith(MANIFEST_SUFFIX)) {
    errors.push({ path: '', code: 'file-name', message: `manifest file name must end with "${MANIFEST_SUFFIX}" (got "${opts.fileName}")` });
  }
  if (isObj(manifest)) semanticChecks(manifest, errors, warnings);

  return { valid: errors.length === 0, errors, warnings };
}

function semanticChecks(m: Rec, errors: ValidationIssue[], warnings: ValidationIssue[]) {
  if (typeof m.id === 'string') {
    if (m.id.includes('/')) errors.push({ path: '/id', code: 'id-slash', message: 'id must not contain "/"' });
    if (m.id.trim() === '') errors.push({ path: '/id', code: 'id-empty', message: 'id must not be empty' });
  }
  if (m.supportsRealTime === false && m.supportsNonRealTime === false) {
    errors.push({ path: '', code: 'render-type', message: 'a Graphic must support real-time, non-real-time or both' });
  }
  if (typeof m.stepCount === 'number' && !Number.isInteger(m.stepCount)) {
    errors.push({ path: '/stepCount', code: 'step-count-integer', message: 'stepCount must be an integer' });
  }
  if (typeof m.main === 'string' && !/\.m?js$/i.test(m.main)) {
    warnings.push({ path: '/main', code: 'main-extension', message: 'main is expected to be a JavaScript module (.mjs/.js)' });
  }

  const customIds = new Set<string>();
  if (Array.isArray(m.customActions)) {
    m.customActions.forEach((a, i) => {
      if (!isObj(a) || typeof a.id !== 'string') return;
      if (customIds.has(a.id)) errors.push({ path: `/customActions/${i}/id`, code: 'custom-action-duplicate', message: `duplicate custom action id "${a.id}"` });
      customIds.add(a.id);
    });
  }

  if (Array.isArray(m.actionDurations)) {
    const seenTypes = new Set<string>();
    const seenCustom = new Set<string>();
    m.actionDurations.forEach((d, i) => {
      if (!isObj(d) || typeof d.type !== 'string') return;
      const path = `/actionDurations/${i}`;
      if (d.type === 'customAction') {
        const cid = d.customActionId;
        if (typeof cid === 'string') {
          if (seenCustom.has(cid)) errors.push({ path, code: 'duration-duplicate', message: `more than one actionDuration for custom action "${cid}"` });
          seenCustom.add(cid);
          if (!customIds.has(cid)) errors.push({ path: `${path}/customActionId`, code: 'duration-unknown-action', message: `customActionId "${cid}" does not match any customActions[].id` });
        }
      } else {
        if (seenTypes.has(d.type)) errors.push({ path, code: 'duration-duplicate', message: `more than one actionDuration for "${d.type}"` });
        seenTypes.add(d.type);
      }
      if (Array.isArray(d.steps)) {
        const seenSteps = new Set<string>();
        d.steps.forEach((s, j) => {
          if (!isObj(s)) return;
          const key = s.step === undefined ? 'fallback' : String(s.step);
          if (seenSteps.has(key)) errors.push({ path: `${path}/steps/${j}`, code: 'duration-step-duplicate', message: `duplicate step duration (${key})` });
          seenSteps.add(key);
        });
      }
    });
  }
}

/** Type guard version for callers that only care about pass/fail. */
export function isValidManifest(manifest: unknown): manifest is GraphicsManifest {
  return validateManifest(manifest).valid;
}
