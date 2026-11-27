import { pool, withTransaction } from '../db/pool';
import { conflict, notFound, unprocessable } from '../http/errors';
import {
    categories,
    chargeSpecifications,
    journalConfigurations,
    markets,
    policyRules,
    policySchemas,
    productSpecifications,
    referenceRepository,
    serviceSpecifications,
    taxConfigurations,
} from '../repositories/referenceRepository';
import { compilePolicySchema, validatePolicyRule } from './policyValidator';
import { createPriceOverride, PriceOverride } from './priceOverrideService';

const orNotFound = async <T>(what: string, id: string, p: Promise<T | null>): Promise<T> => {
    const row = await p;
    if (!row) throw notFound(what, id);
    return row;
};

/** IANA zone names are validated against the runtime's tz database, not just their shape. */
function assertIanaTimezone(tz: string | null | undefined): void {
    if (tz === undefined || tz === null) return;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
        throw unprocessable(`"${tz}" is not a known IANA time zone`);
    }
}

export const referenceDataService = {
    // ---- product specifications --------------------------------------------------------------------
    listProductSpecifications: (t: string) => productSpecifications.list(pool, t),
    getProductSpecification: (t: string, id: string) => orNotFound('Product specification', id, productSpecifications.get(pool, t, id)),
    createProductSpecification: (t: string, input: Record<string, unknown>) => productSpecifications.create(pool, t, input),
    updateProductSpecification: (t: string, id: string, input: Record<string, unknown>) =>
        orNotFound('Product specification', id, productSpecifications.update(pool, t, id, input)),
    async deleteProductSpecification(t: string, id: string) {
        if (!(await productSpecifications.remove(pool, t, id))) throw notFound('Product specification', id);
    },

    // ---- charge specifications ---------------------------------------------------------------------
    listChargeSpecifications: (t: string) => chargeSpecifications.list(pool, t),
    getChargeSpecification: (t: string, id: string) => orNotFound('Charge specification', id, chargeSpecifications.get(pool, t, id)),
    createChargeSpecification: (t: string, input: Record<string, unknown>) => chargeSpecifications.create(pool, t, input),
    updateChargeSpecification: (t: string, id: string, input: Record<string, unknown>) =>
        orNotFound('Charge specification', id, chargeSpecifications.update(pool, t, id, input)),

    // ---- service specifications --------------------------------------------------------------------
    listServiceSpecifications: (t: string) => serviceSpecifications.list(pool, t),
    createServiceSpecification: (t: string, input: Record<string, unknown>) => serviceSpecifications.create(pool, t, input),
    updateServiceSpecification: (t: string, id: string, input: Record<string, unknown>) =>
        orNotFound('Service specification', id, serviceSpecifications.update(pool, t, id, input)),

    // ---- markets -----------------------------------------------------------------------------------
    listMarkets: (t: string) => markets.list(pool, t),
    getMarket: (t: string, id: string) => orNotFound('Market', id, markets.get(pool, t, id)),
    async createMarket(t: string, input: Record<string, any>) {
        assertIanaTimezone(input.timezone);
        if (input.parent_market_id && !(await markets.get(pool, t, input.parent_market_id))) {
            throw unprocessable(`Parent market ${input.parent_market_id} does not exist`);
        }
        return markets.create(pool, t, input);
    },
    async updateMarket(t: string, id: string, input: Record<string, any>) {
        assertIanaTimezone(input.timezone);
        return withTransaction(async (tx) => {
            if (input.parent_market_id !== undefined && input.parent_market_id !== null) {
                await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`market_tree:${t}`]);
                if (await referenceRepository.marketCycle(tx, id, input.parent_market_id)) {
                    throw conflict('Setting this parent would create a circular market hierarchy');
                }
            }
            return orNotFound('Market', id, markets.update(tx, t, id, input));
        });
    },
    currencies: () => referenceRepository.currencies(pool),
    upsertCurrency: (code: string, name: string) => referenceRepository.upsertCurrency(pool, code, name),

    // ---- categories (presentation only) ------------------------------------------------------------
    listCategories: (t: string) => categories.list(pool, t),
    createCategory: (t: string, input: Record<string, unknown>) => categories.create(pool, t, input),
    async updateCategory(t: string, id: string, input: Record<string, any>) {
        if (input.parent_category_id && (await referenceRepository.categoryCycle(pool, t, id, input.parent_category_id))) {
            throw conflict('Setting this parent would create a circular category hierarchy');
        }
        return orNotFound('Category', id, categories.update(pool, t, id, input));
    },

    // ---- policies ----------------------------------------------------------------------------------
    listPolicySchemas: (t: string) => policySchemas.list(pool, t),
    createPolicySchema(t: string, input: { schema_name: string; version: string; schema_json: unknown }) {
        compilePolicySchema(input.schema_json);
        return policySchemas.create(pool, t, input);
    },
    listPolicyRules: (t: string) => policyRules.list(pool, t),
    async createPolicyRule(t: string, input: { schema_id: string; rule_json: unknown }) {
        const schema = await policySchemas.get(pool, t, input.schema_id);
        if (!schema) throw unprocessable(`Policy schema ${input.schema_id} does not exist`);
        validatePolicyRule(input.rule_json, schema.schema_json);
        return policyRules.create(pool, t, input);
    },
    async updatePolicyRule(t: string, id: string, input: { rule_json: unknown }) {
        const rule = await orNotFound('Policy rule', id, policyRules.get(pool, t, id));
        const schema = await policySchemas.get(pool, t, rule.schema_id);
        validatePolicyRule(input.rule_json, schema.schema_json);
        return policyRules.update(pool, t, id, input);
    },

    // ---- tax & journal -----------------------------------------------------------------------------
    listTaxConfigurations: (t: string) => taxConfigurations.list(pool, t),
    createTaxConfiguration: (t: string, input: Record<string, unknown>) => taxConfigurations.create(pool, t, input),
    listJournalConfigurations: (t: string) => journalConfigurations.list(pool, t),
    createJournalConfiguration: (t: string, input: Record<string, unknown>) => journalConfigurations.create(pool, t, input),
    chargeFinancials: (t: string) => referenceRepository.chargeFinancials(pool, t),
    mapTax: (t: string, chargeId: string, taxId: string) => referenceRepository.mapTax(pool, t, chargeId, taxId),
    async unmapTax(t: string, chargeId: string, taxId: string) {
        if (!(await referenceRepository.unmapTax(pool, t, chargeId, taxId))) throw notFound('Tax mapping');
    },
    mapJournal: (t: string, chargeId: string, journalId: string) => referenceRepository.mapJournal(pool, t, chargeId, journalId),
    async unmapJournal(t: string, chargeId: string, journalId: string) {
        if (!(await referenceRepository.unmapJournal(pool, t, chargeId, journalId))) throw notFound('Journal mapping');
    },

    // ---- price overrides ---------------------------------------------------------------------------
    listOverrides: (t: string, rateId: string) => referenceRepository.overridesForRate(pool, t, rateId),
    async createOverride(t: string, input: Omit<PriceOverride, 'tenant_id'>) {
        if (input.effective_to && input.effective_to <= input.effective_from) {
            throw unprocessable('effective_to must be after effective_from');
        }
        return withTransaction((tx) => createPriceOverride(tx, { ...input, tenant_id: t }));
    },
    async endOverride(t: string, id: string, at: Date) {
        if (!(await referenceRepository.endOverride(pool, t, id, at))) throw notFound('Active price override', id);
    },
    async deleteOverride(t: string, id: string) {
        if (!(await referenceRepository.deleteOverride(pool, t, id))) throw notFound('Price override', id);
    },
};
