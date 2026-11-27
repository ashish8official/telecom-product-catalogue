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
  * **Key Fields**: charge_code, charge_name, charge_priority (deterministic charge stacking by charge_priority ascending), stacking_rule (`ADDITIVE` / `OVERRIDE`), calculation_type (`FLAT` / `PERCENTAGE`), charge_type (`RECURRING` / `ONE_TIME` / `USAGE`), charge_period (`DAY` / `WEEK` / `MONTH` / `QUARTER` / `YEAR`, required exactly when charge_type is `RECURRING`), tenant_id. (charge_type/charge_period added in migration 018.)
  * **PERCENTAGE semantics**: the rate amount is a percentage applied to the running subtotal of the charges evaluated before it (same currency). A negative percentage is a discount.
  * **PK**: id.
* **`offering_charge_component`**: Links offering to charging rules.
  * **Purpose**: Maps an offering to its internal charge specifications.
  * **Key Fields**: tenant_id.
  * **FK**: product_offering_id → product_offering, charge_specification_id → charge_specification.

### Pricing & Resolution
* **`offering_rate`**: The base cost of one charge of one offering in one market.
  * **Key Fields**: offering_id, charge_spec_id, market_id, amount (`NUMERIC(16,6)`), currency_code, tenant_id.
  * **FK**: (tenant_id, offering_id, charge_spec_id) → offering_charge_component (cascade), charge_spec_id → charge_specification, market_id → market_master (restrict), currency_code → currency_master.
  * **Constraint**: UNIQUE(tenant_id, offering_id, charge_spec_id, market_id). Because the rate hangs off the offering's charge component, two offerings that share a charge specification are priced independently, and every rate belongs to exactly one catalogue version (migration 017).
  * **Market fallback**: a market with no rate of its own uses the rate of its nearest ancestor market.
* **`offering_rate_orphan_archive`**: Data-preservation table created by migration 017 for rates that were not reachable from any offering when rates became offering-scoped. Holds the original rate row and its overrides as JSON; the 017 rollback restores them. Not used by the engine.
* **`price_override`**: Entity-specific price modifications.
  * **Purpose**: Overrides the base offering rate at the SUBSCRIBER, ACCOUNT, or MARKET level. Never mutates the base rate.
  * **Key Fields**: scope_type, scope_reference_id (opaque identifier), override_amount (`NUMERIC(16,6)`), effective_from, effective_to.
  * **FK**: offering_rate_id → offering_rate (composite tenant-safe FK).
  * **Overlap Prevention**: Transactional validation blocks overlapping active overrides for the same scope.

### Locality & Master Data
* **`market_master`**: Global market definitions.
  * **Purpose**: IANA timezones and general regions. Does not assume fixed depth.
  * **Key Fields**: market_code, market_name, parent_market_id, market_type (`GROUP` / `COUNTRY` / `REGION` / `CITY` / `ZONE`), is_pricing_market, timezone (IANA, nullable for grouping markets), default_currency_code (nullable), status, effective_from / effective_to, tenant_id (migration 007).
  * **PK**: id.
  * **Hierarchy**: `market_ancestry(tenant_id, market_id)` (migration 020) returns a market and its ancestors nearest-first, cycle-safe. Rates, MARKET overrides, taxes and market restrictions all resolve through it.
* **`offering_market_mapping`**: Market restrictions.
  * **Purpose**: Determines where an offering can be sold.
  * **Key Fields**: restriction ('INCLUDE' / 'EXCLUDE'), tenant_id.
  * **FK**: offering_id → product_offering, market_id → market_master.
  * **Defaults**: Market restriction default: no mapping row = allowed. Only `EXCLUDE` rows restrict. An EXCLUDE also covers every market beneath it. An INCLUDE never restricts on its own: it re-allows a market below an excluded ancestor. The mapping nearest to the market wins.
* **`currency_master`**: Global currency definitions (shared by all tenants; reference data, not catalogue data).
  * **Purpose**: ISO 4217 currency codes used for all charging.
  * **Key Fields**: currency_code (ISO 4217), currency_name.
  * **PK**: currency_code.

### Configuration & Policy
* **`offering_relationship`**: Bundling, prerequisites, and incompatibilities.
  * **Purpose**: Links offerings together (e.g., add-ons, prerequisites).
  * **Key Fields**: relationship_type, tenant_id. Allowed types: 'REQUIRES', 'EXCLUDES', 'UPGRADE'.
  * **FK**: source_offering_id → product_offering, target_offering_id → product_offering.
  * **Constraint**: Circular relationship protection is handled by a recursive CTE cycle check in a DB function (`check_offering_relationship_cycle`), called from the service layer (not a trigger). Cycle detection only applies to directed dependencies ('REQUIRES', 'UPGRADE'). Mutual 'EXCLUDES' is permitted and does not constitute a cycle.
* **`offering_category`**: UI and organizational grouping.
  * **Purpose**: Presentation only. No pricing, billing, provisioning, or eligibility meaning.
  * **Key Fields**: name, parent_category_id, tenant_id.
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
  * **Purpose**: The dynamic JSON data defining business eligibility rules (e.g., `{"account_category": "CORPORATE"}`). Validated against its schema by the service layer on every write. Evaluated by `resolve_policy` (see docs/policy-engine.md).
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

---

## SECTION C — Version scoping and immutability (migration 019)

* **Version content** — `product_offering` and everything hanging off an offering (`offering_service_component`, `offering_charge_component`, `offering_rate`, `offering_market_mapping`, `offering_relationship`, `policy_mapping`) — is writable only while its `catalogue_version` is `DRAFT`. Content freezes at `APPROVED`.
* **Tenant-level definitions** (`product_specification`, `charge_specification`, `service_specification`, `policy_rule`) referenced by a non-DRAFT version keep their lifecycle fields editable, but their defining fields are frozen. A `policy_schema` with rules bound to it is frozen; publish a new schema version instead.
* **Not frozen**: `price_override` (runtime commercial terms, applied against released rates) and `offering_category_mapping` (presentation only).
* An offering can never move between versions. RELEASED/RETIRED versions cannot be deleted individually; deleting a whole catalogue still cascades.
* Violations raise SQLSTATE `CV001` (HTTP 409).
* **Published version**: per catalogue, the RELEASED version with the latest `valid_from` that has started and not ended. Releasing a newer version supersedes the old one for readers without editing it.
* **Cloning** a version deep-copies offerings, components, rates, restrictions, relationships, policy and category mappings, and carries active/future price overrides onto the copied rates.

## Infrastructure tables

* **`schema_migrations`**: version, name, checksum, applied_at — written by the migration runner (backend/db/migrator.ts). Not a catalogue table and carries no tenant_id.

## ER-Relationship List

* catalogue_version --FK--> catalogue
* product_offering --FK--> product_specification
* offering_service_component --FK--> product_offering
* offering_service_component --FK--> service_specification
* offering_charge_component --FK--> product_offering
* offering_charge_component --FK--> charge_specification
* offering_rate --FK--> offering_charge_component (tenant_id, offering_id, charge_spec_id)
* offering_rate --FK--> market_master
* offering_rate --FK--> currency_master
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
* tax_configuration --FK--> market_master (nullable)
* tax_mapping --FK--> charge_specification, tax_configuration
* journal_mapping --FK--> charge_specification, journal_configuration
* market_master --FK--> market_master (parent), currency_master
