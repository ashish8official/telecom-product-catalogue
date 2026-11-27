/**
 * TMF620 Product Catalog Management v5 resource shapes (the subset this engine exposes).
 * These types belong to the adapter layer only; nothing in the domain imports them.
 */

export interface TimePeriod {
    startDateTime?: string;
    endDateTime?: string;
}

export interface Money {
    unit: string;
    value: number;
}

interface Entity {
    id: string;
    href: string;
    '@type': string;
    '@baseType'?: string;
    '@schemaLocation'?: string;
}

export interface EntityRef {
    id: string;
    href?: string;
    name?: string;
    '@referredType': string;
}

export interface TMFProductSpecification extends Entity {
    name: string;
    lifecycleStatus: string;
    lastUpdate?: string;
    validFor: TimePeriod;
}

export interface ProductOfferingRelationship {
    id: string;
    href: string;
    name?: string;
    relationshipType: string;
    '@referredType': 'ProductOffering';
}

export interface TMFProductOffering extends Entity {
    name: string;
    version?: string;
    lifecycleStatus: string;
    isBundle: boolean;
    isSellable: boolean;
    lastUpdate?: string;
    validFor?: TimePeriod;
    productSpecification: EntityRef;
    productOfferingPrice?: EntityRef[];
    productOfferingRelationship?: ProductOfferingRelationship[];
    category?: EntityRef[];
}

export interface TMFProductOfferingPrice extends Entity {
    name: string;
    description?: string;
    version?: string;
    lifecycleStatus: string;
    lastUpdate?: string;
    priceType: 'recurring' | 'oneTime' | 'usage';
    recurringChargePeriodType?: string;
    recurringChargePeriodLength?: number;
    percentage?: number;
    price?: Money;
    validFor?: TimePeriod;
    place?: EntityRef[];
    /** Extension: which layer of the resolution engine produced the price. */
    priceResolution?: { source: string; catalogueValue: number };
}

export interface TMFCatalog extends Entity {
    name: string;
    description?: string;
    version?: string;
    lifecycleStatus: string;
    lastUpdate?: string;
    validFor?: TimePeriod;
    catalogType: 'productCatalog';
}

export interface TMFCategory extends Entity {
    name: string;
    isRoot: boolean;
    parentId?: string;
    lifecycleStatus: string;
    lastUpdate?: string;
}

/** Shapes accepted on POST/PATCH. Unknown properties are ignored, as TMF630 allows. */
export interface ProductSpecificationWrite {
    name?: string;
    lifecycleStatus?: string;
    validFor?: TimePeriod;
}

export interface ProductOfferingWrite {
    name?: string;
    isBundle?: boolean;
    productSpecification?: { id?: string };
}
