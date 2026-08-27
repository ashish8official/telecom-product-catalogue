import { Router, Request, Response } from 'express';
import { ProductCatalogService } from '../../services/productCatalogService';

export const internalRouter = Router();
const catalogService = new ProductCatalogService();

// Middleware to extract tenant_id from headers
const getTenantId = (req: Request) => {
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId || typeof tenantId !== 'string') {
        throw new Error('x-tenant-id header is required');
    }
    return tenantId;
};

// GET /api/internal/catalogues
internalRouter.get('/catalogues', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const catalogues = await catalogService.getCatalogues(tenantId);
        res.json(catalogues);
    } catch (error: any) {
        console.error("Internal API Error:", error);
        res.status(400).json({ error: error.message || String(error) });
    }
});

// GET /api/internal/catalogues/:id/versions
internalRouter.get('/catalogues/:id/versions', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const versions = await catalogService.getCatalogueVersions(tenantId, req.params.id as string);
        res.json(versions);
    } catch (error: any) {
        console.error("Internal API Error:", error);
        res.status(400).json({ error: error.message || String(error) });
    }
});

// GET /api/internal/versions/:id/offerings
internalRouter.get('/versions/:id/offerings', async (req: Request, res: Response) => {
    try {
        const tenantId = getTenantId(req);
        const offerings = await catalogService.getOfferingsForVersion(tenantId, req.params.id as string);
        res.json(offerings);
    } catch (error: any) {
        console.error("Internal API Error:", error);
        res.status(400).json({ error: error.message || String(error) });
    }
});
