import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

export function validatePolicyRule(ruleJson: any, schemaJson: any): void {
    const validate = ajv.compile(schemaJson);
    const valid = validate(ruleJson);
    if (!valid) {
        throw new Error(`Policy rule validation failed: ${ajv.errorsText(validate.errors)}`);
    }
}
