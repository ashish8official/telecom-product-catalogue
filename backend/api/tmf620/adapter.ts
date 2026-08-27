import { InternalProductSpecification, InternalProductOffering, InternalResolvedRate } from '../../repositories/productRepository';
import { TMFProductSpecification, TMFProductOffering, TMFProductOfferingPrice } from './types';

export class TMF620Adapter {
    static getBaseUrl(): string {
        return process.env.BASE_URL || 'http://localhost:3000';
    }

    static mapToProductSpecification(internal: InternalProductSpecification): TMFProductSpecification {
        return {
            id: internal.id,
            href: `${this.getBaseUrl()}/productCatalogManagement/v5/productSpecification/${internal.id}`,
            name: internal.spec_name, // Maps to spec_name
            // We map internal status ('ACTIVE', 'RETIRED' etc) directly to lifecycleStatus
            lifecycleStatus: internal.status, 
            validFor: {
                startDateTime: internal.effective_from.toISOString(),
                ...(internal.effective_to ? { endDateTime: internal.effective_to.toISOString() } : {})
            }
        };
    }

    static mapToProductOffering(internal: InternalProductOffering, specName?: string): TMFProductOffering {
        return {
            id: internal.id,
            href: `${this.getBaseUrl()}/productCatalogManagement/v5/productOffering/${internal.id}`,
            name: internal.offering_name,
            // Our internal offering model doesn't explicitly store lifecycleStatus, but TMF expects it. 
            // In a real scenario we'd fetch it from the catalogue_version or offering itself. 
            // We default to 'Active' as an adapter-level mapping for now, but note it as a potential domain gap.
            lifecycleStatus: 'Active', 
            productSpecification: {
                id: internal.product_specification_id,
                href: `${this.getBaseUrl()}/productCatalogManagement/v5/productSpecification/${internal.product_specification_id}`,
                ...(specName ? { name: specName } : {})
            }
            // tenant_id, catalogue_version_id, offering_type, service_type are strictly omitted here to prevent leaking internal shapes
        };
    }

    static mapPriceType(calculationType: string): string {
        // TMF620 common values: recurring, oneTime, usage, tariff
        switch (calculationType.toUpperCase()) {
            case 'FLAT':
                return 'recurring';
            case 'PERCENTAGE':
                return 'tariff';
            default:
                return 'oneTime';
        }
    }

    static mapToProductOfferingPrice(internal: InternalResolvedRate): TMFProductOfferingPrice {
        return {
            id: internal.id,
            href: `${this.getBaseUrl()}/productCatalogManagement/v5/productOfferingPrice/${internal.id}`,
            name: internal.charge_name,
            description: internal.resolution_source 
                ? `Pricing for ${internal.charge_name} (Resolved via ${internal.resolution_source})`
                : `Pricing for ${internal.charge_name}`,
            priceType: this.mapPriceType(internal.calculation_type),
            price: {
                value: Number(internal.amount),
                unit: internal.currency_code
            },
            validFor: {
                startDateTime: new Date(internal.valid_from).toISOString(),
                ...(internal.valid_to ? { endDateTime: new Date(internal.valid_to).toISOString() } : {})
            }
        };
    }
}
