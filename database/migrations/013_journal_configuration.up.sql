CREATE TABLE journal_configuration (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    gl_code VARCHAR(255) NOT NULL,
    gl_description VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_journal_config_tenant UNIQUE (tenant_id, id),
    CONSTRAINT uq_journal_config_code UNIQUE (tenant_id, gl_code)
);

CREATE INDEX idx_journal_config_tenant ON journal_configuration(tenant_id);

CREATE TABLE journal_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    charge_specification_id UUID NOT NULL,
    journal_configuration_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_journal_mapping UNIQUE (tenant_id, charge_specification_id, journal_configuration_id),
    CONSTRAINT fk_journal_mapping_charge FOREIGN KEY (tenant_id, charge_specification_id) REFERENCES charge_specification(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_journal_mapping_config FOREIGN KEY (tenant_id, journal_configuration_id) REFERENCES journal_configuration(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_journal_mapping_tenant ON journal_mapping(tenant_id);
CREATE INDEX idx_journal_mapping_charge ON journal_mapping(charge_specification_id);
CREATE INDEX idx_journal_mapping_config ON journal_mapping(journal_configuration_id);
