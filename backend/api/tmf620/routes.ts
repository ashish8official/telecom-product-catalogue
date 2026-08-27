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
        console.error("API Error:", error);
        res.status(400).json({ error: error.message || String(error) });
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
        console.error("API Error:", error);
        res.status(400).json({ error: error.message || String(error) });
    }
});

// Helper to extract catalogue version context
const getCatalogueVersionId = (req: Request) => {
    const versionId = req.headers['x-catalogue-version-id'];
    if (!versionId || typeof versionId !== 'string') {
        throw new Error('x-catalogue-version-id header is required for write operations');
    }
    return versionId;
};

// POST /productCatalogManagement/v5/productSpecification
tmf620Router.post('/productSpecification', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const versionId = getCatalogueVersionId(req);
        const payload = req.body;
        
        if (!payload.name) {
            return res.status(400).json({ error: 'name is required' });
        }
        
        const internalSpec = {
            spec_name: payload.name,
            spec_code: payload.name.toUpperCase().replace(/\s+/g, '_'),
            status: payload.lifecycleStatus || 'ACTIVE',
            effective_from: payload.validFor?.startDateTime ? new Date(payload.validFor.startDateTime) : undefined,
            effective_to: payload.validFor?.endDateTime ? new Date(payload.validFor.endDateTime) : undefined
        };
        
        const created = await catalogService.createProductSpecification(tenantId, versionId, internalSpec);
        res.status(201).json(TMF620Adapter.mapToProductSpecification(created));
    } catch (error: any) {
        console.error("API Error:", error);
        const code = error.message && error.message.includes('Modification denied') ? 409 : 400;
        res.status(code).json({ error: error.message || String(error) });
    }
});

// PATCH /productCatalogManagement/v5/productSpecification/{id}
tmf620Router.patch('/productSpecification/:id', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const versionId = getCatalogueVersionId(req);
        const payload = req.body;
        
        const updateSpec: any = {};
        if (payload.name) {
            updateSpec.spec_name = payload.name;
        }
        if (payload.lifecycleStatus) {
            updateSpec.status = payload.lifecycleStatus;
        }
        if (payload.validFor) {
            if (payload.validFor.startDateTime) updateSpec.effective_from = new Date(payload.validFor.startDateTime);
            if (payload.validFor.endDateTime) updateSpec.effective_to = new Date(payload.validFor.endDateTime);
        }
        
        const updated = await catalogService.updateProductSpecification(tenantId, req.params.id as string, versionId, updateSpec);
        if (!updated) {
            return res.status(404).json({ error: 'ProductSpecification not found' });
        }
        res.json(TMF620Adapter.mapToProductSpecification(updated));
    } catch (error: any) {
        console.error("API Error:", error);
        const code = error.message && error.message.includes('Modification denied') ? 409 : 400;
        res.status(code).json({ error: error.message || String(error) });
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
        console.error("API Error:", error);
        res.status(400).json({ error: error.message || String(error) });
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
        console.error("API Error:", error);
        res.status(400).json({ error: error.message || String(error) });
    }
});

// POST /productCatalogManagement/v5/productOffering
tmf620Router.post('/productOffering', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const versionId = getCatalogueVersionId(req);
        const payload = req.body;
        
        if (!payload.name) return res.status(400).json({ error: 'name is required' });
        if (!payload.productSpecification || !payload.productSpecification.id) {
            return res.status(400).json({ error: 'productSpecification.id is required' });
        }
        
        const internalOffering = {
            offering_name: payload.name,
            offering_code: payload.name.toUpperCase().replace(/\s+/g, '_'),
            product_specification_id: payload.productSpecification.id,
            // Defaults for fields TMF620 doesn't strictly provide natively
            offering_type: 'BASE',
            service_type: 'PREPAID'
        };
        
        const created = await catalogService.createProductOffering(tenantId, versionId, internalOffering);
        res.status(201).json(TMF620Adapter.mapToProductOffering(created));
    } catch (error: any) {
        console.error("API Error:", error);
        const code = error.message && error.message.includes('Modification denied') ? 409 : 400;
        res.status(code).json({ error: error.message || String(error) });
    }
});

// PATCH /productCatalogManagement/v5/productOffering/{id}
tmf620Router.patch('/productOffering/:id', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const versionId = getCatalogueVersionId(req);
        const payload = req.body;
        
        const updateOffering: any = {};
        if (payload.name) {
            updateOffering.offering_name = payload.name;
        }
        if (payload.productSpecification && payload.productSpecification.id) {
            updateOffering.product_specification_id = payload.productSpecification.id;
        }
        
        const updated = await catalogService.updateProductOffering(tenantId, req.params.id as string, versionId, updateOffering);
        if (!updated) {
            return res.status(404).json({ error: 'ProductOffering not found' });
        }
        res.json(TMF620Adapter.mapToProductOffering(updated));
    } catch (error: any) {
        console.error("API Error:", error);
        const code = error.message && error.message.includes('Modification denied') ? 409 : 400;
        res.status(code).json({ error: error.message || String(error) });
    }
});

// Helper for context param validation
const validateContextParam = (val: any, paramName: string) => {
    if (val !== undefined) {
        if (typeof val !== 'string' || val.trim().length === 0) {
            throw new Error(`${paramName} must be a non-empty string`);
        }
        return val.trim();
    }
    return undefined;
};

// GET /productCatalogManagement/v5/productOfferingPrice
tmf620Router.get('/productOfferingPrice', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        
        const subscriberId = validateContextParam(req.query.subscriberId, 'subscriberId');
        const accountId = validateContextParam(req.query.accountId, 'accountId');
        const marketId = validateContextParam(req.query.marketId, 'marketId');
        
        let effectiveAt: Date | undefined;
        if (req.query.effectiveAt) {
            effectiveAt = new Date(req.query.effectiveAt as string);
            if (isNaN(effectiveAt.getTime())) {
                return res.status(400).json({ error: 'Invalid effectiveAt. Must be a valid ISO-8601 format.' });
            }
        }
        
        const prices = await catalogService.getProductOfferingPrices(tenantId, subscriberId, accountId, marketId, effectiveAt);
        res.json(prices.map(price => TMF620Adapter.mapToProductOfferingPrice(price)));
    } catch (error: any) {
        console.error("API Error:", error);
        res.status(400).json({ error: error.message || String(error) });
    }
});

// GET /productCatalogManagement/v5/productOfferingPrice/{id}
tmf620Router.get('/productOfferingPrice/:id', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);

        const subscriberId = validateContextParam(req.query.subscriberId, 'subscriberId');
        const accountId = validateContextParam(req.query.accountId, 'accountId');
        const marketId = validateContextParam(req.query.marketId, 'marketId');
        
        let effectiveAt: Date | undefined;
        if (req.query.effectiveAt) {
            effectiveAt = new Date(req.query.effectiveAt as string);
            if (isNaN(effectiveAt.getTime())) {
                return res.status(400).json({ error: 'Invalid effectiveAt. Must be a valid ISO-8601 format.' });
            }
        }

        const price = await catalogService.getProductOfferingPriceById(tenantId, req.params.id as string, subscriberId, accountId, marketId, effectiveAt);
        if (!price) {
            return res.status(404).json({ error: 'ProductOfferingPrice not found' });
        }
        res.json(TMF620Adapter.mapToProductOfferingPrice(price));
    } catch (error: any) {
        console.error("API Error:", error);
        res.status(400).json({ error: error.message || String(error) });
    }
});
