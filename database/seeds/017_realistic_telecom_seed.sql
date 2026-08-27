-- ==============================================================================
-- TASK 017: Realistic Telecom Seed Data (Africa & India)
-- Uses a fixed Tenant ID for idempotency and testability.
-- ==============================================================================

BEGIN;

-- 0. Clean up previous seed data for this tenant
DO $$
DECLARE
    v_tenant UUID := '17000000-0000-4000-a000-000000000000';
BEGIN
    DELETE FROM journal_mapping WHERE tenant_id = v_tenant;
    DELETE FROM journal_configuration WHERE tenant_id = v_tenant;
    DELETE FROM tax_mapping WHERE tenant_id = v_tenant;
    DELETE FROM tax_configuration WHERE tenant_id = v_tenant;
    DELETE FROM policy_mapping WHERE tenant_id = v_tenant;
    DELETE FROM policy_rule WHERE tenant_id = v_tenant;
    DELETE FROM policy_schema WHERE tenant_id = v_tenant;
    DELETE FROM price_override WHERE tenant_id = v_tenant;
    DELETE FROM offering_relationship WHERE tenant_id = v_tenant;
    DELETE FROM offering_market_mapping WHERE tenant_id = v_tenant;
    DELETE FROM offering_rate WHERE tenant_id = v_tenant;
    DELETE FROM offering_charge_component WHERE tenant_id = v_tenant;
    DELETE FROM charge_specification WHERE tenant_id = v_tenant;
    DELETE FROM product_offering WHERE tenant_id = v_tenant;
    DELETE FROM product_specification WHERE tenant_id = v_tenant;
    DELETE FROM catalogue_version WHERE tenant_id = v_tenant;
    DELETE FROM catalogue WHERE tenant_id = v_tenant;
    -- Market hierarchy needs careful deletion or just delete all
    DELETE FROM market_master WHERE tenant_id = v_tenant;
END $$;

-- 1. Currencies (Global)
INSERT INTO currency_master (currency_code, currency_name) VALUES 
('INR', 'Indian Rupee'),
('NGN', 'Nigerian Naira'),
('KES', 'Kenyan Shilling'),
('ZAR', 'South African Rand')
ON CONFLICT (currency_code) DO NOTHING;

-- 2. Markets (Hierarchical)
INSERT INTO market_master (id, tenant_id, market_code, market_name, timezone, default_currency_code) VALUES
('17000000-0000-4000-a000-000000000001', '17000000-0000-4000-a000-000000000000', 'IND', 'India', 'Asia/Kolkata', 'INR'),
('17000000-0000-4000-a000-000000000002', '17000000-0000-4000-a000-000000000000', 'AFR', 'Africa', 'Africa/Lagos', 'NGN'),
('17000000-0000-4000-a000-000000000003', '17000000-0000-4000-a000-000000000000', 'NGA', 'Nigeria', 'Africa/Lagos', 'NGN'),
('17000000-0000-4000-a000-000000000004', '17000000-0000-4000-a000-000000000000', 'LAG', 'Lagos', 'Africa/Lagos', 'NGN'),
('17000000-0000-4000-a000-000000000005', '17000000-0000-4000-a000-000000000000', 'KEN', 'Kenya', 'Africa/Nairobi', 'KES'),
('17000000-0000-4000-a000-000000000006', '17000000-0000-4000-a000-000000000000', 'ZAF', 'South Africa', 'Africa/Johannesburg', 'ZAR');

-- Update Parent Hierarchy
UPDATE market_master SET parent_market_id = '17000000-0000-4000-a000-000000000002' WHERE id IN ('17000000-0000-4000-a000-000000000003', '17000000-0000-4000-a000-000000000005', '17000000-0000-4000-a000-000000000006');
UPDATE market_master SET parent_market_id = '17000000-0000-4000-a000-000000000003' WHERE id = '17000000-0000-4000-a000-000000000004';

-- 3. Catalogue & Versions
INSERT INTO catalogue (id, tenant_id, name) VALUES ('17000000-0000-4000-a000-000000000007', '17000000-0000-4000-a000-000000000000', 'Global Telecom Catalogue');

INSERT INTO catalogue_version (id, tenant_id, catalogue_id, version, status, valid_from) VALUES
('17000000-0000-4000-a000-000000000008', '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000007', 'v1', 'RELEASED', NOW() - INTERVAL '30 days'),
('17000000-0000-4000-a000-000000000009', '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000007', 'v2', 'DRAFT', NOW());

-- 4. Product Specifications
INSERT INTO product_specification (id, tenant_id, spec_code, spec_name) VALUES
('17000000-0000-4000-a000-000000000010', '17000000-0000-4000-a000-000000000000', 'M2M_CONNECTIVITY', 'M2M IoT Connectivity'),
('17000000-0000-4000-a000-000000000011', '17000000-0000-4000-a000-000000000000', 'VOICE_PLANS', 'Consumer Voice Plans');

-- 5. Product Offerings
INSERT INTO product_offering (id, tenant_id, catalogue_version_id, product_specification_id, offering_code, offering_name, offering_type, service_type) VALUES
('17000000-0000-4000-a000-000000000012', '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000008', '17000000-0000-4000-a000-000000000010', 'M2M_BASE', 'M2M Basic Plan', 'BASE', 'POSTPAID'),
('17000000-0000-4000-a000-000000000013', '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000008', '17000000-0000-4000-a000-000000000010', 'M2M_STATIC_IP', 'Static IP Add-on', 'ADDON', 'POSTPAID'),
('17000000-0000-4000-a000-000000000014', '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000008', '17000000-0000-4000-a000-000000000011', 'VOICE_PREPAID', 'Prepaid Voice 30-Day', 'STANDALONE', 'PREPAID');

-- 6. Charges & Rates (Reused across markets)
INSERT INTO charge_specification (id, tenant_id, charge_code, charge_name, charge_priority, stacking_rule, calculation_type) VALUES
('17000000-0000-4000-a000-000000000015', '17000000-0000-4000-a000-000000000000', 'RC_M2M_MONTHLY', 'M2M Monthly Recurring', 10, 'ADDITIVE', 'FLAT');

INSERT INTO offering_charge_component (id, tenant_id, offering_id, charge_spec_id) VALUES
(gen_random_uuid(), '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000012', '17000000-0000-4000-a000-000000000015');

INSERT INTO offering_rate (id, tenant_id, charge_spec_id, market_id, currency_code, amount) VALUES
('17000000-0000-4000-a000-000000000016', '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000015', '17000000-0000-4000-a000-000000000001', 'INR', 699.00),
('17000000-0000-4000-a000-000000000017', '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000015', '17000000-0000-4000-a000-000000000003', 'NGN', 1299.00),
('17000000-0000-4000-a000-000000000018', '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000015', '17000000-0000-4000-a000-000000000005', 'KES', 499.00),
('17000000-0000-4000-a000-000000000019', '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000015', '17000000-0000-4000-a000-000000000006', 'ZAR', 299.00);

-- 7. Market Restrictions (Explicit EXCLUDE)
INSERT INTO offering_market_mapping (id, tenant_id, offering_id, market_id, restriction) VALUES
(gen_random_uuid(), '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000013', '17000000-0000-4000-a000-000000000006', 'EXCLUDE');

-- 8. Offering Relationships (REQUIRES)
INSERT INTO offering_relationship (id, tenant_id, source_offering_id, target_offering_id, relationship_type) VALUES
(gen_random_uuid(), '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000013', '17000000-0000-4000-a000-000000000012', 'REQUIRES');

-- 9. Price Override (SUBSCRIBER scope)
INSERT INTO price_override (id, tenant_id, offering_rate_id, scope_type, scope_reference_id, override_amount, effective_from) VALUES
(gen_random_uuid(), '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000017', 'SUBSCRIBER', 'SUB-NGA-001', 999.00, NOW() - INTERVAL '10 days');

-- 10. Policy Data
INSERT INTO policy_schema (id, tenant_id, schema_name, version, schema_json) VALUES
('17000000-0000-4000-a000-000000000020', '17000000-0000-4000-a000-000000000000', 'B2B_ELIGIBILITY', '1.0', '{"type": "object", "properties": {"account_category": {"type": "string"}}}');

INSERT INTO policy_rule (id, tenant_id, schema_id, rule_json) VALUES
('17000000-0000-4000-a000-000000000021', '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000020', '{"account_category": "CORPORATE"}');

INSERT INTO policy_mapping (id, tenant_id, product_offering_id, policy_rule_id) VALUES
(gen_random_uuid(), '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000012', '17000000-0000-4000-a000-000000000021');

-- 11. Tax Data (Nigeria VAT)
INSERT INTO tax_configuration (id, tenant_id, tax_name, tax_rate, market_master_id) VALUES
('17000000-0000-4000-a000-000000000022', '17000000-0000-4000-a000-000000000000', 'Nigeria VAT', 7.50, '17000000-0000-4000-a000-000000000003');

INSERT INTO tax_mapping (id, tenant_id, charge_specification_id, tax_configuration_id) VALUES
(gen_random_uuid(), '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000015', '17000000-0000-4000-a000-000000000022');

-- 12. Journal (GL) Data
INSERT INTO journal_configuration (id, tenant_id, gl_code, gl_description) VALUES
('17000000-0000-4000-a000-000000000023', '17000000-0000-4000-a000-000000000000', '4000-REV-M2M', 'M2M Revenue Account');

INSERT INTO journal_mapping (id, tenant_id, charge_specification_id, journal_configuration_id) VALUES
(gen_random_uuid(), '17000000-0000-4000-a000-000000000000', '17000000-0000-4000-a000-000000000015', '17000000-0000-4000-a000-000000000023');

COMMIT;
