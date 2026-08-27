# Seed Data Fixture (Task 017A)

This document describes the canonical seed dataset used for integration testing the Telecom Product Catalogue Engine.

## 1. Purpose
The realistic telecom seed (`database/seeds/017_realistic_telecom_seed.sql`) exists to provide a stable, canonical integration-test fixture for the Resolution Engine. It contains a full web of product configurations reflecting a multi-market African and Indian telecom scenario.

This data is used to test **configuration state**, verifying that limits, exclusions, pricing relationships, and eligibility boundaries can be correctly established in the schema. **It does not perform runtime resolution.**

## 2. Test & Local Database Safety
**Safety Guard:** The seed SQL script contains an explicit environment safety block. It executes `SELECT current_database()` and will `RAISE EXCEPTION` and halt if the target database is not named `catalogue_db` or `catalogue_test`.

**This guarantees the seed script can never accidentally wipe a staging or production database.**

## 3. Idempotency & Reset Behavior
The seed uses a fixed, predictable `tenant_id` (`17000000-0000-4000-a000-000000000000`) for all seeded records.
Before inserting any new data, the script explicitly deletes all records associated with this specific `tenant_id` in reverse dependency order.

This ensures:
1. The script can be run an infinite number of times.
2. It will never create duplicate markets, offerings, rates, or relationships.
3. It resets the environment to a perfectly pristine state every time it is executed.

## 4. Market-Code Convention
The script adheres strictly to the following canonical `market_code` convention across all tables:
* `IND` (India)
* `AFR` (Africa, parent)
* `NGA` (Nigeria)
* `LAGOS` (Lagos)
* `KEN` (Kenya)
* `ZAF` (South Africa)

## 5. Canonical Telecom Scenario
The seed represents a telecom selling M2M and Voice solutions:
* **M2M Basic Plan** (BASE) - with recurring monthly charges that vary by market.
* **Static IP Add-on** (ADDON) - restricted (EXCLUDE) in South Africa, and explicitly REQUIRES the M2M Basic Plan.
* **Prepaid Voice** (STANDALONE).

## 6. What the Smoke Tests Prove (Configuration Verification)
The `backend/run_seed_smoke_test.js` script asserts that:
* The Nigeria Base Rate is correctly configured at exactly `1299 NGN`.
* India is `699 INR`, Kenya is `499 KES`, South Africa is `299 ZAR`.
* A subscriber override exists for `999 NGN` in Nigeria, and its insertion does not mutate the original `1299 NGN` base rate.
* The ZAF market explicitly contains an `EXCLUDE` restriction for the Static IP offering.
* The M2M_STATIC_IP offering explicitly `REQUIRES` M2M_BASE.
* A B2B policy enforcing `{"account_category": "CORPORATE"}` is correctly mapped to M2M_BASE.
* Financial metadata (7.5% Tax, GL `4000-REV-M2M`) is accurately bound to the M2M recurring charge.

## 7. What the Smoke Tests Intentionally Do NOT Prove
* They **do not** test dynamic runtime tax calculation (e.g., compounding tax).
* They **do not** evaluate whether a specific external user's JSON payload satisfies the policy schema.
* They **do not** prove full runtime resolution engine logic.

They simply prove the database integrity, referential validity, and configurability of the catalog.
