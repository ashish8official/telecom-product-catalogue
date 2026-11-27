# Pricing Engine

How a price is determined for one charge of one offering, for a given market, customer and instant.

## 1. Which rate applies

A rate (`offering_rate`) belongs to one offering's charge in one market (migration 017). For a requested market the engine uses:

1. the rate defined for that market, otherwise
2. the rate of its nearest ancestor (`market_ancestry`, migration 020).

So a rate set on Nigeria prices Lagos too, until Lagos is given its own rate. Grouping markets (`is_pricing_market = false`, e.g. Africa) cannot hold rates.

## 2. Override precedence

`resolve_price(tenant_id, offering_rate_id, subscriber_id, account_id, market_id, effective_at)` returns `(amount, source)`:

1. `SUBSCRIBER` override
2. `ACCOUNT` override
3. `MARKET` override, checking the requested market first and then its ancestors, nearest first
4. `CATALOGUE_RATE`, the base `offering_rate` amount

Overrides live in `price_override` and never mutate `offering_rate`. `scope_reference_id` is opaque, because subscriber and account ids belong to external systems. For MARKET scope, use the market's UUID so that hierarchy inheritance works. Any other string still matches exactly.

## 3. Effective dating and overlap

- **Active**: `effective_from <= at AND (effective_to IS NULL OR effective_to > at)`.
- **Date integrity**: `CHECK (effective_to IS NULL OR effective_to > effective_from)`.
- **No overlaps** per (rate, scope, reference): `priceOverrideService.createPriceOverride` locks the `offering_rate` row (`SELECT … FOR UPDATE`) and rejects overlapping periods with HTTP 409. Concurrent writers are serialised by that lock. A test fires five identical requests at once and asserts that exactly one succeeds.
- **Deterministic tie-break**: if overlapping rows exist anyway (e.g. raw SQL), `resolve_price` takes the latest `effective_from`.
- Overrides are not frozen by a release. They are commercial terms applied against released rates. Ending an override sets `effective_to`; history is kept.

## 4. Charge stacking and calculation

`apply_charge_stacking` orders an offering's charges by `charge_priority` ascending, with `id` as tie-breaker:

- `ADDITIVE`: added to the stack.
- `OVERRIDE`: clears everything accumulated before it, then starts the stack from this charge.

Then, per charge in that order:

- `FLAT`: the resolved amount is the charge.
- `PERCENTAGE`: the resolved amount is a percentage of the running subtotal of preceding charges in the same currency. A negative value is a discount. Example: `DISC_LAUNCH` at −10 after a 2499 NGN monthly fee gives −249.90.

## 5. Tax and GL

Each priced line gets every tax mapped to its charge that applies in the market: the exact market, any ancestor, or a tax with no market (generic). It also gets its GL codes. Tax is computed on the line's net amount. Totals are grouped by currency, charge type and period.

## 6. Arithmetic

Amounts are `NUMERIC(16,6)` in the database and BigInt micro-units in the engine (`domain/money.ts`). Floating point is never used for money. Rounding is half away from zero at 6 decimals. API responses carry amounts as decimal strings, except TMF620 `price.value`, which the standard defines as a number.

## 7. Where it is exposed

- `POST /api/internal/quote`: the full resolution (eligibility, policy, lines, taxes, GL, totals, warnings).
- `GET /productCatalogManagement/v5/productOfferingPrice`: one resolved price per rate. With `marketId`, only the rate that applies in that market is returned. `subscriberId`, `accountId` and `effectiveAt` apply overrides. `priceResolution.source` reports which layer produced the price.
