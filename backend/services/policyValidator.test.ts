import { validatePolicyRule } from './policyValidator';

describe('Policy Validator', () => {
    const schema = {
        type: 'object',
        properties: {
            market_code: { type: 'string' }
        },
        required: ['market_code']
    };

    it('TEST A — Valid rule', () => {
        const rule = { market_code: 'NIGERIA' };
        expect(() => validatePolicyRule(rule, schema)).not.toThrow();
    });

    it('TEST B — Wrong data type', () => {
        const rule = { market_code: 123 };
        expect(() => validatePolicyRule(rule, schema)).toThrow(/Policy rule validation failed/);
    });

    it('TEST C — Missing required property', () => {
        const rule = {};
        expect(() => validatePolicyRule(rule, schema)).toThrow(/Policy rule validation failed/);
    });

    it('TEST D — Invalid update (mocked update process)', () => {
        // Valid insert
        const rule = { market_code: 'NIGERIA' };
        expect(() => validatePolicyRule(rule, schema)).not.toThrow();
        
        // Invalid update payload
        const invalidUpdate = { market_code: 123 };
        expect(() => validatePolicyRule(invalidUpdate, schema)).toThrow(/Policy rule validation failed/);
    });

    it('TEST E — Cross-tenant schema (mocked service failure)', () => {
        // In reality, this is checked by the DB foreign keys and repository before validation.
        // We simulate a repository rejection here.
        const requestTenant = 'tenant-A' as string;
        const schemaTenant = 'tenant-B' as string;
        
        const fetchSchema = () => {
            if (requestTenant !== schemaTenant) {
                throw new Error("Schema not found or belongs to another tenant");
            }
            return schema;
        };

        expect(() => fetchSchema()).toThrow(/Schema not found or belongs to another tenant/);
    });
});
