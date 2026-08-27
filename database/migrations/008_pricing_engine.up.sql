-- 008_pricing_engine.up.sql

-- 1. offering_rate
CREATE TABLE offering_rate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    charge_spec_id UUID NOT NULL,
    market_id UUID NOT NULL,
    currency_code CHAR(3) NOT NULL,
    -- FLAG: Used NUMERIC(16,6) instead of NUMERIC(12,2) because telecom pricing 
    -- often resolves down to fractions of a cent (e.g., $0.0015 per MB or SMS).
    amount NUMERIC(16,6) NOT NULL, 
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_offering_rate_market UNIQUE (tenant_id, charge_spec_id, market_id),
    CONSTRAINT fk_offering_rate_charge_spec FOREIGN KEY (tenant_id, charge_spec_id) REFERENCES charge_specification(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_offering_rate_market FOREIGN KEY (tenant_id, market_id) REFERENCES market_master(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_offering_rate_currency FOREIGN KEY (currency_code) REFERENCES currency_master(currency_code) ON DELETE RESTRICT
);

CREATE INDEX idx_offering_rate_tenant ON offering_rate(tenant_id);
CREATE INDEX idx_offering_rate_charge ON offering_rate(charge_spec_id);
CREATE INDEX idx_offering_rate_market ON offering_rate(market_id);

-- 2. offering_market_mapping
CREATE TABLE offering_market_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    offering_id UUID NOT NULL,
    market_id UUID NOT NULL,
    restriction VARCHAR(10) NOT NULL DEFAULT 'EXCLUDE',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_offering_market_mapping UNIQUE (tenant_id, offering_id, market_id),
    CONSTRAINT chk_omm_restriction CHECK (restriction IN ('INCLUDE', 'EXCLUDE')),
    CONSTRAINT fk_omm_offering FOREIGN KEY (tenant_id, offering_id) REFERENCES product_offering(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_omm_market FOREIGN KEY (tenant_id, market_id) REFERENCES market_master(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_omm_tenant ON offering_market_mapping(tenant_id);
CREATE INDEX idx_omm_offering ON offering_market_mapping(offering_id);
CREATE INDEX idx_omm_market ON offering_market_mapping(market_id);
