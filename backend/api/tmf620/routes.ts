import { Router, Request, Response } from 'express';
import { ProductCatalogService } from '../../services/productCatalogService';
import { TMF620Adapter } from './adapter';

export const tmf620Router = Router();
const catalogService = new ProductCatalogService();

// Middleware to extract tenant_id from headers (since it's a multi-tenant system)
const getTenantId = (req: Request) => {
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId || typeof tenantId !== 'string') {
        throw new Error('x-tenant-id header is required');
    }
    return tenantId;
};

// GET /productCatalogManagement/v5/productSpecification
tmf620Router.get('/productSpecification', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const specs = await catalogService.getProductSpecifications(tenantId);
        res.json(specs.map(spec => TMF620Adapter.mapToProductSpecification(spec)));
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// GET /productCatalogManagement/v5/productSpecification/{id}
tmf620Router.get('/productSpecification/:id', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const spec = await catalogService.getProductSpecificationById(tenantId, req.params.id as string);
        if (!spec) {
            return res.status(404).json({ error: 'ProductSpecification not found' });
        }
        res.json(TMF620Adapter.mapToProductSpecification(spec));
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// GET /productCatalogManagement/v5/productOffering
tmf620Router.get('/productOffering', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const offerings = await catalogService.getProductOfferings(tenantId);
        // Note: For a real list endpoint, we'd probably want to join productSpecification to get the spec_name.
        // For this skeleton, we map without the optional spec_name.
        res.json(offerings.map(off => TMF620Adapter.mapToProductOffering(off)));
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// GET /productCatalogManagement/v5/productOffering/{id}
tmf620Router.get('/productOffering/:id', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const offering = await catalogService.getProductOfferingById(tenantId, req.params.id as string);
        if (!offering) {
            return res.status(404).json({ error: 'ProductOffering not found' });
        }
        
        // Fetch spec to include the name in the reference
        const spec = await catalogService.getProductSpecificationById(tenantId, offering.product_specification_id);
        
        res.json(TMF620Adapter.mapToProductOffering(offering, spec?.spec_name));
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});
