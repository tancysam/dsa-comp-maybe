# Legacy demo entity compatibility

Snapshots created before entity metadata was added contain the 18 original
synthetic customer records without `entity`. The graph previously showed these
under Unassigned, leaving SPD/QTS/QTG filters empty.

The legacy `/api/bootstrap` and `/api/graph` read paths now supply the known demo
fixture assignments (six each SPD/QTS/QTG) only when the entire customer record
exactly matches the fixture identity and has no entity field. This is demo fixture
metadata, not an inference from country, customer names, ticket roles or orders.

Existing assignments, including unknown or blank explicit values, are preserved.
Edited records, added fields, unfamiliar IDs, and custom records are not mapped;
missing/unknown ownership remains Unassigned in the graph. No snapshot, workflow,
request, order, audit entry or customer record is written or reset by this mapping.

The parallel ticket workspace has a separate historical import that labels its
legacy records SPD. It is not used as ownership authority for this graph and is
not changed by this focused fix. The graph continues to use legacy customers and
orders, not ticket records.

Tests exercise the actual HTTP read paths, exact six-per-entity counts, all 18
records, unchanged stored collections, modified identity fields, extra fields,
custom IDs and preservation of explicit assignments.
