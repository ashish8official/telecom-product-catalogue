import type { Db } from '../db/pool';
import { formatAmount, Micros, parseAmount, percentOf } from '../domain/money';
import { notFound } from '../http/errors';
import { offeringRepository, OfferingView, PUBLISHED_VERSION_PREDICATE } from '../repositories/offeringRepository';
import { markets } from '../repositories/referenceRepository';
import { apply_charge_stacking } from './apply_charge_stacking';
import { loadMarketAncestry, resolve_market_eligibility } from './marketResolver';
import { resolve_journal } from './resolve_journal';
import { resolve_policy } from './resolve_policy';
import { resolve_tax } from './resolve_tax';

export type ResolutionSource = 'SUBSCRIBER' | 'ACCOUNT' | 'MARKET' | 'CATALOGUE_RATE';

export interface QuoteRequest {
    tenantId: string;
    offeringId: string;
    marketId: string;
    subscriberId?: string;
    accountId?: string;
    effectiveAt?: Date;
    context?: Record<string, unknown>;
}

export interface QuoteLine {
    charge_spec_id: string;
    charge_code: string;
    charge_name: string;
    charge_type: string;
    charge_period: string | null;
    calculation_type: 'FLAT' | 'PERCENTAGE';
    stacking_rule: string;
    priority: number;
    status: 'PRICED' | 'NO_RATE';
    offering_rate_id: string | null;
    rate_market_id: string | null;
    currency_code: string | null;
    catalogue_amount: string | null;
    resolved_amount: string | null;
    resolution_source: ResolutionSource | null;
    /** For PERCENTAGE charges: the subtotal the percentage was applied to. */
    percentage_base: string | null;
    net_amount: string | null;
    taxes: { tax_config_id: string; tax_name: string; tax_rate: number; fallback_level: string; tax_amount: string }[];
    tax_amount: string | null;
    gross_amount: string | null;
    journals: { gl_code: string; gl_description: string | null }[];
}

export interface Quote {
    offering: { id: string; code: string; name: string; type: string; catalogue_version_id: string; version: string; version_status: string };
    market: { id: string; code: string; name: string; timezone: string | null };
    effective_at: string;
    sellable: boolean;
    eligibility: { allowed: boolean; reason: string; decided_by_market_id: string | null };
    policy: { passed: boolean; failed_rule_ids: string[]; evaluated_rules: unknown[] };
    relationships: { type: string; target_offering_id: string; target_code: string }[];
    lines: QuoteLine[];
    totals: { currency_code: string; charge_type: string; charge_period: string | null; net: string; tax: string; gross: string }[];
    warnings: string[];
}

interface RateCandidate {
    id: string;
    market_id: string;
    currency_code: string;
    amount: string;
}

/**
 * The rate an offering charges in a market: the rate defined for that market, otherwise the rate
 * defined for its nearest ancestor (a country price applies to its cities unless overridden).
 */
async function nearestRate(db: Db, tenantId: string, offeringId: string, chargeSpecId: string, ancestry: string[]): Promise<RateCandidate | null> {
    if (ancestry.length === 0) return null;
    const res = await db.query<RateCandidate>(
        `SELECT r.id, r.market_id, r.currency_code, r.amount::text AS amount
           FROM offering_rate r
           JOIN unnest($4::uuid[]) WITH ORDINALITY AS a(market_id, depth) ON a.market_id = r.market_id
          WHERE r.tenant_id = $1 AND r.offering_id = $2 AND r.charge_spec_id = $3
          ORDER BY a.depth
          LIMIT 1`,
        [tenantId, offeringId, chargeSpecId, ancestry]
    );
    return res.rows[0] ?? null;
}

async function resolvePrice(
    db: Db,
    tenantId: string,
    rateId: string,
    subscriberId: string | undefined,
    accountId: string | undefined,
    marketId: string,
    at: Date
): Promise<{ amount: string; source: ResolutionSource }> {
    const res = await db.query(
        `SELECT (rp).amount::text AS amount, (rp).source AS source
           FROM (SELECT resolve_price($1, $2, $3, $4, $5, $6) AS rp) x`,
        [tenantId, rateId, subscriberId ?? null, accountId ?? null, marketId, at]
    );
    return res.rows[0];
}

/**
 * Full commercial resolution of one offering for one market and customer context:
 * eligibility (market restrictions, policy rules) → charge stacking → rate per charge
 * (market hierarchy) → price overrides (subscriber > account > market > catalogue) →
 * percentage charges → taxes → GL mapping. Read-only: nothing is written.
 */
export async function quoteOffering(db: Db, req: QuoteRequest): Promise<Quote> {
    const at = req.effectiveAt ?? new Date();
    const offering = await offeringRepository.get(db, req.tenantId, req.offeringId);
    if (!offering) throw notFound('Offering', req.offeringId);
    const market = await markets.get(db, req.tenantId, req.marketId);
    if (!market) throw notFound('Market', req.marketId);

    const [eligibility, policy, charges, ancestry, relationships] = await Promise.all([
        resolve_market_eligibility(db, req.tenantId, offering.id, market.id),
        resolve_policy(db, {
            tenant_id: req.tenantId,
            offering_id: offering.id,
            market_id: market.id,
            effective_at: at,
            context_json: req.context ?? {},
        }),
        apply_charge_stacking(db, { tenant_id: req.tenantId, offering_id: offering.id }),
        loadMarketAncestry(db, req.tenantId, market.id),
        offeringRepository.relationships(db, req.tenantId, [offering.id]),
    ]);

    const warnings: string[] = [];
    if (offering.version_status !== 'RELEASED') {
        warnings.push(`Offering belongs to a ${offering.version_status} catalogue version; prices are provisional`);
    }
    if (!market.is_pricing_market) warnings.push(`Market ${market.market_code} is not a pricing market`);

    const lines: QuoteLine[] = [];
    // Running subtotal per currency, so PERCENTAGE charges apply to what precedes them.
    const subtotal = new Map<string, Micros>();

    for (const charge of charges) {
        const base: QuoteLine = {
            charge_spec_id: charge.id,
            charge_code: charge.charge_code,
            charge_name: charge.charge_name,
            charge_type: charge.charge_type,
            charge_period: charge.charge_period,
            calculation_type: charge.calculation_type,
            stacking_rule: charge.stacking_rule,
            priority: charge.charge_priority,
            status: 'NO_RATE',
            offering_rate_id: null,
            rate_market_id: null,
            currency_code: null,
            catalogue_amount: null,
            resolved_amount: null,
            resolution_source: null,
            percentage_base: null,
            net_amount: null,
            taxes: [],
            tax_amount: null,
            gross_amount: null,
            journals: [],
        };

        const rate = await nearestRate(db, req.tenantId, offering.id, charge.id, ancestry);
        if (!rate) {
            warnings.push(`Charge ${charge.charge_code} has no rate for market ${market.market_code} or its parents`);
            lines.push(base);
            continue;
        }

        const resolved = await resolvePrice(db, req.tenantId, rate.id, req.subscriberId, req.accountId, market.id, at);
        const resolvedMicros = parseAmount(resolved.amount);
        let net: Micros = resolvedMicros;
        let percentageBase: Micros | null = null;
        if (charge.calculation_type === 'PERCENTAGE') {
            percentageBase = subtotal.get(rate.currency_code) ?? 0n;
            net = percentOf(percentageBase, resolvedMicros);
        }
        subtotal.set(rate.currency_code, (subtotal.get(rate.currency_code) ?? 0n) + net);

        const [taxes, journals] = await Promise.all([
            resolve_tax(db, req.tenantId, charge.id, market.id),
            resolve_journal(db, req.tenantId, charge.id),
        ]);
        let taxTotal: Micros = 0n;
        const taxLines = taxes.map((t) => {
            const amount = percentOf(net, parseAmount(String(t.tax_rate)));
            taxTotal += amount;
            return { tax_config_id: t.tax_config_id, tax_name: t.tax_name, tax_rate: t.tax_rate, fallback_level: t.fallback_level, tax_amount: formatAmount(amount) };
        });

        lines.push({
            ...base,
            status: 'PRICED',
            offering_rate_id: rate.id,
            rate_market_id: rate.market_id,
            currency_code: rate.currency_code,
            catalogue_amount: rate.amount,
            resolved_amount: resolved.amount,
            resolution_source: resolved.source,
            percentage_base: percentageBase === null ? null : formatAmount(percentageBase),
            net_amount: formatAmount(net),
            taxes: taxLines,
            tax_amount: formatAmount(taxTotal),
            gross_amount: formatAmount(net + taxTotal),
            journals: journals.map((j) => ({ gl_code: j.gl_code, gl_description: j.gl_description })),
        });
    }

    const totalsMap = new Map<string, { currency_code: string; charge_type: string; charge_period: string | null; net: Micros; tax: Micros }>();
    for (const line of lines) {
        if (line.status !== 'PRICED' || !line.currency_code) continue;
        const key = `${line.currency_code}|${line.charge_type}|${line.charge_period ?? ''}`;
        const entry = totalsMap.get(key) ?? { currency_code: line.currency_code, charge_type: line.charge_type, charge_period: line.charge_period, net: 0n, tax: 0n };
        entry.net += parseAmount(line.net_amount!);
        entry.tax += parseAmount(line.tax_amount!);
        totalsMap.set(key, entry);
    }

    const sellable = eligibility.allowed && policy.passed && lines.length > 0 && lines.every((l) => l.status === 'PRICED');

    return {
        offering: summarise(offering),
        market: { id: market.id, code: market.market_code, name: market.market_name, timezone: market.timezone },
        effective_at: at.toISOString(),
        sellable,
        eligibility,
        policy,
        relationships: relationships.map((r) => ({ type: r.relationship_type, target_offering_id: r.target_offering_id, target_code: r.target_code })),
        lines,
        totals: [...totalsMap.values()].map((t) => ({
            currency_code: t.currency_code,
            charge_type: t.charge_type,
            charge_period: t.charge_period,
            net: formatAmount(t.net),
            tax: formatAmount(t.tax),
            gross: formatAmount(t.net + t.tax),
        })),
        warnings,
    };
}

function summarise(o: OfferingView) {
    return {
        id: o.id,
        code: o.offering_code,
        name: o.offering_name,
        type: o.offering_type,
        catalogue_version_id: o.catalogue_version_id,
        version: o.version,
        version_status: o.version_status,
    };
}

// ---- price listing (ProductOfferingPrice) ---------------------------------------------------------

export interface ResolvedRate {
    id: string;
    tenant_id: string;
    offering_id: string;
    offering_name: string;
    charge_spec_id: string;
    charge_code: string;
    charge_name: string;
    calculation_type: 'FLAT' | 'PERCENTAGE';
    charge_type: 'RECURRING' | 'ONE_TIME' | 'USAGE';
    charge_period: string | null;
    market_id: string;
    market_code: string;
    market_name: string;
    currency_code: string;
    catalogue_amount: string;
    amount: string;
    resolution_source: ResolutionSource;
    version_status: string;
    valid_from: Date | null;
    valid_to: Date | null;
    updated_at: Date;
}

export interface PriceQuery {
    tenantId: string;
    subscriberId?: string;
    accountId?: string;
    /** When set, returns the rate that applies in this market (its own or its nearest ancestor's). */
    marketId?: string;
    effectiveAt?: Date;
    offeringId?: string;
    /** Restrict to one catalogue version; otherwise only published (released, in force) versions. */
    versionId?: string;
    rateId?: string;
    /** Default true. False uses marketId only as override context, without filtering rates by market. */
    filterByMarket?: boolean;
    limit?: number;
    offset?: number;
}

export async function listResolvedRates(db: Db, q: PriceQuery): Promise<{ rows: ResolvedRate[]; total: number }> {
    const at = q.effectiveAt ?? new Date();
    const params: any[] = [q.tenantId, q.subscriberId ?? null, q.accountId ?? null, q.marketId ?? null, at];
    const where = ['r.tenant_id = $1'];
    const add = (value: unknown, sql: (p: string) => string) => {
        params.push(value);
        where.push(sql(`$${params.length}`));
    };
    if (q.offeringId) add(q.offeringId, (p) => `r.offering_id = ${p}`);
    if (q.rateId) add(q.rateId, (p) => `r.id = ${p}`);
    if (q.versionId) add(q.versionId, (p) => `po.catalogue_version_id = ${p}`);
    else if (!q.rateId) where.push(PUBLISHED_VERSION_PREDICATE('v', '$1', '$5::timestamptz'));

    // With a market, keep only the nearest-ancestor rate per offering + charge.
    const filterByMarket = Boolean(q.marketId) && q.filterByMarket !== false;
    const marketJoin = filterByMarket
        ? `JOIN market_ancestry($1, $4::text::uuid) anc ON anc.market_id = r.market_id`
        : '';
    const distinct = filterByMarket ? 'DISTINCT ON (r.offering_id, r.charge_spec_id)' : '';
    const order = filterByMarket ? 'r.offering_id, r.charge_spec_id, anc.depth' : 'po.offering_name, cs.charge_priority, cs.charge_code, m.market_code';

    const base = `
        FROM offering_rate r
        JOIN product_offering po ON po.tenant_id = r.tenant_id AND po.id = r.offering_id
        JOIN catalogue_version v ON v.tenant_id = po.tenant_id AND v.id = po.catalogue_version_id
        JOIN charge_specification cs ON cs.tenant_id = r.tenant_id AND cs.id = r.charge_spec_id
        JOIN market_master m ON m.tenant_id = r.tenant_id AND m.id = r.market_id
        ${marketJoin}
        WHERE ${where.join(' AND ')}`;

    const limit = Math.min(q.limit ?? 100, 1000);
    const offset = q.offset ?? 0;

    const [rows, count] = await Promise.all([
        db.query(
            `SELECT * FROM (
                SELECT ${distinct}
                       r.id, r.tenant_id, r.offering_id, po.offering_name, r.charge_spec_id, cs.charge_code, cs.charge_name,
                       cs.calculation_type, cs.charge_type, cs.charge_period, r.market_id, m.market_code, m.market_name,
                       r.currency_code, r.amount::text AS catalogue_amount,
                       (rp).amount::text AS amount, (rp).source AS resolution_source,
                       v.status AS version_status, v.valid_from, v.valid_to, r.updated_at,
                       cs.charge_priority
                  ${base.replace('WHERE', `CROSS JOIN LATERAL (SELECT resolve_price($1, r.id, $2, $3, COALESCE($4::text, r.market_id::text), $5::timestamptz) AS rp) x\n WHERE`)}
                 ORDER BY ${order}
             ) priced
             ORDER BY offering_name, charge_priority, charge_code, market_code
             LIMIT ${limit} OFFSET ${offset}`,
            params
        ),
        db.query(
            // The typed dummy row gives every bind parameter a type even where the count does not use it.
            `SELECT count(*)::int AS n
               FROM (SELECT $2::text, $3::text, $4::text, $5::timestamptz) _types,
                    LATERAL (SELECT ${distinct} r.id ${base} ORDER BY ${order}) c`,
            params
        ),
    ]);
    return { rows: rows.rows, total: count.rows[0].n };
}
