# TM Forum Alignment

The core rule of the Telecom Product Catalogue Engine (v2) is its strict two-layer architecture.

**Only the following entities are exposed via the TMF620 adapter layer:**
- `ProductSpecification`
- `ProductOffering`
- `ProductOfferingPrice` (which is the external representation of our internal charge/rate resolution engine)

**Everything else is strictly internal.**
Internal engine constructs such as `service_specification`, `charge_specification`, `offering_rate`, `market_master`, `price_override`, `policy_schema`, etc., are internal concerns designed to power the resolution engine efficiently. They **never** appear in a TMF620 response body and their table structures are not influenced by the TMF JSON shape.

External CRMs, Order Management systems, or BSS applications consume this catalogue purely through the TMF620 REST JSON standard over the adapter layer, without any knowledge of the underlying internal schema.
