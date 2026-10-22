# Multi-warehouse from day one

Inventory Balances, Stock Movements, Goods Receipts, Transfers, and Reservations are keyed by Warehouse. Staff are restricted to assigned warehouses; Super Admins see all; Admins see all unless warehouse assignments narrow their scope. A Customer Order is allocated to a single fulfillment Warehouse at confirmation: the warehouse with the greatest Available quantity for every line, chosen deterministically.

**Why:** retrofitting warehouse scope into balances, locks, and reports later is a rewrite. Storage Locations exist as an optional model but are not used for balance math in v1.
