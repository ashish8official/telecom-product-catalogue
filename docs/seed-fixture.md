# Seed Fixture

`database/seeds/017_realistic_telecom_seed.sql` is the canonical demo and integration fixture. Load it with `npm run db:seed`. The Jest suites load it into `catalogue_test` automatically.

## Safety and idempotency

- Refuses to run unless the database is `catalogue_db`, `catalogue_test` or the rollback scratch database.
- Uses two fixed tenant ids and deletes only their rows before inserting, so it can be re-run at any time. Released content is removed by deleting the whole catalogue, which the immutability guards allow.

## Tenant `17000000-0000-4000-a000-000000000000`: Afrindia Telecom

**Markets**: India; Africa (GROUP, not priced) › Nigeria › Lagos (CITY); Africa › Kenya; Africa › South Africa.

**Global Telecom Catalogue**

| Version | Status | Content |
|---|---|---|
| v1 | RELEASED (published) | M2M Basic, M2M Premium, Static IP add-on, Prepaid Voice |
| v2 | DRAFT | M2M Basic re-priced to 1399 NGN, new M2M Unlimited |

Scenarios the data exercises:

| Scenario | Data |
|---|---|
| Per-offering pricing of a shared charge | M2M Basic 1299 NGN vs. M2M Premium 2499 NGN, both on `RC_M2M_MONTHLY` |
| Recurring + one-time charges | M2M Basic: monthly fee + `OT_ACTIVATION` |
| Percentage discount | M2M Premium: `DISC_LAUNCH` −10% in Nigeria → 2249.10 NGN net |
| City inherits country rate and VAT | Lagos has no rates; Nigeria's rates and 7.5% VAT apply |
| Override precedence on M2M Basic / Nigeria | subscriber `SUB-NGA-001` 999 · account `ACC-CORP-01` 1150 · market override on Lagos 1199 · catalogue 1299 |
| Market restriction | Static IP EXCLUDE South Africa |
| Relationships | Static IP REQUIRES M2M Basic; M2M Basic UPGRADE → M2M Premium |
| Eligibility policy | M2M plans need `{"account_category": "CORPORATE"}` (schema rejects other keys) |
| Tax and GL | VAT/GST per country on every charge; GL per revenue stream, discounts to a contra account |
| Presentation | categories IoT & M2M › Add-ons, Consumer |

## Tenant `27000000-0000-4000-a000-000000000000`: Northwind Mobile

One released catalogue with one offering (Unlimited 5G, 65 USD/month). It exists to prove isolation: neither tenant can see the other's data.
