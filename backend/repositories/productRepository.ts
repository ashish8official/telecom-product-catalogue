import { Pool } from 'pg';

// We rely on standard pg configuration via environment variables
export const pool = new Pool();

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

    async getResolvedOfferingPrices(tenantId: string): Promise<InternalResolvedRate[]> {
        // Simplified query to return all rates with their charge spec info.
        // In a real system, this would be filtered by market_id/currency_code via resolver logic.
        const query = `
            SELECT 
                r.id,
                r.tenant_id,
                r.charge_spec_id,
                r.market_id,
                r.currency_code,
                r.amount,
                r.created_at as valid_from,
                c.charge_name,
                c.calculation_type
            FROM offering_rate r
            JOIN charge_specification c ON r.charge_spec_id = c.id AND r.tenant_id = c.tenant_id
            WHERE r.tenant_id = $1
        `;
        const result = await pool.query(query, [tenantId]);
        return result.rows;
    }

    async getResolvedOfferingPriceById(tenantId: string, id: string): Promise<InternalResolvedRate | null> {
        const query = `
            SELECT 
                r.id,
                r.tenant_id,
                r.charge_spec_id,
                r.market_id,
                r.currency_code,
                r.amount,
                r.created_at as valid_from,
                c.charge_name,
                c.calculation_type
            FROM offering_rate r
            JOIN charge_specification c ON r.charge_spec_id = c.id AND r.tenant_id = c.tenant_id
            WHERE r.tenant_id = $1 AND r.id = $2
        `;
        const result = await pool.query(query, [tenantId, id]);
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
    charge_name: string;
    calculation_type: string;
    valid_from: Date;
    valid_to?: Date;
}
