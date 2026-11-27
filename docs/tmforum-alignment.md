# TM Forum Alignment

External systems see the catalogue only through TMF620 Product Catalog Management v5 at `/productCatalogManagement/v5`. Internal constructs (`service_specification`, `charge_specification`, `offering_rate`, `market_master`, `price_override`, `policy_*`, tax, GL) never appear in a TMF620 body. Their table shapes are not influenced by TMF JSON.

## Resources

| Resource | Operations | Source |
|---|---|---|
| `productSpecification` | GET list/id, POST, PATCH, DELETE | `product_specification` |
| `productOffering` | GET list/id, POST, PATCH, DELETE | `product_offering` + its version |
| `productOfferingPrice` | GET list/id | `offering_rate` resolved through `resolve_price()` |
| `catalog` | GET list/id | `catalogue` + its published version |
| `category` | GET list/id | `offering_category` |

## Field mapping

| TMF620 | Internal |
|---|---|
| `ProductOffering.lifecycleStatus` | version status: DRAFT → `In design`, APPROVED → `In test`, RELEASED → `Launched`, RETIRED → `Retired` |
| `ProductOffering.version` / `validFor` | catalogue version label / validity |
| `ProductOffering.isSellable` | version is RELEASED |
| `ProductOffering.isBundle` | `offering_type = BUNDLE` |
| `ProductOffering.productOfferingPrice[]` | the offering's rates |
| `ProductOffering.productOfferingRelationship[]` | `offering_relationship`: `requires`, `excludes`, `upgradeTo` |
| `ProductSpecification.lifecycleStatus` | `status`: DRAFT ↔ `In design`, ACTIVE ↔ `Active`, RETIRED ↔ `Retired`, OBSOLETE ↔ `Obsolete` |
| `ProductOfferingPrice.priceType` | `charge_type`: RECURRING → `recurring`, ONE_TIME → `oneTime`, USAGE → `usage` |
| `recurringChargePeriodType` / `Length` | `charge_period` (QUARTER → month × 3) |
| `price {unit, value}` or `percentage` | resolved amount and currency; PERCENTAGE charges use `percentage` |
| `place[]` | the market of the rate (`@referredType: GeographicSite`) |
| `priceResolution` (extension) | which layer produced the price, and the catalogue value |

## Conventions (TMF630)

- Paging: `offset`, `limit` (≤ 1000). `X-Total-Count` and `X-Result-Count` headers. `206 Partial Content` when more exist.
- Attribute selection: `?fields=name,lifecycleStatus` (`id`, `href` and `@type` are always kept).
- Filters: `name`, `lifecycleStatus` (specifications), `productSpecification.id` (offerings), `productOffering.id` (prices).
- Price context: `marketId`, `subscriberId`, `accountId`, `effectiveAt`.
- PATCH accepts `application/json` and `application/merge-patch+json`.
- POST returns `201` with a `Location` header.
- Errors use the TMF `Error` shape: `{ "@type": "Error", "code", "reason", "message", "status" }`.
- `href` values use `PUBLIC_BASE_URL` when set, otherwise the request's host.

## Versions

- Reads default to the **published** version of each catalogue.
- Send `x-catalogue-version-id` to read a specific version, e.g. a draft under test.
- Creating an offering requires that header to name a DRAFT version.
- A PATCH that names a version must match the offering's own version.

## Known gaps

- No TMF620 event notifications (hub/listener). Event infrastructure is out of scope for this stage.
- `productSpecification` is tenant-level, not version-scoped. Its code and name freeze once a released offering uses it.
- `place` references markets that TMF620 does not serve. A geographic-site API would be a separate component.
