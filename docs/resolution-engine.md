# Resolution Engine

The resolution engine turns the configuration into a concrete answer for one context: *can this customer buy this offering here, now, and what will it cost?* It only reads, never writes. Each capability is an isolated, independently tested module. `services/pricingService.quoteOffering` composes them; there is no single giant `resolve()`.

| Step | Module | Notes |
|---|---|---|
| Market eligibility | `services/marketResolver.ts` | Hierarchy-aware; see [market-resolution.md](market-resolution.md) |
| Policy | `services/resolve_policy.ts` | JSON rules vs. runtime context; see [policy-engine.md](policy-engine.md) |
| Charge stacking | `services/apply_charge_stacking.ts` | priority ASC, id tie-break; OVERRIDE clears |
| Rate selection | `pricingService.nearestRate` | the market's own rate, else the nearest ancestor's |
| Overrides | `resolve_price()` (SQL, migrations 016/020) | subscriber › account › market (with ancestors) › catalogue |
| Calculation | `pricingService` + `domain/money.ts` | FLAT, or PERCENTAGE of the preceding subtotal |
| Tax | `services/resolve_tax.ts` | exact market, then ancestors, then generic; all matches apply |
| GL | `services/resolve_journal.ts` | mapped GL codes; never posts entries |

## ResolutionContext

```typescript
interface ResolutionContext {
    tenant_id: string;
    offering_id: string;
    market_id?: string;
    subscriber_id?: string;
    account_id?: string;
    effective_at: Date;
    context_json?: Record<string, any>;   // e.g. { "account_category": "CORPORATE" }
}
```

## Quote result

`POST /api/internal/quote` returns:

- `sellable`: true only when the market allows the offering, every policy passes, and every charge has a rate.
- `eligibility`, with the market that decided it.
- `policy`, with per-rule checks.
- `lines`: one per stacked charge, carrying the catalogue amount, resolved amount and its source, any percentage base, net, taxes, gross and GL.
- `totals` per currency, charge type and period.
- `relationships` (REQUIRES / EXCLUDES / UPGRADE) for the order system to enforce across a basket.
- `warnings`, e.g. a draft (provisional) version, a non-pricing market, or a missing rate.

## Fallback semantics

- No mapping anywhere means a clean empty or allow result (`[]`, `passed: true`), keeping the default-allow principle.
- A charge with no rate in the market or its ancestors becomes a `NO_RATE` line with a warning. The quote is then not sellable; it does not fail.
- Unit credits are catalogue-defined benefits, not balances. Real-time consumption stays in the external charging/SPR system.
