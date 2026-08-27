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
- **Overlap Prevention:** A transactional trigger (`check_price_override_overlap`) ensures that within the exact same `(tenant_id, offering_rate_id, scope_type, scope_reference_id)`, no two overrides overlap in time. "Most recently created wins" is strictly prohibited.

## 3. The `resolve_price` Function
The database provides `resolve_price(tenant_id, offering_rate_id, subscriber_id, account_id, market_id, effective_at)`.
It returns a composite `(amount NUMERIC(16,6), source VARCHAR)` showing both the computed numeric cost and how it was decided.
