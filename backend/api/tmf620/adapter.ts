import { badRequest } from '../../http/errors';
import type { CatalogueStatus, CatalogueSummary, VersionSummary } from '../../repositories/catalogueRepository';
import type { OfferingView } from '../../repositories/offeringRepository';
import type { ProductSpecificationRow } from '../../repositories/referenceRepository';
import type { ResolvedRate } from '../../services/pricingService';
import { toNumber, parseAmount } from '../../domain/money';
import type {
    ProductOfferingRelationship,
    ProductOfferingWrite,
    ProductSpecificationWrite,
    TMFCatalog,
    TMFCategory,
    TMFProductOffering,
    TMFProductOfferingPrice,
    TMFProductSpecification,
} from './types';

/**
 * Translation only. Every function here maps between the internal model and TMF620 JSON and
 * contains no business rules; those live in the services. Internal field names (tenant_id,
 * *_code, catalogue_version_id, offering_type ...) are never copied onto TMF resources.
 */

const iso = (d: Date | string | null | undefined): string | undefined => (d ? new Date(d).toISOString() : undefined);
const period = (from: Date | string | null | undefined, to: Date | string | null | undefined) => {
    const p = { startDateTime: iso(from), endDateTime: iso(to) };
    return p.startDateTime || p.endDateTime ? JSON.parse(JSON.stringify(p)) : undefined;
};

// Catalogue version status → TMF620 lifecycleStatus (recommended values from the TMF620 guide).
const OFFERING_LIFECYCLE: Record<CatalogueStatus, string> = {
    DRAFT: 'In design',
    APPROVED: 'In test',
    RELEASED: 'Launched',
    RETIRED: 'Retired',
};

// product_specification.status ↔ TMF lifecycleStatus
const SPEC_TO_TMF: Record<string, string> = { DRAFT: 'In design', ACTIVE: 'Active', RETIRED: 'Retired', OBSOLETE: 'Obsolete' };
const TMF_TO_SPEC: Record<string, ProductSpecificationRow['status']> = {
    'in study': 'DRAFT',
    'in design': 'DRAFT',
    'in test': 'DRAFT',
    draft: 'DRAFT',
    active: 'ACTIVE',
    launched: 'ACTIVE',
    retired: 'RETIRED',
    obsolete: 'OBSOLETE',
    rejected: 'OBSOLETE',
};

const RELATIONSHIP_TYPE: Record<string, string> = { REQUIRES: 'requires', EXCLUDES: 'excludes', UPGRADE: 'upgradeTo' };
const PERIOD: Record<string, string> = { DAY: 'day', WEEK: 'week', MONTH: 'month', QUARTER: 'month', YEAR: 'year' };
const PERIOD_LENGTH: Record<string, number> = { DAY: 1, WEEK: 1, MONTH: 1, QUARTER: 3, YEAR: 1 };

export const BASE_PATH = '/productCatalogManagement/v5';

export class TMF620Adapter {
    constructor(private readonly baseUrl: string) {}

    private href(resource: string, id: string): string {
        return `${this.baseUrl}${BASE_PATH}/${resource}/${id}`;
    }

    toProductSpecification(row: ProductSpecificationRow): TMFProductSpecification {
        return {
            id: row.id,
            href: this.href('productSpecification', row.id),
            '@type': 'ProductSpecification',
            name: row.spec_name,
            lifecycleStatus: SPEC_TO_TMF[row.status] ?? row.status,
            lastUpdate: iso(row.updated_at),
            validFor: period(row.effective_from, row.effective_to) ?? {},
        };
    }

    toProductOffering(
        row: OfferingView,
        extras: {
            priceIds?: { id: string; name: string }[];
            relationships?: { target_offering_id: string; target_name: string; relationship_type: string }[];
            categories?: { category_id: string; name: string }[];
        } = {}
    ): TMFProductOffering {
        const offering: TMFProductOffering = {
            id: row.id,
            href: this.href('productOffering', row.id),
            '@type': 'ProductOffering',
            name: row.offering_name,
            version: row.version,
            lifecycleStatus: OFFERING_LIFECYCLE[row.version_status] ?? row.version_status,
            isBundle: row.offering_type === 'BUNDLE',
            isSellable: row.version_status === 'RELEASED',
            lastUpdate: iso(row.updated_at),
            validFor: period(row.version_valid_from, row.version_valid_to),
            productSpecification: {
                id: row.product_specification_id,
                href: this.href('productSpecification', row.product_specification_id),
                name: row.spec_name,
                '@referredType': 'ProductSpecification',
            },
        };
        if (extras.priceIds) {
            offering.productOfferingPrice = extras.priceIds.map((p) => ({
                id: p.id,
                href: this.href('productOfferingPrice', p.id),
                name: p.name,
                '@referredType': 'ProductOfferingPrice',
            }));
        }
        if (extras.relationships) {
            offering.productOfferingRelationship = extras.relationships.map(
                (r): ProductOfferingRelationship => ({
                    id: r.target_offering_id,
                    href: this.href('productOffering', r.target_offering_id),
                    name: r.target_name,
                    relationshipType: RELATIONSHIP_TYPE[r.relationship_type] ?? r.relationship_type.toLowerCase(),
                    '@referredType': 'ProductOffering',
                })
            );
        }
        if (extras.categories) {
            offering.category = extras.categories.map((c) => ({
                id: c.category_id,
                href: this.href('category', c.category_id),
                name: c.name,
                '@referredType': 'Category',
            }));
        }
        return offering;
    }

    toProductOfferingPrice(row: ResolvedRate): TMFProductOfferingPrice {
        const priceType = row.charge_type === 'RECURRING' ? 'recurring' : row.charge_type === 'USAGE' ? 'usage' : 'oneTime';
        const value = toNumber(parseAmount(row.amount));
        const pop: TMFProductOfferingPrice = {
            id: row.id,
            href: this.href('productOfferingPrice', row.id),
            '@type': 'ProductOfferingPrice',
            name: `${row.offering_name} - ${row.charge_name} (${row.market_name})`,
            description: row.charge_name,
            lifecycleStatus: OFFERING_LIFECYCLE[row.version_status as CatalogueStatus] ?? row.version_status,
            lastUpdate: iso(row.updated_at),
            priceType,
            validFor: period(row.valid_from, row.valid_to),
            // Markets are not served by this API, so the place reference carries no href.
            place: [{ id: row.market_id, name: row.market_name, '@referredType': 'GeographicSite' }],
            priceResolution: { source: row.resolution_source, catalogueValue: toNumber(parseAmount(row.catalogue_amount)) },
        };
        if (row.calculation_type === 'PERCENTAGE') pop.percentage = value;
        else pop.price = { unit: row.currency_code, value };
        if (priceType === 'recurring' && row.charge_period) {
            pop.recurringChargePeriodType = PERIOD[row.charge_period];
            pop.recurringChargePeriodLength = PERIOD_LENGTH[row.charge_period];
        }
        return pop;
    }

    toCatalog(catalogue: CatalogueSummary | { id: string; name: string; description: string | null; updated_at: Date }, version?: VersionSummary | null): TMFCatalog {
        return {
            id: catalogue.id,
            href: this.href('catalog', catalogue.id),
            '@type': 'Catalog',
            catalogType: 'productCatalog',
            name: catalogue.name,
            description: catalogue.description ?? undefined,
            version: version?.version,
            lifecycleStatus: version ? OFFERING_LIFECYCLE[version.status] : 'In design',
            lastUpdate: iso(catalogue.updated_at),
            validFor: version ? period(version.valid_from, version.valid_to) : undefined,
        };
    }

    toCategory(row: { id: string; name: string; parent_category_id: string | null; updated_at: Date }): TMFCategory {
        return {
            id: row.id,
            href: this.href('category', row.id),
            '@type': 'Category',
            name: row.name,
            isRoot: !row.parent_category_id,
            parentId: row.parent_category_id ?? undefined,
            lifecycleStatus: 'Active',
            lastUpdate: iso(row.updated_at),
        };
    }

    // ---- inbound ---------------------------------------------------------------------------------

    static fromProductSpecification(body: ProductSpecificationWrite, mode: 'create' | 'patch') {
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Request body must be a JSON object');
        const out: { spec_name?: string; status?: ProductSpecificationRow['status']; effective_from?: Date; effective_to?: Date | null } = {};
        if (body.name !== undefined) {
            if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 255) throw badRequest('name must be a non-empty string of at most 255 characters');
            out.spec_name = body.name.trim();
        } else if (mode === 'create') {
            throw badRequest('name is required');
        }
        if (body.lifecycleStatus !== undefined) {
            const status = typeof body.lifecycleStatus === 'string' ? TMF_TO_SPEC[body.lifecycleStatus.toLowerCase()] : undefined;
            if (!status) throw badRequest(`lifecycleStatus "${body.lifecycleStatus}" is not supported`, { supported: Object.keys(TMF_TO_SPEC) });
            out.status = status;
        }
        if (body.validFor !== undefined) {
            const parse = (v: unknown, label: string) => {
                const d = new Date(String(v));
                if (Number.isNaN(d.getTime())) throw badRequest(`validFor.${label} must be an ISO-8601 date-time`);
                return d;
            };
            if (body.validFor?.startDateTime) out.effective_from = parse(body.validFor.startDateTime, 'startDateTime');
            if (body.validFor && 'endDateTime' in body.validFor) {
                out.effective_to = body.validFor.endDateTime ? parse(body.validFor.endDateTime, 'endDateTime') : null;
            }
        }
        return out;
    }

    static fromProductOffering(body: ProductOfferingWrite, mode: 'create' | 'patch') {
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Request body must be a JSON object');
        const out: { offering_name?: string; product_specification_id?: string; offering_type?: 'BUNDLE' | 'BASE' } = {};
        if (body.name !== undefined) {
            if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 255) throw badRequest('name must be a non-empty string of at most 255 characters');
            out.offering_name = body.name.trim();
        } else if (mode === 'create') {
            throw badRequest('name is required');
        }
        if (body.productSpecification !== undefined) {
            if (!body.productSpecification || typeof body.productSpecification.id !== 'string') throw badRequest('productSpecification.id is required');
            out.product_specification_id = body.productSpecification.id;
        } else if (mode === 'create') {
            throw badRequest('productSpecification.id is required');
        }
        if (body.isBundle !== undefined) {
            if (typeof body.isBundle !== 'boolean') throw badRequest('isBundle must be a boolean');
            out.offering_type = body.isBundle ? 'BUNDLE' : 'BASE';
        }
        return out;
    }
}
