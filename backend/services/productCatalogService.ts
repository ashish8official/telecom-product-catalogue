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

    async getCatalogues(tenantId: string): Promise<any[]> {
        if (!tenantId) throw new Error('tenantId is required');
        return await productRepo.getCatalogues(tenantId);
    }

    async getCatalogueVersions(tenantId: string, catalogueId: string): Promise<any[]> {
        if (!tenantId) throw new Error('tenantId is required');
        return await productRepo.getCatalogueVersions(tenantId, catalogueId);
    }

    async getOfferingsForVersion(tenantId: string, versionId: string): Promise<any[]> {
        if (!tenantId) throw new Error('tenantId is required');
        return await productRepo.getOfferingsForVersion(tenantId, versionId);
    }

    async validateDraftVersion(tenantId: string, catalogueVersionId: string): Promise<void> {
        const isDraft = await productRepo.checkCatalogueVersionIsDraft(tenantId, catalogueVersionId);
        if (!isDraft) {
            throw new Error(`Modification denied: Catalogue version ${catalogueVersionId} is not in DRAFT state.`);
        }
    }

    async createProductSpecification(tenantId: string, catalogueVersionId: string, spec: Partial<InternalProductSpecification>): Promise<InternalProductSpecification> {
        if (!tenantId || !catalogueVersionId) throw new Error('tenantId and catalogueVersionId are required');
        await this.validateDraftVersion(tenantId, catalogueVersionId);
        return await productRepo.createProductSpecification(tenantId, spec);
    }

    async updateProductSpecification(tenantId: string, id: string, catalogueVersionId: string, spec: Partial<InternalProductSpecification>): Promise<InternalProductSpecification | null> {
        if (!tenantId || !catalogueVersionId) throw new Error('tenantId and catalogueVersionId are required');
        await this.validateDraftVersion(tenantId, catalogueVersionId);
        return await productRepo.updateProductSpecification(tenantId, id, spec);
    }

    async createProductOffering(tenantId: string, catalogueVersionId: string, offering: Partial<InternalProductOffering>): Promise<InternalProductOffering> {
        if (!tenantId || !catalogueVersionId) throw new Error('tenantId and catalogueVersionId are required');
        await this.validateDraftVersion(tenantId, catalogueVersionId);
        offering.catalogue_version_id = catalogueVersionId; // Enforce contextual version
        return await productRepo.createProductOffering(tenantId, offering);
    }

    async updateProductOffering(tenantId: string, id: string, catalogueVersionId: string, offering: Partial<InternalProductOffering>): Promise<InternalProductOffering | null> {
        if (!tenantId || !catalogueVersionId) throw new Error('tenantId and catalogueVersionId are required');
        
        // When updating an offering, we ensure the offering actually belongs to the context version 
        // OR we just validate the context version is DRAFT. 
        // Wait, what if the user tries to update an offering belonging to a RELEASED version using a DRAFT version context?
        // We must check if the offering itself belongs to the provided DRAFT version!
        const existingOffering = await productRepo.getProductOfferingById(tenantId, id);
        if (!existingOffering) throw new Error(`ProductOffering ${id} not found`);
        if (existingOffering.catalogue_version_id !== catalogueVersionId) {
            throw new Error(`Modification denied: ProductOffering ${id} does not belong to the specified catalogue version ${catalogueVersionId}.`);
        }
        
        await this.validateDraftVersion(tenantId, catalogueVersionId);
        return await productRepo.updateProductOffering(tenantId, id, offering);
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
