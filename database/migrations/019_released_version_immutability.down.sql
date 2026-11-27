-- 019_released_version_immutability.down.sql

DROP TRIGGER IF EXISTS trg_policy_schema_guard ON policy_schema;
DROP TRIGGER IF EXISTS trg_policy_rule_guard ON policy_rule;
DROP TRIGGER IF EXISTS trg_service_specification_guard ON service_specification;
DROP TRIGGER IF EXISTS trg_charge_specification_guard ON charge_specification;
DROP TRIGGER IF EXISTS trg_product_specification_guard ON product_specification;
DROP TRIGGER IF EXISTS trg_catalogue_version_delete_guard ON catalogue_version;
DROP TRIGGER IF EXISTS trg_policy_mapping_guard ON policy_mapping;
DROP TRIGGER IF EXISTS trg_offering_relationship_guard ON offering_relationship;
DROP TRIGGER IF EXISTS trg_offering_market_mapping_guard ON offering_market_mapping;
DROP TRIGGER IF EXISTS trg_offering_rate_guard ON offering_rate;
DROP TRIGGER IF EXISTS trg_offering_charge_component_guard ON offering_charge_component;
DROP TRIGGER IF EXISTS trg_offering_service_component_guard ON offering_service_component;
DROP TRIGGER IF EXISTS trg_product_offering_guard ON product_offering;

DROP FUNCTION IF EXISTS guard_policy_schema_update();
DROP FUNCTION IF EXISTS guard_policy_rule_update();
DROP FUNCTION IF EXISTS guard_service_specification_update();
DROP FUNCTION IF EXISTS guard_charge_specification_update();
DROP FUNCTION IF EXISTS guard_product_specification_update();
DROP FUNCTION IF EXISTS guard_catalogue_version_delete();
DROP FUNCTION IF EXISTS guard_offering_child_write();
DROP FUNCTION IF EXISTS guard_product_offering_write();
DROP FUNCTION IF EXISTS assert_offering_writable(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS assert_catalogue_version_writable(UUID, UUID, TEXT, TEXT);
