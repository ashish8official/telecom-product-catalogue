# Domain Model

This document outlines the internal domain model and the external TMF-aligned entities for the Telecom Product Catalogue Engine.

## SECTION A — Internal domain model

This section represents our engine's own internal domain and is explicitly *not* shaped like TMF JSON. 

### Core Catalogue Entities
* **`catalogue`**: Grouping of product catalogue versions.
  * **Key Fields**: name, description, tenant_id.
  * **PK**: id (UUID).
* **`catalogue_version`**: An immutable snapshot of configuration for a given release cycle.
  * **Purpose**: Defines the commercial configuration version. Immutable after release.
  * **Key Fields**: version, status, valid_from, valid_to, tenant_id.
  * **PK**: id (UUID).
  * **FK**: catalogue_id → catalogue.
  * **Constraint**: UNIQUE(catalogue_id, version). Catalogue version is immutable after release: `Draft → Approved → Released → Retired`.

### Product & Components
* **`product_offering`**: The sellable entity (e.g., M2M_199).
  * **Purpose**: What the customer actually buys.
  * **Key Fields**: name, code, tenant_id.
  * **PK**: id.
  * **FK**: product_specification_id → product_specification (See Section B).
* **`service_specification`**: Internal engine construct for provisioning.
  * **Purpose**: Defines the technical network service to be provisioned (not a TMF sibling to product_specification).
  * **Key Fields**: code, name, tenant_id.
  * **PK**: id.
* **`offering_service_component`**: Link between offering and provisioning logic.
  * **Purpose**: Maps offerings to their requisite technical services.
  * **Key Fields**: tenant_id.
  * **FK**: product_offering_id → product_offering, service_specification_id → service_specification.
* **`charge_specification`**: Internal engine construct for charging.
  * **Purpose**: Defines a charge logic component (e.g., Monthly Recurring, Activation Fee).
  * **Key Fields**: charge_type, charge_priority (deterministic charge stacking by charge_priority ascending), tenant_id.
  * **PK**: id.
* **`offering_charge_component`**: Links offering to charging rules.
  * **Purpose**: Maps an offering to its internal charge specifications.
  * **Key Fields**: tenant_id.
  * **FK**: product_offering_id → product_offering, charge_specification_id → charge_specification.

### Pricing & Resolution
* **`offering_rate`**: The standard pricing for a given charge component.
  * **Purpose**: The catalogue base rate for a specific charge.
  * **Key Fields**: amount, rate_code, tenant_id.
  * **PK**: id.
  * **FK**: offering_charge_component_id → offering_charge_component.
* **`price_override`**: Conditional price alterations.
  * **Purpose**: Modifies price dynamically at runtime (resolved via Subscriber → Account → Market → Catalogue Rate) without mutating the standard `offering_rate`.
  * **Key Fields**: condition, amount, tenant_id.
  * **PK**: id.
  * **FK**: offering_rate_id → offering_rate.

### Locality & Master Data
* **`market_master`**: Global market definitions.
  * **Purpose**: IANA timezones and general regions. Does not assume fixed depth.
  * **Key Fields**: market_code, timezone, tenant_id.
  * **PK**: id.
* **`offering_market_mapping`**: Market restrictions.
  * **Purpose**: Determines where an offering can be sold.
  * **Key Fields**: inclusion_type ('INCLUDE' / 'EXCLUDE'), tenant_id.
  * **FK**: product_offering_id → product_offering, market_master_id → market_master.
  * **Defaults**: Market restriction default: no mapping row = allowed. Only `EXCLUDE` rows restrict.
* **`currency_master`**: Global currency definitions.
  * **Purpose**: ISO 4217 currency codes used for all charging.
  * **Key Fields**: currency_code (ISO 4217), tenant_id.
  * **PK**: id.

### Configuration & Policy
* **`offering_relationship`**: Bundling, prerequisites, and incompatibilities.
  * **Purpose**: Links offerings together (e.g., add-ons, prerequisites).
  * **Key Fields**: relationship_type, tenant_id. Allowed types: 'REQUIRES', 'EXCLUDES', 'UPGRADE'.
  * **FK**: source_offering_id → product_offering, target_offering_id → product_offering.
  * **Constraint**: Circular relationship protection is handled by a recursive CTE cycle check in a DB function (`check_offering_relationship_cycle`), called from the service layer (not a trigger). Cycle detection only applies to directed dependencies ('REQUIRES', 'UPGRADE'). Mutual 'EXCLUDES' is permitted and does not constitute a cycle.
* **`offering_category`**: UI and organizational grouping.
  * **Purpose**: Presentation only. No pricing, billing, provisioning, or eligibility meaning.
  * **Key Fields**: name, hierarchy_level, tenant_id.
  * **PK**: id.
* **`offering_category_mapping`**: Assignment to categories.
  * **Purpose**: Maps offerings to categories.
  * **Key Fields**: tenant_id.
  * **FK**: product_offering_id → product_offering, category_id → offering_category.
* **`policy_schema`**: JSON schemas for policies.
  * **Purpose**: Defines the structural validation rules that a `policy_rule` JSON payload must pass (e.g., requires `market_code` as string). **JSON Schema is the STRUCTURAL SCHEMA**, not the business eligibility rule itself.
  * **Key Fields**: schema_name, version, schema_json, tenant_id.
  * **PK**: id.
  * **Versioning**: Policy schemas are versioned. If a material structure change occurs, a new version must be created so existing rules remain bound to their original version. Unique constraint on `tenant_id + schema_name + version`.
  * **Validation Boundary**: JSON Schema semantic validation MUST happen in the application/service layer. The DB does not perform JSON schema business validation via CHECK constraints or triggers.
* **`policy_rule`**: The actual policy data.
  * **Purpose**: The dynamic JSON data defining business eligibility rules (e.g., `{"market_code": "NIGERIA"}`). **Policy evaluation is intentionally deferred** and remains outside the scope of current persistence structure.
  * **Key Fields**: rule_json, tenant_id.
  * **PK**: id.
  * **FK**: schema_id → policy_schema (composite tenant-safe FK ensuring both belong to the same tenant).
* **`policy_mapping`**: Attaching policies to offerings.
  * **Purpose**: Binds a policy rule to a `product_offering`.
  * **Key Fields**: tenant_id.
  * **FK**: product_offering_id → product_offering, policy_rule_id → policy_rule (composite tenant-safe FKs to enforce strict tenant isolation).

> **Important Conceptual Boundaries for Policies**:
> 1. **Market Hierarchy**: The authoritative market structure remains `market_master`. Do not duplicate market hierarchies (like `policy_market` or `policy_country`) or hardcode timezones/regions into policy tables.
> 2. **Timezone Boundary**: Time-window evaluation is deferred to a future resolution engine which must derive timezone data from the runtime resolved market, not server local time.
> 3. **Unit-Credit Boundary**: `UNIT_CREDIT` represents a catalogue-defined discount/benefit. It is NOT a subscriber balance, real-time counter, charging bucket, or SPR balance. Actual usage tracking is outside the catalogue.
> 4. **Deferred Evaluation**: Do not build evaluation priorities, `ALL`/`ANY` operators, or lifecycle states into the policy tables unless explicitly required by later phases.

* **`tax_configuration`**: Setup for engine tax calculation.
  * **Purpose**: Defines which taxes apply to catalogue charges.
  * **Key Fields**: tax_name, tax_rate (percentage `NUMERIC(9,6)`), market_master_id (nullable), tenant_id.
  * **PK**: id.
  * **Validation**: `tax_rate >= 0` and `tax_rate <= 100`.
  * **FK**: market_master_id → market_master (tenant-safe composite FK). NULL market means the tax is universally applicable (fallback logic is handled by the future resolution engine).
* **`tax_mapping`**: Attaching tax to charges.
  * **Purpose**: Maps a specific tax to a `charge_specification`.
  * **Key Fields**: tenant_id.
  * **FK**: charge_specification_id → charge_specification, tax_configuration_id → tax_configuration (composite tenant-safe FKs to enforce strict isolation).
  * **Constraint**: Unique mapping per charge specification and tax configuration.
* **`journal_configuration`**: Ledger/GL definitions.
  * **Purpose**: Defines standard accounting GL codes used for financial reporting. Does NOT perform posting or calculate debits/credits.
  * **Key Fields**: gl_code, gl_description, tenant_id.
  * **PK**: id.
  * **Constraint**: `gl_code` must be unique per `tenant_id`.
* **`journal_mapping`**: Attaching GL codes to charges.
  * **Purpose**: Maps a specific GL code to a `charge_specification`. A charge may have multiple accounting mappings if needed.
  * **Key Fields**: tenant_id.
  * **FK**: charge_specification_id → charge_specification, journal_configuration_id → journal_configuration (composite tenant-safe FKs to enforce strict isolation).
  * **Constraint**: Unique mapping per charge specification and journal configuration.

---

## SECTION B — TMF-aligned product root

This section defines the core TM Forum (TMF620) entities that represent the product catalogue's conceptual root, and how they bridge into the internal engine.

### TMF Root Entities
* **`product_specification`**: 
  * **Purpose**: The true root of the product domain per TM Forum SID/TMF620 v5.0.0. This is the externally-meaningful grouping (e.g., `M2M_CONNECTIVITY` which groups `M2M_199` and `M2M_299`).
  * **Key Fields**: name, lifecycle_status, tenant_id.
  * **PK**: id (UUID).
  * **Distinction**: `product_specification` is **not** the same concept as `service_specification` or `charge_specification`. Service and charge specifications are internal engine plumbing for provisioning and financial logic. `product_specification` sits cleanly above `product_offering` and holds commercial grouping meaning. They are not siblings.

* **`product_offering` (FK connection)**:
  * Contains the foreign key `product_specification_id` pointing to `product_specification`.

---

## ER-Relationship List

* catalogue_version --FK--> catalogue
* product_offering --FK--> product_specification
* offering_service_component --FK--> product_offering
* offering_service_component --FK--> service_specification
* offering_charge_component --FK--> product_offering
* offering_charge_component --FK--> charge_specification
* offering_rate --FK--> offering_charge_component
* price_override --FK--> offering_rate
* offering_market_mapping --FK--> product_offering
* offering_market_mapping --FK--> market_master
* offering_relationship --FK--> product_offering (source)
* offering_relationship --FK--> product_offering (target)
* offering_category_mapping --FK--> product_offering
* offering_category_mapping --FK--> offering_category
* policy_rule --FK--> policy_schema
* policy_mapping --FK--> product_offering
* policy_mapping --FK--> policy_rule
