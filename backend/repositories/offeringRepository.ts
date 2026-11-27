import type { Db } from '../db/pool';
import type { CatalogueStatus } from './catalogueRepository';

export type OfferingType = 'BASE' | 'ADDON' | 'BUNDLE' | 'STANDALONE';
export type ServiceType = 'PREPAID' | 'POSTPAID' | 'BOTH';
export type RelationshipType = 'REQUIRES' | 'EXCLUDES' | 'UPGRADE';

export interface OfferingRow {
    id: string;
    tenant_id: string;
    catalogue_version_id: string;
    product_specification_id: string;
    offering_code: string;
    offering_name: string;
    offering_type: OfferingType;
    service_type: ServiceType;
    created_at: Date;
    updated_at: Date;
}

/** An offering together with the version and specification facts every reader needs. */
export interface OfferingView extends OfferingRow {
    catalogue_id: string;
    catalogue_name: string;
    version: string;
    version_status: CatalogueStatus;
    version_valid_from: Date | null;
    version_valid_to: Date | null;
    spec_code: string;
    spec_name: string;
}

export interface OfferingQuery {
    versionId?: string;
    /** Only offerings in the catalogue version that is RELEASED and in force at this instant. */
    publishedAt?: Date;
    productSpecificationId?: string;
    name?: string;
    offeringIds?: string[];
    limit?: number;
    offset?: number;
}

const OFFERING_VIEW = `
    SELECT po.*, v.catalogue_id, c.name AS catalogue_name, v.version, v.status AS version_status,
           v.valid_from AS version_valid_from, v.valid_to AS version_valid_to,
           ps.spec_code, ps.spec_name
      FROM product_offering po
      JOIN catalogue_version v ON v.tenant_id = po.tenant_id AND v.id = po.catalogue_version_id
      JOIN catalogue c ON c.tenant_id = v.tenant_id AND c.id = v.catalogue_id
      JOIN product_specification ps ON ps.tenant_id = po.tenant_id AND ps.id = po.product_specification_id`;

/**
 * SQL predicate selecting, per catalogue, the single RELEASED version in force at $at:
 * the latest valid_from that has started and has not ended. Superseded versions drop out
 * automatically when a newer version's valid_from passes, without being edited.
 */
export const PUBLISHED_VERSION_PREDICATE = (alias: string, tenantParam: string, atParam: string) => `
    ${alias}.id = (
        SELECT pv.id FROM catalogue_version pv
         WHERE pv.tenant_id = ${tenantParam} AND pv.catalogue_id = ${alias}.catalogue_id
           AND pv.status = 'RELEASED'
           AND (pv.valid_from IS NULL OR pv.valid_from <= ${atParam})
           AND (pv.valid_to IS NULL OR pv.valid_to > ${atParam})
         ORDER BY pv.valid_from DESC NULLS LAST, pv.created_at DESC
         LIMIT 1)`;

function buildFilter(tenantId: string, q: OfferingQuery) {
    const where = ['po.tenant_id = $1'];
    const params: any[] = [tenantId];
    const add = (sql: (p: string) => string, value: unknown) => {
        params.push(value);
        where.push(sql(`$${params.length}`));
    };
    if (q.versionId) add((p) => `po.catalogue_version_id = ${p}`, q.versionId);
    if (q.publishedAt) {
        params.push(q.publishedAt);
        where.push(PUBLISHED_VERSION_PREDICATE('v', '$1', `$${params.length}::timestamptz`));
    }
    if (q.productSpecificationId) add((p) => `po.product_specification_id = ${p}`, q.productSpecificationId);
    if (q.name) add((p) => `po.offering_name ILIKE ${p}`, `%${q.name.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    if (q.offeringIds) add((p) => `po.id = ANY(${p}::uuid[])`, q.offeringIds);
    return { where: where.join(' AND '), params };
}

export const offeringRepository = {
    async list(db: Db, tenantId: string, q: OfferingQuery = {}): Promise<{ rows: OfferingView[]; total: number }> {
        const { where, params } = buildFilter(tenantId, q);
        const limit = q.limit ?? 1000;
        const offset = q.offset ?? 0;
        const [rows, count] = await Promise.all([
            db.query(`${OFFERING_VIEW} WHERE ${where} ORDER BY c.name, po.offering_name, po.id LIMIT ${limit} OFFSET ${offset}`, params),
            db.query(
                `SELECT count(*)::int AS n FROM product_offering po
                   JOIN catalogue_version v ON v.tenant_id = po.tenant_id AND v.id = po.catalogue_version_id
                  WHERE ${where}`,
                params
            ),
        ]);
        return { rows: rows.rows, total: count.rows[0].n };
    },

    async get(db: Db, tenantId: string, id: string): Promise<OfferingView | null> {
        const res = await db.query(`${OFFERING_VIEW} WHERE po.tenant_id = $1 AND po.id = $2`, [tenantId, id]);
        return res.rows[0] ?? null;
    },

    async create(
        db: Db,
        tenantId: string,
        input: Pick<OfferingRow, 'catalogue_version_id' | 'product_specification_id' | 'offering_code' | 'offering_name' | 'offering_type' | 'service_type'>
    ): Promise<OfferingRow> {
        const res = await db.query(
            `INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [tenantId, input.catalogue_version_id, input.product_specification_id, input.offering_code, input.offering_name, input.offering_type, input.service_type]
        );
        return res.rows[0];
    },

    async update(
        db: Db,
        tenantId: string,
        id: string,
        input: Partial<Pick<OfferingRow, 'product_specification_id' | 'offering_name' | 'offering_type' | 'service_type'>>
    ): Promise<OfferingRow | null> {
        const res = await db.query(
            `UPDATE product_offering
                SET product_specification_id = COALESCE($3, product_specification_id),
                    offering_name = COALESCE($4, offering_name),
                    offering_type = COALESCE($5, offering_type),
                    service_type  = COALESCE($6, service_type)
              WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
            [tenantId, id, input.product_specification_id ?? null, input.offering_name ?? null, input.offering_type ?? null, input.service_type ?? null]
        );
        return res.rows[0] ?? null;
    },

    async remove(db: Db, tenantId: string, id: string): Promise<boolean> {
        const res = await db.query('DELETE FROM product_offering WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        return (res.rowCount ?? 0) > 0;
    },

    // ---- components -----------------------------------------------------------------------------

    async charges(db: Db, tenantId: string, offeringIds: string[]) {
        const res = await db.query(
            `SELECT occ.offering_id, cs.id AS charge_spec_id, cs.charge_code, cs.charge_name, cs.charge_priority,
                    cs.stacking_rule, cs.calculation_type, cs.charge_type, cs.charge_period
               FROM offering_charge_component occ
               JOIN charge_specification cs ON cs.tenant_id = occ.tenant_id AND cs.id = occ.charge_spec_id
              WHERE occ.tenant_id = $1 AND occ.offering_id = ANY($2::uuid[])
              ORDER BY cs.charge_priority, cs.id`,
            [tenantId, offeringIds]
        );
        return res.rows;
    },

    async addCharge(db: Db, tenantId: string, offeringId: string, chargeSpecId: string) {
        await db.query(
            `INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id) VALUES ($1, $2, $3)`,
            [tenantId, offeringId, chargeSpecId]
        );
    },

    async removeCharge(db: Db, tenantId: string, offeringId: string, chargeSpecId: string): Promise<boolean> {
        const res = await db.query(
            'DELETE FROM offering_charge_component WHERE tenant_id = $1 AND offering_id = $2 AND charge_spec_id = $3',
            [tenantId, offeringId, chargeSpecId]
        );
        return (res.rowCount ?? 0) > 0;
    },

    async services(db: Db, tenantId: string, offeringIds: string[]) {
        const res = await db.query(
            `SELECT osc.offering_id, osc.id, ss.id AS service_spec_id, ss.spec_code, ss.spec_name,
                    osc.mandatory_flag, osc.min_qty, osc.max_qty
               FROM offering_service_component osc
               JOIN service_specification ss ON ss.tenant_id = osc.tenant_id AND ss.id = osc.service_spec_id
              WHERE osc.tenant_id = $1 AND osc.offering_id = ANY($2::uuid[])
              ORDER BY ss.spec_code`,
            [tenantId, offeringIds]
        );
        return res.rows;
    },

    async upsertService(
        db: Db,
        tenantId: string,
        offeringId: string,
        input: { service_spec_id: string; mandatory_flag: boolean; min_qty: number; max_qty: number }
    ) {
        await db.query(
            `INSERT INTO offering_service_component (tenant_id, offering_id, service_spec_id, mandatory_flag, min_qty, max_qty)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, offering_id, service_spec_id)
             DO UPDATE SET mandatory_flag = EXCLUDED.mandatory_flag, min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty`,
            [tenantId, offeringId, input.service_spec_id, input.mandatory_flag, input.min_qty, input.max_qty]
        );
    },

    async removeService(db: Db, tenantId: string, offeringId: string, serviceSpecId: string): Promise<boolean> {
        const res = await db.query(
            'DELETE FROM offering_service_component WHERE tenant_id = $1 AND offering_id = $2 AND service_spec_id = $3',
            [tenantId, offeringId, serviceSpecId]
        );
        return (res.rowCount ?? 0) > 0;
    },

    // ---- rates ------------------------------------------------------------------------------------

    async rates(db: Db, tenantId: string, offeringIds: string[]) {
        const res = await db.query(
            `SELECT r.id, r.offering_id, r.charge_spec_id, cs.charge_code, r.market_id, m.market_code, m.market_name,
                    r.currency_code, r.amount::text AS amount, r.updated_at,
                    (SELECT count(*)::int FROM price_override o WHERE o.tenant_id = r.tenant_id AND o.offering_rate_id = r.id) AS override_count
               FROM offering_rate r
               JOIN charge_specification cs ON cs.tenant_id = r.tenant_id AND cs.id = r.charge_spec_id
               JOIN market_master m ON m.tenant_id = r.tenant_id AND m.id = r.market_id
              WHERE r.tenant_id = $1 AND r.offering_id = ANY($2::uuid[])
              ORDER BY cs.charge_priority, cs.charge_code, m.market_code`,
            [tenantId, offeringIds]
        );
        return res.rows;
    },

    async upsertRate(
        db: Db,
        tenantId: string,
        offeringId: string,
        input: { charge_spec_id: string; market_id: string; currency_code: string; amount: string }
    ) {
        const res = await db.query(
            `INSERT INTO offering_rate (tenant_id, offering_id, charge_spec_id, market_id, currency_code, amount)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, offering_id, charge_spec_id, market_id)
             DO UPDATE SET currency_code = EXCLUDED.currency_code, amount = EXCLUDED.amount
             RETURNING id`,
            [tenantId, offeringId, input.charge_spec_id, input.market_id, input.currency_code, input.amount]
        );
        return res.rows[0].id as string;
    },

    async removeRate(db: Db, tenantId: string, offeringId: string, rateId: string): Promise<boolean> {
        const res = await db.query('DELETE FROM offering_rate WHERE tenant_id = $1 AND offering_id = $2 AND id = $3', [tenantId, offeringId, rateId]);
        return (res.rowCount ?? 0) > 0;
    },

    // ---- market restrictions -----------------------------------------------------------------------

    async markets(db: Db, tenantId: string, offeringIds: string[]) {
        const res = await db.query(
            `SELECT omm.offering_id, omm.id, omm.market_id, m.market_code, m.market_name, omm.restriction
               FROM offering_market_mapping omm
               JOIN market_master m ON m.tenant_id = omm.tenant_id AND m.id = omm.market_id
              WHERE omm.tenant_id = $1 AND omm.offering_id = ANY($2::uuid[])
              ORDER BY m.market_code`,
            [tenantId, offeringIds]
        );
        return res.rows;
    },

    async upsertMarket(db: Db, tenantId: string, offeringId: string, marketId: string, restriction: 'INCLUDE' | 'EXCLUDE') {
        await db.query(
            `INSERT INTO offering_market_mapping (tenant_id, offering_id, market_id, restriction)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, offering_id, market_id) DO UPDATE SET restriction = EXCLUDED.restriction`,
            [tenantId, offeringId, marketId, restriction]
        );
    },

    async removeMarket(db: Db, tenantId: string, offeringId: string, marketId: string): Promise<boolean> {
        const res = await db.query(
            'DELETE FROM offering_market_mapping WHERE tenant_id = $1 AND offering_id = $2 AND market_id = $3',
            [tenantId, offeringId, marketId]
        );
        return (res.rowCount ?? 0) > 0;
    },

    // ---- relationships ------------------------------------------------------------------------------

    async relationships(db: Db, tenantId: string, offeringIds: string[]) {
        const res = await db.query(
            `SELECT r.id, r.source_offering_id, r.target_offering_id, r.relationship_type,
                    t.offering_code AS target_code, t.offering_name AS target_name
               FROM offering_relationship r
               JOIN product_offering t ON t.tenant_id = r.tenant_id AND t.id = r.target_offering_id
              WHERE r.tenant_id = $1 AND r.source_offering_id = ANY($2::uuid[])
              ORDER BY r.relationship_type, t.offering_code`,
            [tenantId, offeringIds]
        );
        return res.rows;
    },

    async wouldCreateCycle(db: Db, tenantId: string, sourceId: string, targetId: string): Promise<boolean> {
        const res = await db.query('SELECT check_offering_relationship_cycle($1, $2, $3) AS cycle', [tenantId, sourceId, targetId]);
        return res.rows[0].cycle === true;
    },

    async addRelationship(db: Db, tenantId: string, sourceId: string, targetId: string, type: RelationshipType): Promise<string> {
        const res = await db.query(
            `INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [tenantId, sourceId, targetId, type]
        );
        return res.rows[0].id;
    },

    async removeRelationship(db: Db, tenantId: string, sourceId: string, relationshipId: string): Promise<boolean> {
        const res = await db.query(
            'DELETE FROM offering_relationship WHERE tenant_id = $1 AND source_offering_id = $2 AND id = $3',
            [tenantId, sourceId, relationshipId]
        );
        return (res.rowCount ?? 0) > 0;
    },

    // ---- policies and categories ----------------------------------------------------------------------

    async policies(db: Db, tenantId: string, offeringIds: string[]) {
        const res = await db.query(
            `SELECT pm.product_offering_id AS offering_id, pr.id AS policy_rule_id, pr.rule_json, ps.schema_name, ps.version AS schema_version
               FROM policy_mapping pm
               JOIN policy_rule pr ON pr.tenant_id = pm.tenant_id AND pr.id = pm.policy_rule_id
               JOIN policy_schema ps ON ps.tenant_id = pr.tenant_id AND ps.id = pr.schema_id
              WHERE pm.tenant_id = $1 AND pm.product_offering_id = ANY($2::uuid[])
              ORDER BY ps.schema_name, pr.id`,
            [tenantId, offeringIds]
        );
        return res.rows;
    },

    async addPolicy(db: Db, tenantId: string, offeringId: string, ruleId: string) {
        await db.query(
            'INSERT INTO policy_mapping (tenant_id, product_offering_id, policy_rule_id) VALUES ($1, $2, $3)',
            [tenantId, offeringId, ruleId]
        );
    },

    async removePolicy(db: Db, tenantId: string, offeringId: string, ruleId: string): Promise<boolean> {
        const res = await db.query(
            'DELETE FROM policy_mapping WHERE tenant_id = $1 AND product_offering_id = $2 AND policy_rule_id = $3',
            [tenantId, offeringId, ruleId]
        );
        return (res.rowCount ?? 0) > 0;
    },

    async categories(db: Db, tenantId: string, offeringIds: string[]) {
        const res = await db.query(
            `SELECT ocm.product_offering_id AS offering_id, oc.id AS category_id, oc.name
               FROM offering_category_mapping ocm
               JOIN offering_category oc ON oc.tenant_id = ocm.tenant_id AND oc.id = ocm.category_id
              WHERE ocm.tenant_id = $1 AND ocm.product_offering_id = ANY($2::uuid[])
              ORDER BY oc.name`,
            [tenantId, offeringIds]
        );
        return res.rows;
    },

    async addCategory(db: Db, tenantId: string, offeringId: string, categoryId: string) {
        await db.query(
            `INSERT INTO offering_category_mapping (tenant_id, product_offering_id, category_id) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [tenantId, offeringId, categoryId]
        );
    },

    async removeCategory(db: Db, tenantId: string, offeringId: string, categoryId: string): Promise<boolean> {
        const res = await db.query(
            'DELETE FROM offering_category_mapping WHERE tenant_id = $1 AND product_offering_id = $2 AND category_id = $3',
            [tenantId, offeringId, categoryId]
        );
        return (res.rowCount ?? 0) > 0;
    },
};
