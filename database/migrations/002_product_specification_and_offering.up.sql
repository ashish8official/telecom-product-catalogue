CREATE TABLE product_specification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    spec_code VARCHAR(100) NOT NULL,
    spec_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    effective_from TIMESTAMPTZ DEFAULT NOW(),
    effective_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_product_spec_tenant_code UNIQUE (tenant_id, spec_code),
    CONSTRAINT chk_product_spec_effective_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX idx_product_spec_tenant ON product_specification(tenant_id);

CREATE TABLE product_offering (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    catalogue_version_id UUID NOT NULL REFERENCES catalogue_version(id) ON DELETE CASCADE,
    product_specification_id UUID NOT NULL REFERENCES product_specification(id) ON DELETE RESTRICT,
    offering_code VARCHAR(100) NOT NULL,
    offering_name VARCHAR(255) NOT NULL,
    offering_type VARCHAR(50) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_product_offering_tenant_ver_code UNIQUE (tenant_id, catalogue_version_id, offering_code),
    CONSTRAINT chk_product_offering_type CHECK (offering_type IN ('BASE', 'ADDON', 'BUNDLE', 'STANDALONE')),
    CONSTRAINT chk_product_offering_service_type CHECK (service_type IN ('PREPAID', 'POSTPAID', 'BOTH'))
);

CREATE INDEX idx_product_offering_tenant ON product_offering(tenant_id);
CREATE INDEX idx_product_offering_cat_ver ON product_offering(catalogue_version_id);
CREATE INDEX idx_product_offering_spec ON product_offering(product_specification_id);
