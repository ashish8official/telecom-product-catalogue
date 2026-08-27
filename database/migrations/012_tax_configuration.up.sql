CREATE TABLE tax_configuration (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    tax_name VARCHAR(255) NOT NULL,
    tax_rate NUMERIC(9,6) NOT NULL,
    market_master_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT chk_tax_rate_bounds CHECK (tax_rate >= 0 AND tax_rate <= 100),
    CONSTRAINT uq_tax_config_tenant UNIQUE (tenant_id, id),
    CONSTRAINT fk_tax_config_market FOREIGN KEY (tenant_id, market_master_id) REFERENCES market_master(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_tax_config_tenant ON tax_configuration(tenant_id);
CREATE INDEX idx_tax_config_market ON tax_configuration(market_master_id);

CREATE TABLE tax_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    charge_specification_id UUID NOT NULL,
    tax_configuration_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_tax_mapping UNIQUE (tenant_id, charge_specification_id, tax_configuration_id),
    CONSTRAINT fk_tax_mapping_charge FOREIGN KEY (tenant_id, charge_specification_id) REFERENCES charge_specification(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_tax_mapping_tax FOREIGN KEY (tenant_id, tax_configuration_id) REFERENCES tax_configuration(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_tax_mapping_tenant ON tax_mapping(tenant_id);
CREATE INDEX idx_tax_mapping_charge ON tax_mapping(charge_specification_id);
CREATE INDEX idx_tax_mapping_tax ON tax_mapping(tax_configuration_id);
