import type { Db } from '../db/pool';

export type CatalogueStatus = 'DRAFT' | 'APPROVED' | 'RELEASED' | 'RETIRED';

export interface CatalogueRow {
    id: string;
    tenant_id: string;
    name: string;
    description: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface CatalogueVersionRow {
    id: string;
    tenant_id: string;
    catalogue_id: string;
    version: string;
    status: CatalogueStatus;
    valid_from: Date | null;
    valid_to: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface CatalogueSummary extends CatalogueRow {
    version_count: number;
    released_version_id: string | null;
    released_version: string | null;
    draft_count: number;
}

export interface VersionSummary extends CatalogueVersionRow {
    catalogue_name: string;
    offering_count: number;
}

export const catalogueRepository = {
    async listCatalogues(db: Db, tenantId: string): Promise<CatalogueSummary[]> {
        const res = await db.query(
            `SELECT c.*,
                    (SELECT count(*)::int FROM catalogue_version v WHERE v.tenant_id = c.tenant_id AND v.catalogue_id = c.id) AS version_count,
                    (SELECT count(*)::int FROM catalogue_version v WHERE v.tenant_id = c.tenant_id AND v.catalogue_id = c.id AND v.status = 'DRAFT') AS draft_count,
                    rv.id AS released_version_id,
                    rv.version AS released_version
               FROM catalogue c
               LEFT JOIN LATERAL (
                    SELECT v.id, v.version
                      FROM catalogue_version v
                     WHERE v.tenant_id = c.tenant_id AND v.catalogue_id = c.id AND v.status = 'RELEASED'
                       AND (v.valid_from IS NULL OR v.valid_from <= NOW())
                       AND (v.valid_to IS NULL OR v.valid_to > NOW())
                     ORDER BY v.valid_from DESC NULLS LAST, v.created_at DESC
                     LIMIT 1
               ) rv ON TRUE
              WHERE c.tenant_id = $1
              ORDER BY c.name, c.created_at`,
            [tenantId]
        );
        return res.rows;
    },

    async getCatalogue(db: Db, tenantId: string, id: string): Promise<CatalogueRow | null> {
        const res = await db.query('SELECT * FROM catalogue WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        return res.rows[0] ?? null;
    },

    async createCatalogue(db: Db, tenantId: string, input: { name: string; description?: string | null }): Promise<CatalogueRow> {
        const res = await db.query(
            'INSERT INTO catalogue (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *',
            [tenantId, input.name, input.description ?? null]
        );
        return res.rows[0];
    },

    async updateCatalogue(db: Db, tenantId: string, id: string, input: { name?: string; description?: string | null }): Promise<CatalogueRow | null> {
        const res = await db.query(
            `UPDATE catalogue
                SET name = COALESCE($3, name),
                    description = CASE WHEN $4::boolean THEN $5 ELSE description END
              WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
            [tenantId, id, input.name ?? null, input.description !== undefined, input.description ?? null]
        );
        return res.rows[0] ?? null;
    },

    async listVersions(db: Db, tenantId: string, catalogueId?: string): Promise<VersionSummary[]> {
        const res = await db.query(
            `SELECT v.*, c.name AS catalogue_name,
                    (SELECT count(*)::int FROM product_offering po WHERE po.tenant_id = v.tenant_id AND po.catalogue_version_id = v.id) AS offering_count
               FROM catalogue_version v
               JOIN catalogue c ON c.tenant_id = v.tenant_id AND c.id = v.catalogue_id
              WHERE v.tenant_id = $1 AND ($2::uuid IS NULL OR v.catalogue_id = $2)
              ORDER BY c.name, v.created_at, v.version`,
            [tenantId, catalogueId ?? null]
        );
        return res.rows;
    },

    async getVersion(db: Db, tenantId: string, id: string, opts: { forUpdate?: boolean } = {}): Promise<VersionSummary | null> {
        const res = await db.query(
            `SELECT v.*, c.name AS catalogue_name,
                    (SELECT count(*)::int FROM product_offering po WHERE po.tenant_id = v.tenant_id AND po.catalogue_version_id = v.id) AS offering_count
               FROM catalogue_version v
               JOIN catalogue c ON c.tenant_id = v.tenant_id AND c.id = v.catalogue_id
              WHERE v.tenant_id = $1 AND v.id = $2
              ${opts.forUpdate ? 'FOR UPDATE OF v' : ''}`,
            [tenantId, id]
        );
        return res.rows[0] ?? null;
    },

    async createVersion(
        db: Db,
        tenantId: string,
        input: { catalogue_id: string; version: string; valid_from?: Date | null; valid_to?: Date | null }
    ): Promise<CatalogueVersionRow> {
        const res = await db.query(
            `INSERT INTO catalogue_version (tenant_id, catalogue_id, version, status, valid_from, valid_to)
             VALUES ($1, $2, $3, 'DRAFT', $4, $5) RETURNING *`,
            [tenantId, input.catalogue_id, input.version, input.valid_from ?? null, input.valid_to ?? null]
        );
        return res.rows[0];
    },

    async updateVersion(
        db: Db,
        tenantId: string,
        id: string,
        input: { version?: string; valid_from?: Date | null; valid_to?: Date | null }
    ): Promise<CatalogueVersionRow | null> {
        const res = await db.query(
            `UPDATE catalogue_version
                SET version    = COALESCE($3, version),
                    valid_from = CASE WHEN $4::boolean THEN $5::timestamptz ELSE valid_from END,
                    valid_to   = CASE WHEN $6::boolean THEN $7::timestamptz ELSE valid_to END
              WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
            [
                tenantId,
                id,
                input.version ?? null,
                input.valid_from !== undefined,
                input.valid_from ?? null,
                input.valid_to !== undefined,
                input.valid_to ?? null,
            ]
        );
        return res.rows[0] ?? null;
    },

    async setStatus(db: Db, tenantId: string, id: string, status: CatalogueStatus, validFrom?: Date): Promise<CatalogueVersionRow> {
        const res = await db.query(
            `UPDATE catalogue_version
                SET status = $3,
                    valid_from = COALESCE(valid_from, $4)
              WHERE tenant_id = $1 AND id = $2
          RETURNING *`,
            [tenantId, id, status, validFrom ?? null]
        );
        return res.rows[0];
    },

    async deleteVersion(db: Db, tenantId: string, id: string): Promise<boolean> {
        const res = await db.query('DELETE FROM catalogue_version WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        return (res.rowCount ?? 0) > 0;
    },

    /** Problems that block approval/release. An empty list means the version is ready. */
    async readinessProblems(db: Db, tenantId: string, versionId: string): Promise<string[]> {
        const res = await db.query<{ problem: string }>(
            `SELECT 'The version has no offerings' AS problem
              WHERE NOT EXISTS (SELECT 1 FROM product_offering WHERE tenant_id = $1 AND catalogue_version_id = $2)
             UNION ALL
             SELECT format('Offering %s has no charges', po.offering_code)
               FROM product_offering po
              WHERE po.tenant_id = $1 AND po.catalogue_version_id = $2
                AND NOT EXISTS (SELECT 1 FROM offering_charge_component occ WHERE occ.tenant_id = po.tenant_id AND occ.offering_id = po.id)
             UNION ALL
             SELECT format('Charge %s on offering %s has no rate in any market', cs.charge_code, po.offering_code)
               FROM product_offering po
               JOIN offering_charge_component occ ON occ.tenant_id = po.tenant_id AND occ.offering_id = po.id
               JOIN charge_specification cs ON cs.tenant_id = occ.tenant_id AND cs.id = occ.charge_spec_id
              WHERE po.tenant_id = $1 AND po.catalogue_version_id = $2
                AND NOT EXISTS (SELECT 1 FROM offering_rate r
                                 WHERE r.tenant_id = occ.tenant_id AND r.offering_id = occ.offering_id AND r.charge_spec_id = occ.charge_spec_id)
             UNION ALL
             SELECT format('Offering %s %s %s, which is not in this version', s.offering_code, lower(r.relationship_type), t.offering_code)
               FROM offering_relationship r
               JOIN product_offering s ON s.tenant_id = r.tenant_id AND s.id = r.source_offering_id
               JOIN product_offering t ON t.tenant_id = r.tenant_id AND t.id = r.target_offering_id
              WHERE r.tenant_id = $1 AND s.catalogue_version_id = $2 AND t.catalogue_version_id <> $2`,
            [tenantId, versionId]
        );
        return res.rows.map((r) => r.problem);
    },

    /**
     * Deep-copies every offering of one version (with its components, rates, market restrictions,
     * relationships, policy and category mappings) into another, DRAFT, version. Price overrides
     * that are active or start in the future are carried onto the copied rates so that subscribers
     * on negotiated prices keep them when the new version is released.
     */
    async cloneVersionContent(tx: Db, tenantId: string, fromVersionId: string, toVersionId: string): Promise<number> {
        await tx.query(
            `CREATE TEMP TABLE _offering_map ON COMMIT DROP AS
             SELECT id AS old_id, gen_random_uuid() AS new_id
               FROM product_offering WHERE tenant_id = $1 AND catalogue_version_id = $2`,
            [tenantId, fromVersionId]
        );
        const copied = await tx.query(
            `INSERT INTO product_offering (id, tenant_id, catalogue_version_id, product_specification_id,
                                           offering_code, offering_name, offering_type, service_type)
             SELECT m.new_id, po.tenant_id, $2, po.product_specification_id, po.offering_code, po.offering_name,
                    po.offering_type, po.service_type
               FROM product_offering po JOIN _offering_map m ON m.old_id = po.id
              WHERE po.tenant_id = $1`,
            [tenantId, toVersionId]
        );
        const params = [tenantId];
        await tx.query(
            `INSERT INTO offering_service_component (tenant_id, offering_id, service_spec_id, mandatory_flag, min_qty, max_qty)
             SELECT c.tenant_id, m.new_id, c.service_spec_id, c.mandatory_flag, c.min_qty, c.max_qty
               FROM offering_service_component c JOIN _offering_map m ON m.old_id = c.offering_id
              WHERE c.tenant_id = $1`,
            params
        );
        await tx.query(
            `INSERT INTO offering_charge_component (tenant_id, offering_id, charge_spec_id)
             SELECT c.tenant_id, m.new_id, c.charge_spec_id
               FROM offering_charge_component c JOIN _offering_map m ON m.old_id = c.offering_id
              WHERE c.tenant_id = $1`,
            params
        );
        await tx.query(
            `CREATE TEMP TABLE _rate_map ON COMMIT DROP AS
             SELECT r.id AS old_id, gen_random_uuid() AS new_id, m.new_id AS offering_id
               FROM offering_rate r JOIN _offering_map m ON m.old_id = r.offering_id
              WHERE r.tenant_id = $1`,
            params
        );
        await tx.query(
            `INSERT INTO offering_rate (id, tenant_id, offering_id, charge_spec_id, market_id, currency_code, amount)
             SELECT rm.new_id, r.tenant_id, rm.offering_id, r.charge_spec_id, r.market_id, r.currency_code, r.amount
               FROM offering_rate r JOIN _rate_map rm ON rm.old_id = r.id
              WHERE r.tenant_id = $1`,
            params
        );
        await tx.query(
            `INSERT INTO price_override (tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from, effective_to)
             SELECT po.tenant_id, rm.new_id, po.scope_type, po.scope_reference_id, po.override_amount, po.effective_from, po.effective_to
               FROM price_override po JOIN _rate_map rm ON rm.old_id = po.offering_rate_id
              WHERE po.tenant_id = $1 AND (po.effective_to IS NULL OR po.effective_to > NOW())`,
            params
        );
        await tx.query(
            `INSERT INTO offering_market_mapping (tenant_id, offering_id, market_id, restriction)
             SELECT c.tenant_id, m.new_id, c.market_id, c.restriction
               FROM offering_market_mapping c JOIN _offering_map m ON m.old_id = c.offering_id
              WHERE c.tenant_id = $1`,
            params
        );
        await tx.query(
            `INSERT INTO offering_relationship (tenant_id, source_offering_id, target_offering_id, relationship_type)
             SELECT r.tenant_id, s.new_id, t.new_id, r.relationship_type
               FROM offering_relationship r
               JOIN _offering_map s ON s.old_id = r.source_offering_id
               JOIN _offering_map t ON t.old_id = r.target_offering_id
              WHERE r.tenant_id = $1`,
            params
        );
        await tx.query(
            `INSERT INTO policy_mapping (tenant_id, product_offering_id, policy_rule_id)
             SELECT c.tenant_id, m.new_id, c.policy_rule_id
               FROM policy_mapping c JOIN _offering_map m ON m.old_id = c.product_offering_id
              WHERE c.tenant_id = $1`,
            params
        );
        await tx.query(
            `INSERT INTO offering_category_mapping (tenant_id, product_offering_id, category_id)
             SELECT c.tenant_id, m.new_id, c.category_id
               FROM offering_category_mapping c JOIN _offering_map m ON m.old_id = c.product_offering_id
              WHERE c.tenant_id = $1`,
            params
        );
        return copied.rowCount ?? 0;
    },
};
