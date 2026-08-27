# Pricing Engine & Resolution

This document outlines the determinism of price resolution within the telecom product catalogue.

## 1. Scope & Precedence
The engine strictly resolves price via the following precedence hierarchy:
1. `SUBSCRIBER` override
2. `ACCOUNT` override
3. `MARKET` override
4. `CATALOGUE_RATE` (Base `offering_rate` amount)

Overrides are stored in `price_override` and never mutate the actual `offering_rate` row. The `scope_reference_id` is an opaque identifier since external systems provide subscriber/account IDs.

## 2. Effective Dating & Overlap Rules
- **Effective Duration:** `effective_from <= effective_at AND (effective_to IS NULL OR effective_to > effective_at)`.
- **Date Range Integrity:** `CHECK (effective_to IS NULL OR effective_to > effective_from)` prevents inverted date ranges at the database level.
- **Overlap Prevention:** Handled in the application service layer (`priceOverrideService.ts`) using transactional row-level locking (`SELECT ... FOR UPDATE` on the target `offering_rate`). The service queries for existing active overrides that would overlap and rejects the insert if any are found. This approach was chosen over a database trigger per the project architecture rule that business logic belongs in the service layer, not in database triggers.
- **Deterministic Tie-Breaking:** If overlapping overrides somehow exist (e.g. inserted via direct SQL), `resolve_price()` uses `ORDER BY effective_from DESC LIMIT 1` to deterministically select the most recently effective override rather than returning an arbitrary result.

## 3. The `resolve_price` Function
The database provides `resolve_price(tenant_id, offering_rate_id, subscriber_id, account_id, market_id, effective_at)`.
It returns a composite `(amount NUMERIC(16,6), source VARCHAR)` showing both the computed numeric cost and how it was decided.

## 4. Known Limitations
- **priceType Mapping:** The internal `calculation_type` (`FLAT`/`PERCENTAGE`) does not contain sufficient information to map to TMF620 `priceType` (`recurring`/`oneTime`/`usage`). A `charge_period` field on `charge_specification` would be needed to distinguish recurring from one-time charges.
- **Scalability:** The `GET /productOfferingPrice` list endpoint currently resolves every `offering_rate` in the tenant via `CROSS JOIN LATERAL resolve_price(...)`. Pagination must be added before production deployment.
