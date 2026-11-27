import type { Db } from '../db/pool';

/**
 * Tenant-scoped CRUD for the reference/master data tables. Column lists are code constants
 * (never caller input), so building the SQL from them is safe; every value is a bind parameter
 * and every statement is filtered by tenant_id.
 */
function tenantTable<Row>(table: string, writable: readonly string[], orderBy: string) {
    return {
        async list(db: Db, tenantId: string): Promise<Row[]> {
            const res = await db.query(`SELECT * FROM ${table} WHERE tenant_id = $1 ORDER BY ${orderBy}`, [tenantId]);
            return res.rows;
        },
        async get(db: Db, tenantId: string, id: string): Promise<Row | null> {
            const res = await db.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
            return res.rows[0] ?? null;
        },
        async create(db: Db, tenantId: string, input: Record<string, unknown>): Promise<Row> {
            const cols = writable.filter((c) => input[c] !== undefined);
            const values = cols.map((c) => input[c]);
            const res = await db.query(
                `INSERT INTO ${table} (tenant_id${cols.map((c) => `, ${c}`).join('')})
                 VALUES ($1${cols.map((_, i) => `, $${i + 2}`).join('')}) RETURNING *`,
                [tenantId, ...values]
            );
            return res.rows[0];
        },
        async update(db: Db, tenantId: string, id: string, input: Record<string, unknown>): Promise<Row | null> {
            const cols = writable.filter((c) => input[c] !== undefined);
            if (cols.length === 0) return this.get(db, tenantId, id);
            const res = await db.query(
                `UPDATE ${table} SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}
                  WHERE tenant_id = $1 AND id = $2 RETURNING *`,
                [tenantId, id, ...cols.map((c) => input[c])]
            );
            return res.rows[0] ?? null;
        },
        async remove(db: Db, tenantId: string, id: string): Promise<boolean> {
            const res = await db.query(`DELETE FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
            return (res.rowCount ?? 0) > 0;
        },
    };
}

export interface ProductSpecificationRow {
    id: string;
    tenant_id: string;
    spec_code: string;
    spec_name: string;
    status: 'DRAFT' | 'ACTIVE' | 'RETIRED' | 'OBSOLETE';
    effective_from: Date;
    effective_to: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface ChargeSpecificationRow {
    id: string;
    tenant_id: string;
    charge_code: string;
    charge_name: string;
    charge_priority: number;
    stacking_rule: 'ADDITIVE' | 'OVERRIDE';
    calculation_type: 'FLAT' | 'PERCENTAGE';
    charge_type: 'RECURRING' | 'ONE_TIME' | 'USAGE';
    charge_period: string | null;
}

export interface MarketRow {
    id: string;
    tenant_id: string;
    market_code: string;
    market_name: string;
    parent_market_id: string | null;
    market_type: 'GROUP' | 'COUNTRY' | 'REGION' | 'CITY' | 'ZONE';
    is_pricing_market: boolean;
    timezone: string | null;
    default_currency_code: string | null;
    status: string;
    effective_from: Date | null;
    effective_to: Date | null;
}

export const productSpecifications = tenantTable<ProductSpecificationRow>(
    'product_specification',
    ['spec_code', 'spec_name', 'status', 'effective_from', 'effective_to'],
    'spec_name, id'
);

export const chargeSpecifications = tenantTable<ChargeSpecificationRow>(
    'charge_specification',
    ['charge_code', 'charge_name', 'charge_priority', 'stacking_rule', 'calculation_type', 'charge_type', 'charge_period'],
    'charge_priority, charge_code'
);

export const serviceSpecifications = tenantTable<any>('service_specification', ['spec_code', 'spec_name', 'characteristics'], 'spec_code');

export const markets = tenantTable<MarketRow>(
    'market_master',
    ['market_code', 'market_name', 'parent_market_id', 'market_type', 'is_pricing_market', 'timezone', 'default_currency_code', 'status', 'effective_from', 'effective_to'],
    'market_code'
);

export const categories = tenantTable<any>('offering_category', ['name', 'parent_category_id'], 'name');

export const policySchemas = tenantTable<any>('policy_schema', ['schema_name', 'version', 'schema_json'], 'schema_name, version');

export const policyRules = tenantTable<any>('policy_rule', ['schema_id', 'rule_json'], 'created_at, id');

export const taxConfigurations = tenantTable<any>('tax_configuration', ['tax_name', 'tax_rate', 'market_master_id'], 'tax_name');

export const journalConfigurations = tenantTable<any>('journal_configuration', ['gl_code', 'gl_description'], 'gl_code');

export const referenceRepository = {
    async marketCycle(db: Db, marketId: string, newParentId: string | null): Promise<boolean> {
        const res = await db.query('SELECT check_market_cycle($1, $2) AS cycle', [marketId, newParentId]);
        return res.rows[0].cycle === true;
    },

    async categoryCycle(db: Db, tenantId: string, categoryId: string, newParentId: string | null): Promise<boolean> {
        const res = await db.query('SELECT check_category_cycle($1, $2, $3) AS cycle', [tenantId, categoryId, newParentId]);
        return res.rows[0].cycle === true;
    },

    async currencies(db: Db): Promise<{ currency_code: string; currency_name: string }[]> {
        const res = await db.query('SELECT currency_code, currency_name FROM currency_master ORDER BY currency_code');
        return res.rows;
    },

    async upsertCurrency(db: Db, code: string, name: string): Promise<void> {
        await db.query(
            `INSERT INTO currency_master (currency_code, currency_name) VALUES ($1, $2)
             ON CONFLICT (currency_code) DO UPDATE SET currency_name = EXCLUDED.currency_name`,
            [code, name]
        );
    },

    async chargeFinancials(db: Db, tenantId: string) {
        const [taxes, journals] = await Promise.all([
            db.query(
                `SELECT tm.id, tm.charge_specification_id, tc.id AS tax_configuration_id, tc.tax_name, tc.tax_rate::text AS tax_rate, tc.market_master_id
                   FROM tax_mapping tm JOIN tax_configuration tc ON tc.tenant_id = tm.tenant_id AND tc.id = tm.tax_configuration_id
                  WHERE tm.tenant_id = $1 ORDER BY tc.tax_name`,
                [tenantId]
            ),
            db.query(
                `SELECT jm.id, jm.charge_specification_id, jc.id AS journal_configuration_id, jc.gl_code, jc.gl_description
                   FROM journal_mapping jm JOIN journal_configuration jc ON jc.tenant_id = jm.tenant_id AND jc.id = jm.journal_configuration_id
                  WHERE jm.tenant_id = $1 ORDER BY jc.gl_code`,
                [tenantId]
            ),
        ]);
        return { taxes: taxes.rows, journals: journals.rows };
    },

    async mapTax(db: Db, tenantId: string, chargeSpecId: string, taxConfigId: string) {
        await db.query(
            `INSERT INTO tax_mapping (tenant_id, charge_specification_id, tax_configuration_id) VALUES ($1, $2, $3)`,
            [tenantId, chargeSpecId, taxConfigId]
        );
    },

    async unmapTax(db: Db, tenantId: string, chargeSpecId: string, taxConfigId: string): Promise<boolean> {
        const res = await db.query(
            'DELETE FROM tax_mapping WHERE tenant_id = $1 AND charge_specification_id = $2 AND tax_configuration_id = $3',
            [tenantId, chargeSpecId, taxConfigId]
        );
        return (res.rowCount ?? 0) > 0;
    },

    async mapJournal(db: Db, tenantId: string, chargeSpecId: string, journalConfigId: string) {
        await db.query(
            `INSERT INTO journal_mapping (tenant_id, charge_specification_id, journal_configuration_id) VALUES ($1, $2, $3)`,
            [tenantId, chargeSpecId, journalConfigId]
        );
    },

    async unmapJournal(db: Db, tenantId: string, chargeSpecId: string, journalConfigId: string): Promise<boolean> {
        const res = await db.query(
            'DELETE FROM journal_mapping WHERE tenant_id = $1 AND charge_specification_id = $2 AND journal_configuration_id = $3',
            [tenantId, chargeSpecId, journalConfigId]
        );
        return (res.rowCount ?? 0) > 0;
    },

    async overridesForRate(db: Db, tenantId: string, rateId: string) {
        const res = await db.query(
            `SELECT id, offering_rate_id, scope_type, scope_reference_id, override_amount::text AS override_amount,
                    effective_from, effective_to, created_at
               FROM price_override WHERE tenant_id = $1 AND offering_rate_id = $2
              ORDER BY scope_type, scope_reference_id, effective_from`,
            [tenantId, rateId]
        );
        return res.rows;
    },

    async endOverride(db: Db, tenantId: string, overrideId: string, endAt: Date) {
        const res = await db.query(
            `UPDATE price_override SET effective_to = GREATEST($3::timestamptz, effective_from + INTERVAL '1 second')
              WHERE tenant_id = $1 AND id = $2 AND (effective_to IS NULL OR effective_to > $3)
          RETURNING id`,
            [tenantId, overrideId, endAt]
        );
        return (res.rowCount ?? 0) > 0;
    },

    async deleteOverride(db: Db, tenantId: string, overrideId: string): Promise<boolean> {
        const res = await db.query('DELETE FROM price_override WHERE tenant_id = $1 AND id = $2', [tenantId, overrideId]);
        return (res.rowCount ?? 0) > 0;
    },
};
