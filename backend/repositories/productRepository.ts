import { Pool } from 'pg';

// We rely on standard pg configuration via environment variables with fallbacks for local dev
export const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'catalogue_db',
    password: process.env.PGPASSWORD || 'admin',
    port: parseInt(process.env.PGPORT || '5433')
});

export interface InternalProductSpecification {
    id: string;
    tenant_id: string;
    spec_code: string;
    spec_name: string;
    status: string;
    effective_from: Date;
    effective_to: Date | null;
}

export interface InternalProductOffering {
    id: string;
    tenant_id: string;
    catalogue_version_id: string;
    product_specification_id: string;
    offering_code: string;
    offering_name: string;
    offering_type: string;
    service_type: string;
    created_at: Date;
}

export class ProductRepository {
    async getProductSpecifications(tenantId: string): Promise<InternalProductSpecification[]> {
        const result = await pool.query(
            'SELECT * FROM product_specification WHERE tenant_id = $1',
            [tenantId]
        );
        return result.rows;
    }

    async getProductSpecificationById(tenantId: string, id: string): Promise<InternalProductSpecification | null> {
        const result = await pool.query(
            'SELECT * FROM product_specification WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );
        return result.rows[0] || null;
    }

    async getProductOfferings(tenantId: string): Promise<InternalProductOffering[]> {
        const result = await pool.query(
            'SELECT * FROM product_offering WHERE tenant_id = $1',
            [tenantId]
        );
        return result.rows;
    }

    async getProductOfferingById(tenantId: string, id: string): Promise<InternalProductOffering | null> {
        const result = await pool.query(
            'SELECT * FROM product_offering WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );
        return result.rows[0] || null;
    }

    async getCatalogues(tenantId: string): Promise<any[]> {
        const result = await pool.query(
            'SELECT * FROM catalogue WHERE tenant_id = $1 ORDER BY created_at DESC',
            [tenantId]
        );
        return result.rows;
    }

    async getCatalogueVersions(tenantId: string, catalogueId: string): Promise<any[]> {
        const result = await pool.query(
            'SELECT * FROM catalogue_version WHERE tenant_id = $1 AND catalogue_id = $2 ORDER BY version ASC',
            [tenantId, catalogueId]
        );
        return result.rows;
    }

    async getOfferingsForVersion(tenantId: string, versionId: string): Promise<any[]> {
        const query = `
            SELECT 
                po.id as offering_id, po.offering_code, po.offering_name, po.offering_type, po.service_type,
                ps.id as spec_id, ps.spec_code, ps.spec_name,
                (
                    SELECT json_agg(
                        json_build_object(
                            'charge_id', cs.id,
                            'charge_code', cs.charge_code,
                            'charge_name', cs.charge_name,
                            'priority', cs.charge_priority
                        )
                    )
                    FROM offering_charge_component occ
                    JOIN charge_specification cs ON occ.charge_spec_id = cs.id
                    WHERE occ.offering_id = po.id AND occ.tenant_id = po.tenant_id
                ) as charges,
                (
                    SELECT json_agg(
                        json_build_object(
                            'service_id', ss.id,
                            'service_code', ss.service_code,
                            'service_name', ss.service_name
                        )
                    )
                    FROM offering_service_component osc
                    JOIN service_specification ss ON osc.service_spec_id = ss.id
                    WHERE osc.offering_id = po.id AND osc.tenant_id = po.tenant_id
                ) as services
            FROM product_offering po
            JOIN product_specification ps ON po.product_specification_id = ps.id
            WHERE po.tenant_id = $1 AND po.catalogue_version_id = $2
        `;
        const result = await pool.query(query, [tenantId, versionId]);
        return result.rows;
    }

    async checkCatalogueVersionIsDraft(tenantId: string, catalogueVersionId: string): Promise<boolean> {
        const result = await pool.query(
            'SELECT status FROM catalogue_version WHERE tenant_id = $1 AND id = $2',
            [tenantId, catalogueVersionId]
        );
        if (result.rows.length === 0) {
            throw new Error(`CatalogueVersion ${catalogueVersionId} not found`);
        }
        if (result.rows[0].status !== 'DRAFT') {
            return false;
        }
        return true;
    }

    async createProductSpecification(tenantId: string, spec: Partial<InternalProductSpecification>): Promise<InternalProductSpecification> {
        const result = await pool.query(
            `INSERT INTO product_specification (tenant_id, spec_code, spec_name, status, effective_from, effective_to)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [tenantId, spec.spec_code, spec.spec_name, spec.status || 'ACTIVE', spec.effective_from || new Date(), spec.effective_to || null]
        );
        return result.rows[0];
    }

    async updateProductSpecification(tenantId: string, id: string, spec: Partial<InternalProductSpecification>): Promise<InternalProductSpecification | null> {
        const updates: string[] = [];
        const values: any[] = [tenantId, id];
        let idx = 3;

        if (spec.spec_name) { updates.push(`spec_name = $${idx++}`); values.push(spec.spec_name); }
        if (spec.status) { updates.push(`status = $${idx++}`); values.push(spec.status); }
        if (spec.effective_from !== undefined) { updates.push(`effective_from = $${idx++}`); values.push(spec.effective_from); }
        if (spec.effective_to !== undefined) { updates.push(`effective_to = $${idx++}`); values.push(spec.effective_to); }

        if (updates.length === 0) return this.getProductSpecificationById(tenantId, id);

        updates.push(`updated_at = NOW()`);
        
        const query = `UPDATE product_specification SET ${updates.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`;
        const result = await pool.query(query, values);
        return result.rows[0] || null;
    }

    async createProductOffering(tenantId: string, offering: Partial<InternalProductOffering>): Promise<InternalProductOffering> {
        const result = await pool.query(
            `INSERT INTO product_offering (tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [tenantId, offering.catalogue_version_id, offering.product_specification_id, offering.offering_code, offering.offering_name, offering.offering_type || 'BASE', offering.service_type || 'PREPAID']
        );
        return result.rows[0];
    }

    async updateProductOffering(tenantId: string, id: string, offering: Partial<InternalProductOffering>): Promise<InternalProductOffering | null> {
        const updates: string[] = [];
        const values: any[] = [tenantId, id];
        let idx = 3;

        if (offering.offering_name) { updates.push(`offering_name = $${idx++}`); values.push(offering.offering_name); }
        if (offering.product_specification_id) { updates.push(`product_specification_id = $${idx++}`); values.push(offering.product_specification_id); }
        if (offering.offering_type) { updates.push(`offering_type = $${idx++}`); values.push(offering.offering_type); }
        if (offering.service_type) { updates.push(`service_type = $${idx++}`); values.push(offering.service_type); }

        if (updates.length === 0) return this.getProductOfferingById(tenantId, id);

        updates.push(`updated_at = NOW()`);
        
        const query = `UPDATE product_offering SET ${updates.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`;
        const result = await pool.query(query, values);
        return result.rows[0] || null;
    }

    async getResolvedOfferingPrices(
        tenantId: string,
        subscriberId?: string,
        accountId?: string,
        marketId?: string,
        effectiveAt?: Date,
        offeringId?: string
    ): Promise<InternalResolvedRate[]> {
        let query = `
            SELECT 
                r.id,
                r.tenant_id,
                r.charge_spec_id,
                r.market_id,
                r.currency_code,
                rp.amount as amount,
                rp.source as resolution_source,
                r.created_at as valid_from,
                c.charge_name,
                c.calculation_type
            FROM offering_rate r
            JOIN charge_specification c ON r.charge_spec_id = c.id AND r.tenant_id = c.tenant_id
            CROSS JOIN LATERAL resolve_price($1, r.id, $2, $3, $4, COALESCE($5, NOW())) rp
            WHERE r.tenant_id = $1
        `;
        
        const params: any[] = [
            tenantId, 
            subscriberId || null, 
            accountId || null, 
            marketId || null, 
            effectiveAt || null
        ];

        if (offeringId) {
            query += ` AND c.id IN (
                SELECT charge_spec_id 
                FROM offering_charge_component 
                WHERE offering_id = $6 AND tenant_id = $1
            )`;
            params.push(offeringId);
        }

        const result = await pool.query(query, params);
        return result.rows;
    }

    async getResolvedOfferingPriceById(
        tenantId: string, 
        id: string,
        subscriberId?: string,
        accountId?: string,
        marketId?: string,
        effectiveAt?: Date
    ): Promise<InternalResolvedRate | null> {
        const query = `
            SELECT 
                r.id,
                r.tenant_id,
                r.charge_spec_id,
                r.market_id,
                r.currency_code,
                rp.amount as amount,
                rp.source as resolution_source,
                r.created_at as valid_from,
                c.charge_name,
                c.calculation_type
            FROM offering_rate r
            JOIN charge_specification c ON r.charge_spec_id = c.id AND r.tenant_id = c.tenant_id
            CROSS JOIN LATERAL resolve_price($1, r.id, $3, $4, $5, COALESCE($6, NOW())) rp
            WHERE r.tenant_id = $1 AND r.id = $2
        `;
        const result = await pool.query(query, [
            tenantId,
            id,
            subscriberId || null,
            accountId || null,
            marketId || null,
            effectiveAt || null
        ]);
        return result.rows[0] || null;
    }
}

export interface InternalResolvedRate {
    id: string;
    tenant_id: string;
    charge_spec_id: string;
    market_id: string;
    currency_code: string;
    amount: number;
    resolution_source?: string;
    charge_name: string;
    calculation_type: string;
    valid_from: Date;
    valid_to?: Date;
}
