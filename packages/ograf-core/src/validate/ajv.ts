import Ajv2020Module from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';

import graphicsSchema from '../../schemas/v1/graphics/schema.json' with { type: 'json' };
import actionSchema from '../../schemas/v1/lib/action.json' with { type: 'json' };
import numberConstraint from '../../schemas/v1/lib/constraints/number.json' with { type: 'json' };
import stringConstraint from '../../schemas/v1/lib/constraints/string.json' with { type: 'json' };
import booleanConstraint from '../../schemas/v1/lib/constraints/boolean.json' with { type: 'json' };
import gddObject from '../../schemas/v1/gdd/object.json' with { type: 'json' };
import gddBasicTypes from '../../schemas/v1/gdd/basic-types.json' with { type: 'json' };
import gddTypes from '../../schemas/v1/gdd/gdd-types.json' with { type: 'json' };
import gddPlayoutOptions from '../../schemas/v1/gdd/playout-options.json' with { type: 'json' };

// ajv ships CommonJS; normalise the default export across bundlers / Node.
type AjvCtor = typeof import('ajv/dist/2020.js').default;
const Ajv2020: AjvCtor = ((Ajv2020Module as unknown as { default?: AjvCtor }).default ?? Ajv2020Module) as AjvCtor;
export type AjvInstance = InstanceType<AjvCtor>;

export const VENDORED_SCHEMAS = [
  actionSchema,
  numberConstraint,
  stringConstraint,
  booleanConstraint,
  gddObject,
  gddBasicTypes,
  gddTypes,
  gddPlayoutOptions,
  graphicsSchema,
] as const;

let manifestValidator: ValidateFunction | undefined;

/** Compiled validator for the official OGraf manifest schema (all $refs resolved locally). */
export function getManifestValidator(): ValidateFunction {
  if (!manifestValidator) {
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
    for (const s of VENDORED_SCHEMAS) ajv.addSchema(s as object);
    manifestValidator = ajv.getSchema(graphicsSchema.$id)!;
  }
  return manifestValidator;
}

/** A plain Ajv instance for validating Graphic data against a manifest's GDD `schema`. */
export function createDataAjv(): AjvInstance {
  return new Ajv2020({ strict: false, allErrors: true, validateFormats: false, validateSchema: false });
}

export type { ErrorObject };
