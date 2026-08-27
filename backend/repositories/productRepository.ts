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
}
