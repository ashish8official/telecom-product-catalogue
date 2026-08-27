import { ProductRepository, InternalProductSpecification, InternalProductOffering, InternalResolvedRate } from '../repositories/productRepository';

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

    async getProductOfferingPrices(
        tenantId: string,
        subscriberId?: string,
        accountId?: string,
        marketId?: string,
        effectiveAt?: Date
    ): Promise<InternalResolvedRate[]> {
        if (!tenantId) throw new Error('tenantId is required');
        return await productRepo.getResolvedOfferingPrices(tenantId, subscriberId, accountId, marketId, effectiveAt);
    }

    async getProductOfferingPriceById(
        tenantId: string, 
        id: string,
        subscriberId?: string,
        accountId?: string,
        marketId?: string,
        effectiveAt?: Date
    ): Promise<InternalResolvedRate | null> {
        if (!tenantId) throw new Error('tenantId is required');
        return await productRepo.getResolvedOfferingPriceById(tenantId, id, subscriberId, accountId, marketId, effectiveAt);
    }
}
