// TMF620 v5.0.0 interfaces

export interface TMFProductSpecification {
    id: string;
    href: string;
    name: string;
    description?: string;
    lifecycleStatus: string;
    version?: string;
    validFor?: {
        startDateTime: string;
        endDateTime?: string;
    };
    // Note: No internal fields like tenant_id are present here.
}

export interface TMFProductSpecificationRef {
    id: string;
    href: string;
    name?: string;
}

export interface TMFProductOffering {
    id: string;
    href: string;
    name: string;
    description?: string;
    lifecycleStatus: string; // TMF620 requires lifecycleStatus on ProductOffering. We don't have it explicitly on offering in our internal model, so we might derive or default it, but we can't invent non-TMF fields.
    version?: string;
    validFor?: {
        startDateTime: string;
        endDateTime?: string;
    };
    productSpecification: TMFProductSpecificationRef;
    // Note: No tenant_id, catalogue_version_id, offering_type, service_type are present here.
}
