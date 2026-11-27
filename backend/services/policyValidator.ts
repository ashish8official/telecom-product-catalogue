import Ajv, { ValidateFunction } from 'ajv';
import { unprocessable } from '../http/errors';

const ajv = new Ajv({ allErrors: true, strict: false });
const cache = new Map<string, ValidateFunction>();

/** Compiles a policy_schema.schema_json, rejecting anything that is not a valid JSON Schema. */
export function compilePolicySchema(schemaJson: unknown): ValidateFunction {
    const key = JSON.stringify(schemaJson);
    const cached = cache.get(key);
    if (cached) return cached;
    try {
        const validate = ajv.compile(schemaJson as object);
        if (cache.size > 500) cache.clear();
        cache.set(key, validate);
        return validate;
    } catch (err: any) {
        throw unprocessable(`Policy schema is not a valid JSON Schema: ${err.message}`);
    }
}

/**
 * Policy JSON is never accepted without validation against its policy_schema record (AGENTS.md).
 * Throws a 422 AppError describing every violation.
 */
export function validatePolicyRule(ruleJson: unknown, schemaJson: unknown): void {
    const validate = compilePolicySchema(schemaJson);
    if (!validate(ruleJson)) {
        throw unprocessable(`Policy rule validation failed: ${ajv.errorsText(validate.errors)}`, validate.errors);
    }
}
