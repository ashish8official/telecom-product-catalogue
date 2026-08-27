import { ProductRepository, InternalProductSpecification, InternalProductOffering } from '../repositories/productRepository';

const productRepo = new ProductRepository();

export class ProductCatalogService {
    async getProductSpecifications(tenantId: string): Promise<InternalProductSpecification[]> {
        if (!tenantId) throw new Error('tenantId is required');
        return await productRepo.getProductSpecifications(tenantId);
    }

    async getProductSpecificationById(tenantId: string, id: string): Promise<InternalProductSpecification | null> {
        if (!tenantId) throw new Error('tenantId is required');
        return await productRepo.getProductSpecificationById(tenantId, id);
    }

    async getProductOfferings(tenantId: string): Promise<InternalProductOffering[]> {
        if (!tenantId) throw new Error('tenantId is required');
        return await productRepo.getProductOfferings(tenantId);
    }

    async getProductOfferingById(tenantId: string, id: string): Promise<InternalProductOffering | null> {
        if (!tenantId) throw new Error('tenantId is required');
        return await productRepo.getProductOfferingById(tenantId, id);
    }
}
