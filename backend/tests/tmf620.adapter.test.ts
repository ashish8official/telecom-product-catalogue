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

    describe('GET /productOfferingPrice/:id', () => {
        const mockInternalRate = {
            id: 'rate-789',
            tenant_id: mockTenantId,
            charge_spec_id: 'charge-123',
            market_id: 'market-123',
            currency_code: 'USD',
            amount: 15.500000,
            resolution_source: 'CATALOGUE_RATE',
            charge_name: 'Monthly Data Charge',
            calculation_type: 'FLAT',
            valid_from: new Date('2023-01-01T00:00:00Z'),
            valid_to: undefined
        };

        it('1, 5, 9, 11: No context -> base price, internal fields do not leak, old tests pass', async () => {
            (ProductCatalogService.prototype.getProductOfferingPriceById as jest.Mock).mockResolvedValue(mockInternalRate);

            const res = await request(app)
                .get('/productCatalogManagement/v5/productOfferingPrice/rate-789')
                .set('x-tenant-id', mockTenantId);

            expect(res.status).toBe(200);

            // Verify service was called with no context parameters
            expect(ProductCatalogService.prototype.getProductOfferingPriceById).toHaveBeenCalledWith(
                mockTenantId, 'rate-789', undefined, undefined, undefined, undefined
            );

            // Verify mapping
            expect(res.body).toHaveProperty('id', 'rate-789');
            expect(res.body).toHaveProperty('name', 'Monthly Data Charge');
            expect(res.body).toHaveProperty('description', 'Pricing for Monthly Data Charge (Resolved via CATALOGUE_RATE)');
            expect(res.body).toHaveProperty('priceType', 'recurring'); // FLAT mapped to recurring
            expect(res.body).toHaveProperty('price');
            expect(res.body.price).toHaveProperty('value', 15.5);
            expect(res.body.price).toHaveProperty('unit', 'USD');
            expect(res.body).toHaveProperty('validFor');
            expect(res.body.validFor).toHaveProperty('startDateTime', '2023-01-01T00:00:00.000Z');
            expect(res.body.validFor).not.toHaveProperty('endDateTime');

            // Internal fields should not leak
            expect(res.body).not.toHaveProperty('tenant_id');
            expect(res.body).not.toHaveProperty('amount');
            expect(res.body).not.toHaveProperty('resolution_source');
            expect(res.body).not.toHaveProperty('calculation_type');
            expect(res.body).not.toHaveProperty('valid_from');
        });

        it('2. Market context -> market override', async () => {
            const marketOverrideRate = { ...mockInternalRate, amount: 10.0, resolution_source: 'MARKET' };
            (ProductCatalogService.prototype.getProductOfferingPriceById as jest.Mock).mockResolvedValue(marketOverrideRate);

            const res = await request(app)
                .get('/productCatalogManagement/v5/productOfferingPrice/rate-789?marketId=mkt-1')
                .set('x-tenant-id', mockTenantId);

            expect(res.status).toBe(200);
            expect(ProductCatalogService.prototype.getProductOfferingPriceById).toHaveBeenCalledWith(
                mockTenantId, 'rate-789', undefined, undefined, 'mkt-1', undefined
            );
            expect(res.body.price.value).toBe(10.0);
            expect(res.body.description).toContain('Resolved via MARKET');
        });

        it('3. Account context -> account override', async () => {
            const accOverrideRate = { ...mockInternalRate, amount: 8.0, resolution_source: 'ACCOUNT' };
            (ProductCatalogService.prototype.getProductOfferingPriceById as jest.Mock).mockResolvedValue(accOverrideRate);

            const res = await request(app)
                .get('/productCatalogManagement/v5/productOfferingPrice/rate-789?accountId=acc-1')
                .set('x-tenant-id', mockTenantId);

            expect(res.status).toBe(200);
            expect(ProductCatalogService.prototype.getProductOfferingPriceById).toHaveBeenCalledWith(
                mockTenantId, 'rate-789', undefined, 'acc-1', undefined, undefined
            );
            expect(res.body.price.value).toBe(8.0);
            expect(res.body.description).toContain('Resolved via ACCOUNT');
        });

        it('4. Subscriber context -> subscriber override', async () => {
            const subOverrideRate = { ...mockInternalRate, amount: 5.0, resolution_source: 'SUBSCRIBER' };
            (ProductCatalogService.prototype.getProductOfferingPriceById as jest.Mock).mockResolvedValue(subOverrideRate);

            const effectiveDate = new Date().toISOString();
            const res = await request(app)
                .get(`/productCatalogManagement/v5/productOfferingPrice/rate-789?subscriberId=sub-1&effectiveAt=${effectiveDate}`)
                .set('x-tenant-id', mockTenantId);

            expect(res.status).toBe(200);
            expect(ProductCatalogService.prototype.getProductOfferingPriceById).toHaveBeenCalledWith(
                mockTenantId, 'rate-789', 'sub-1', undefined, undefined, new Date(effectiveDate)
            );
            expect(res.body.price.value).toBe(5.0);
            expect(res.body.description).toContain('Resolved via SUBSCRIBER');
        });

        it('6, 7, 8. Correct priceType mapping (PERCENTAGE -> tariff), Currency, Validity (with endDateTime)', async () => {
            const tariffRate = { 
                ...mockInternalRate, 
                calculation_type: 'PERCENTAGE',
                currency_code: 'EUR',
                valid_to: new Date('2024-01-01T00:00:00Z')
            };
            (ProductCatalogService.prototype.getProductOfferingPriceById as jest.Mock).mockResolvedValue(tariffRate);

            const res = await request(app)
                .get('/productCatalogManagement/v5/productOfferingPrice/rate-789')
                .set('x-tenant-id', mockTenantId);

            expect(res.body.priceType).toBe('tariff');
            expect(res.body.price.unit).toBe('EUR');
            expect(res.body.validFor.endDateTime).toBe('2024-01-01T00:00:00.000Z');
        });

        it('10. Tenant isolation is enforced', async () => {
            (ProductCatalogService.prototype.getProductOfferingPriceById as jest.Mock).mockResolvedValue(null);
            
            // Simulating a case where tenant does not own the rate ID
            const res = await request(app)
                .get('/productCatalogManagement/v5/productOfferingPrice/rate-789')
                .set('x-tenant-id', 'WRONG-TENANT');

            expect(res.status).toBe(404);
            expect(ProductCatalogService.prototype.getProductOfferingPriceById).toHaveBeenCalledWith(
                'WRONG-TENANT', 'rate-789', undefined, undefined, undefined, undefined
            );
        });
    });
});
