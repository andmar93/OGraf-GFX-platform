import type { ErrorObject } from 'ajv';

export interface ValidationIssue {
  /** JSON pointer into the validated document, '' for the root. */
  path: string;
  message: string;
  /** Machine-friendly code, e.g. ajv keyword or our own semantic rule id. */
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** Turns Ajv errors into readable, de-duplicated issues. */
export function fromAjvErrors(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  if (!errors) return [];
  const out: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const e of errors) {
    // "if"/"oneOf" wrapper errors repeat the more precise child errors.
    if (e.keyword === 'if') continue;
    let message = e.message ?? 'invalid';
    if (e.keyword === 'additionalProperties') {
      const prop = (e.params as { additionalProperty?: string }).additionalProperty;
      message = `unknown property "${prop}" (vendor-specific properties must start with "v_")`;
    } else if (e.keyword === 'required') {
      message = `missing required property "${(e.params as { missingProperty?: string }).missingProperty}"`;
    } else if (e.keyword === 'const') {
      message = `must be ${JSON.stringify((e.params as { allowedValue?: unknown }).allowedValue)}`;
    } else if (e.keyword === 'enum') {
      message = `must be one of ${JSON.stringify((e.params as { allowedValues?: unknown }).allowedValues)}`;
    }
    const key = `${e.instancePath}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: e.instancePath, message, code: e.keyword });
  }
  return out;
}
