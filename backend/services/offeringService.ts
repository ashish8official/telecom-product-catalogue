import { pool, withTransaction } from '../db/pool';
import { badRequest, conflict, notFound, unprocessable } from '../http/errors';
import { offeringRepository, OfferingQuery, OfferingType, OfferingView, RelationshipType, ServiceType } from '../repositories/offeringRepository';
import { chargeSpecifications, markets, productSpecifications } from '../repositories/referenceRepository';
import { catalogueService } from './catalogueService';

/** Internal codes are stable identifiers derived once from the name; renaming never changes them. */
export function codeFromName(name: string): string {
    const code = name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 100);
    if (!code) throw badRequest('name must contain at least one letter or digit');
    return code;
}

export interface OfferingDetail extends OfferingView {
    charges: any[];
    rates: any[];
    services: any[];
    markets: any[];
    relationships: any[];
    policies: any[];
    categories: any[];
}

async function attachChildren(tenantId: string, offerings: OfferingView[]): Promise<OfferingDetail[]> {
    if (offerings.length === 0) return [];
    const ids = offerings.map((o) => o.id);
    const [charges, rates, services, mkts, relationships, policies, categories] = await Promise.all([
        offeringRepository.charges(pool, tenantId, ids),
        offeringRepository.rates(pool, tenantId, ids),
        offeringRepository.services(pool, tenantId, ids),
        offeringRepository.markets(pool, tenantId, ids),
        offeringRepository.relationships(pool, tenantId, ids),
        offeringRepository.policies(pool, tenantId, ids),
        offeringRepository.categories(pool, tenantId, ids),
    ]);
    const by = (rows: any[], key = 'offering_id') => (id: string) => rows.filter((r) => r[key] === id);
    return offerings.map((o) => ({
        ...o,
        charges: by(charges)(o.id),
        rates: by(rates)(o.id),
        services: by(services)(o.id),
        markets: by(mkts)(o.id),
        relationships: by(relationships, 'source_offering_id')(o.id),
        policies: by(policies)(o.id),
        categories: by(categories)(o.id),
    }));
}

async function editableOffering(tenantId: string, offeringId: string): Promise<OfferingView> {
    const offering = await offeringRepository.get(pool, tenantId, offeringId);
    if (!offering) throw notFound('Offering', offeringId);
    if (offering.version_status !== 'DRAFT') {
        throw conflict(
            `Offering ${offering.offering_code} belongs to ${offering.version_status} catalogue version ${offering.version}; only DRAFT versions can be edited. Create a new version instead.`
        );
    }
    return offering;
}

export const offeringService = {
    list: (tenantId: string, q: OfferingQuery) => offeringRepository.list(pool, tenantId, q),

    async listDetailed(tenantId: string, q: OfferingQuery): Promise<{ rows: OfferingDetail[]; total: number }> {
        const { rows, total } = await offeringRepository.list(pool, tenantId, q);
        return { rows: await attachChildren(tenantId, rows), total };
    },

    async get(tenantId: string, id: string): Promise<OfferingView> {
        const offering = await offeringRepository.get(pool, tenantId, id);
        if (!offering) throw notFound('Offering', id);
        return offering;
    },

    async getDetailed(tenantId: string, id: string): Promise<OfferingDetail> {
        const [detail] = await attachChildren(tenantId, [await this.get(tenantId, id)]);
        return detail;
    },

    async create(
        tenantId: string,
        input: {
            catalogue_version_id: string;
            product_specification_id: string;
            offering_name: string;
            offering_code?: string;
            offering_type?: OfferingType;
            service_type?: ServiceType;
        }
    ) {
        await catalogueService.assertDraft(tenantId, input.catalogue_version_id);
        if (!(await productSpecifications.get(pool, tenantId, input.product_specification_id))) {
            throw unprocessable(`Product specification ${input.product_specification_id} does not exist`);
        }
        const created = await offeringRepository.create(pool, tenantId, {
            catalogue_version_id: input.catalogue_version_id,
            product_specification_id: input.product_specification_id,
            offering_name: input.offering_name,
            offering_code: input.offering_code ?? codeFromName(input.offering_name),
            offering_type: input.offering_type ?? 'BASE',
            service_type: input.service_type ?? 'BOTH',
        });
        return this.get(tenantId, created.id);
    },

    async update(
        tenantId: string,
        id: string,
        input: { product_specification_id?: string; offering_name?: string; offering_type?: OfferingType; service_type?: ServiceType }
    ) {
        await editableOffering(tenantId, id);
        if (input.product_specification_id && !(await productSpecifications.get(pool, tenantId, input.product_specification_id))) {
            throw unprocessable(`Product specification ${input.product_specification_id} does not exist`);
        }
        await offeringRepository.update(pool, tenantId, id, input);
        return this.get(tenantId, id);
    },

    async remove(tenantId: string, id: string) {
        await editableOffering(tenantId, id);
        await offeringRepository.remove(pool, tenantId, id);
    },

    // ---- components -------------------------------------------------------------------------------

    async addCharge(tenantId: string, offeringId: string, chargeSpecId: string) {
        await editableOffering(tenantId, offeringId);
        if (!(await chargeSpecifications.get(pool, tenantId, chargeSpecId))) throw unprocessable(`Charge specification ${chargeSpecId} does not exist`);
        await offeringRepository.addCharge(pool, tenantId, offeringId, chargeSpecId);
    },

    async removeCharge(tenantId: string, offeringId: string, chargeSpecId: string) {
        await editableOffering(tenantId, offeringId);
        if (!(await offeringRepository.removeCharge(pool, tenantId, offeringId, chargeSpecId))) throw notFound('Charge component');
    },

    async upsertService(tenantId: string, offeringId: string, input: { service_spec_id: string; mandatory_flag: boolean; min_qty: number; max_qty: number }) {
        await editableOffering(tenantId, offeringId);
        await offeringRepository.upsertService(pool, tenantId, offeringId, input);
    },

    async removeService(tenantId: string, offeringId: string, serviceSpecId: string) {
        await editableOffering(tenantId, offeringId);
        if (!(await offeringRepository.removeService(pool, tenantId, offeringId, serviceSpecId))) throw notFound('Service component');
    },

    async upsertRate(tenantId: string, offeringId: string, input: { charge_spec_id: string; market_id: string; currency_code?: string; amount: string }) {
        await editableOffering(tenantId, offeringId);
        const market = await markets.get(pool, tenantId, input.market_id);
        if (!market) throw unprocessable(`Market ${input.market_id} does not exist`);
        if (!market.is_pricing_market) throw unprocessable(`Market ${market.market_code} is not a pricing market; set a rate on one of its pricing markets instead`);
        const currency = input.currency_code ?? market.default_currency_code;
        if (!currency) throw unprocessable(`Market ${market.market_code} has no default currency; currency_code is required`);
        const charges = await offeringRepository.charges(pool, tenantId, [offeringId]);
        if (!charges.some((c) => c.charge_spec_id === input.charge_spec_id)) {
            throw unprocessable('Attach the charge specification to the offering before pricing it');
        }
        return offeringRepository.upsertRate(pool, tenantId, offeringId, { ...input, currency_code: currency });
    },

    async removeRate(tenantId: string, offeringId: string, rateId: string) {
        await editableOffering(tenantId, offeringId);
        if (!(await offeringRepository.removeRate(pool, tenantId, offeringId, rateId))) throw notFound('Rate', rateId);
    },

    async setMarketRestriction(tenantId: string, offeringId: string, marketId: string, restriction: 'INCLUDE' | 'EXCLUDE') {
        await editableOffering(tenantId, offeringId);
        if (!(await markets.get(pool, tenantId, marketId))) throw unprocessable(`Market ${marketId} does not exist`);
        await offeringRepository.upsertMarket(pool, tenantId, offeringId, marketId, restriction);
    },

    async removeMarketRestriction(tenantId: string, offeringId: string, marketId: string) {
        await editableOffering(tenantId, offeringId);
        if (!(await offeringRepository.removeMarket(pool, tenantId, offeringId, marketId))) throw notFound('Market restriction');
    },

    async addRelationship(tenantId: string, sourceId: string, targetId: string, type: RelationshipType) {
        const source = await editableOffering(tenantId, sourceId);
        const target = await offeringRepository.get(pool, tenantId, targetId);
        if (!target) throw notFound('Target offering', targetId);
        if (target.catalogue_version_id !== source.catalogue_version_id) {
            throw unprocessable('Both offerings of a relationship must belong to the same catalogue version');
        }
        if (sourceId === targetId) throw unprocessable('An offering cannot relate to itself');
        return withTransaction(async (tx) => {
            // Serialise relationship writes per version so two concurrent inserts cannot form a cycle together.
            await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`offering_relationship:${source.catalogue_version_id}`]);
            if ((type === 'REQUIRES' || type === 'UPGRADE') && (await offeringRepository.wouldCreateCycle(tx, tenantId, sourceId, targetId))) {
                throw conflict(`Adding ${source.offering_code} ${type} ${target.offering_code} would create a circular dependency`);
            }
            return offeringRepository.addRelationship(tx, tenantId, sourceId, targetId, type);
        });
    },

    async removeRelationship(tenantId: string, sourceId: string, relationshipId: string) {
        await editableOffering(tenantId, sourceId);
        if (!(await offeringRepository.removeRelationship(pool, tenantId, sourceId, relationshipId))) throw notFound('Relationship', relationshipId);
    },

    async addPolicy(tenantId: string, offeringId: string, ruleId: string) {
        await editableOffering(tenantId, offeringId);
        await offeringRepository.addPolicy(pool, tenantId, offeringId, ruleId);
    },

    async removePolicy(tenantId: string, offeringId: string, ruleId: string) {
        await editableOffering(tenantId, offeringId);
        if (!(await offeringRepository.removePolicy(pool, tenantId, offeringId, ruleId))) throw notFound('Policy mapping');
    },

    /** Category is presentation only, so it can be changed on any version. */
    async addCategory(tenantId: string, offeringId: string, categoryId: string) {
        await this.get(tenantId, offeringId);
        await offeringRepository.addCategory(pool, tenantId, offeringId, categoryId);
    },

    async removeCategory(tenantId: string, offeringId: string, categoryId: string) {
        if (!(await offeringRepository.removeCategory(pool, tenantId, offeringId, categoryId))) throw notFound('Category mapping');
    },
};
