# Market Resolution

## Model

`market_master` is a tenant-scoped tree of arbitrary depth. No fixed continent→country→city levels are assumed.

| Field | Meaning |
|---|---|
| `market_type` | `GROUP`, `COUNTRY`, `REGION`, `CITY`, `ZONE`: descriptive only |
| `is_pricing_market` | Only pricing markets may hold rates. Grouping markets such as "Africa" cannot. |
| `timezone` | IANA zone (`Africa/Lagos`), validated against the tz database on write. Optional for grouping markets. |
| `default_currency_code` | ISO 4217. Used when a rate is entered without a currency. |

Market ≠ timezone ≠ currency: each is its own field, and none is derived from another.

## Ancestry

`market_ancestry(tenant_id, market_id)` (migration 020) returns `(market_id, depth)` for the market (depth 0) and each ancestor. It is one recursive query that carries a visited-path guard, so even a corrupt cyclic tree terminates. Writes are protected separately: `check_market_cycle()` is called by the service layer before a parent change, under a per-tenant advisory lock.

## What follows the hierarchy

Everything follows the rule "nearest market wins":

| Concern | Behaviour |
|---|---|
| Rates | Lagos uses Nigeria's rate unless Lagos has its own |
| MARKET price overrides | an override on Nigeria applies in Lagos unless Lagos has its own |
| Tax | a tax on Nigeria applies in Lagos (`PARENT_MARKET`); a tax with no market applies everywhere (`GENERIC`) |
| Market restrictions | see below |

## Restrictions (`offering_market_mapping`)

Resolved default: **no mapping = allowed; only EXCLUDE restricts.**

- `EXCLUDE` on a market excludes it and every market beneath it.
- `INCLUDE` never restricts anything on its own. It is a carve-out that re-allows a market beneath an excluded ancestor.
- Walking up from the requested market, the first mapping found decides.

| Mappings | Lagos | Kenya |
|---|---|---|
| none | allowed | allowed |
| EXCLUDE Nigeria | excluded | allowed |
| EXCLUDE Africa | excluded | excluded |
| EXCLUDE Africa, INCLUDE Nigeria | allowed | excluded |
| INCLUDE Kenya (only) | allowed | allowed |

The last row is deliberate. The earlier implementation treated any INCLUDE row as an allow-list that silently blocked every other market, which contradicted the resolved default.
