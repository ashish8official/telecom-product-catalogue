import request from 'supertest';
import { app } from '../app';
import { ProductCatalogService } from '../services/productCatalogService';
import { InternalProductSpecification, InternalProductOffering } from '../repositories/productRepository';

// Mock the service layer so we only test the adapter transformation
jest.mock('../services/productCatalogService');

describe('TMF620 Adapter Layer', () => {
    const mockTenantId = '00000000-0000-0000-0000-000000000001';
    
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /productSpecification/:id', () => {
        it('should map internal model to TMF620 shape without leaking internal fields', async () => {
            const internalSpec: InternalProductSpecification = {
                id: 'spec-123',
                tenant_id: mockTenantId,
                spec_code: 'SPEC_CODE_1',
                spec_name: 'Super Internet',
                status: 'ACTIVE',
                effective_from: new Date('2023-01-01T00:00:00Z'),
                effective_to: null
            };

            // Setup mock
            (ProductCatalogService.prototype.getProductSpecificationById as jest.Mock).mockResolvedValue(internalSpec);

            const res = await request(app)
                .get('/productCatalogManagement/v5/productSpecification/spec-123')
                .set('x-tenant-id', mockTenantId);

            expect(res.status).toBe(200);
            
            // Assert field names exactly match TMF620
            expect(res.body).toHaveProperty('id', 'spec-123');
            expect(res.body).toHaveProperty('name', 'Super Internet');
            expect(res.body).toHaveProperty('lifecycleStatus', 'ACTIVE');
            expect(res.body).toHaveProperty('validFor');
            expect(res.body.validFor).toHaveProperty('startDateTime');
            
            // Assert internal fields DO NOT LEAK
            expect(res.body).not.toHaveProperty('tenant_id');
            expect(res.body).not.toHaveProperty('spec_code');
            expect(res.body).not.toHaveProperty('effective_from');
        });
    });

    describe('GET /productOffering/:id', () => {
        it('should map internal model to TMF620 shape without leaking internal fields', async () => {
            const internalOffering: InternalProductOffering = {
                id: 'off-456',
                tenant_id: mockTenantId,
                catalogue_version_id: 'cat-v1',
                product_specification_id: 'spec-123',
                offering_code: 'OFF_CODE',
                offering_name: 'Super Internet 100M',
                offering_type: 'BASE',
                service_type: 'PREPAID',
                created_at: new Date('2023-01-01T00:00:00Z')
            };

            const internalSpec: InternalProductSpecification = {
                id: 'spec-123',
                tenant_id: mockTenantId,
                spec_code: 'SPEC_CODE_1',
                spec_name: 'Super Internet',
                status: 'ACTIVE',
                effective_from: new Date('2023-01-01T00:00:00Z'),
                effective_to: null
            };

            (ProductCatalogService.prototype.getProductOfferingById as jest.Mock).mockResolvedValue(internalOffering);
            (ProductCatalogService.prototype.getProductSpecificationById as jest.Mock).mockResolvedValue(internalSpec);

            const res = await request(app)
                .get('/productCatalogManagement/v5/productOffering/off-456')
                .set('x-tenant-id', mockTenantId);

            expect(res.status).toBe(200);

            // Assert TMF620 shape
            expect(res.body).toHaveProperty('id', 'off-456');
            expect(res.body).toHaveProperty('name', 'Super Internet 100M');
            expect(res.body).toHaveProperty('lifecycleStatus', 'Active');
            expect(res.body).toHaveProperty('productSpecification');
            expect(res.body.productSpecification).toHaveProperty('id', 'spec-123');
            expect(res.body.productSpecification).toHaveProperty('name', 'Super Internet');

            // Assert internal fields DO NOT LEAK
            expect(res.body).not.toHaveProperty('tenant_id');
            expect(res.body).not.toHaveProperty('catalogue_version_id');
            expect(res.body).not.toHaveProperty('offering_type');
            expect(res.body).not.toHaveProperty('service_type');
            expect(res.body).not.toHaveProperty('offering_code');
        });
    });
});
