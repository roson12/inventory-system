# Reserve stock only when a Customer Order is confirmed

A new Customer Order is `PENDING` and holds no stock. Confirmation (Staff/Admin) runs in a single database transaction: lock the relevant Inventory Balance rows ordered by product ID, re-check Available, then create Reservations and increment `reserved`. Dispatch consumes reservations and reduces On-hand. Cancellation before dispatch releases reservations.

**Why:** there is no online payment in v1, so orders are requests; reserving at placement would let abandoned carts starve real demand. Confirmation is the point where the business commits.

**Concurrency:** `SELECT ... FOR UPDATE` on `inventory_balances` in deterministic product order, with a `READ COMMITTED` transaction. Confirmation is idempotent: a second confirm returns the existing state instead of double-reserving. Tests in `apps/api/src/test/orders.test.ts` cover concurrent oversell.

**Implementation:** `apps/api/src/services/orders.ts`, `apps/api/src/services/inventory.ts`.
