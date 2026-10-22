# Architecture

## Runtime topology

```
Browser
  │  HTTPS (Cloudflare edge)
  ▼
Cloudflare DNS / Tunnel (outbound-only connection from the host)
  │
  ▼
web  (Nginx container)
  ├── serves the built React SPA (try_files → index.html)
  └── proxies /api/* and /uploads/* to http://api:4000
        │
        ▼
      api  (Node.js + Express, non-root user)
        │  private Docker network
        ▼
      postgres  (no published port in production)
```

All services share the private Compose network `internal`. Only `web` publishes a port, and
`compose.yaml` binds it to `127.0.0.1`; public access is expected through Cloudflare Tunnel.
`cloudflared` is an optional Compose profile and opens no inbound ports.

In local development, `compose.dev.yaml` additionally publishes PostgreSQL on `127.0.0.1:5432`
and the API on `127.0.0.1:4000` so host-side tools and tests can reach them.

## Backend modules

| Area | Path | Responsibility |
|---|---|---|
| Config | `apps/api/src/config` | validated environment, session store |
| Middleware | `apps/api/src/middleware` | `requireAuth`, permission checks, warehouse scope, CSRF, Zod validation |
| Services | `apps/api/src/services` | stock movement engine, reservations, order state machine |
| Modules | `apps/api/src/modules` | one router per domain: auth, users, roles, products, categories, warehouses, inventory, suppliers, purchase orders, goods receipts, orders, returns, reports, notifications, audit logs, settings |
| Tests | `apps/api/src/test` | Vitest + Supertest against a disposable `ims_test` database |

Serialization rules: cost fields are only returned when the caller holds
`suppliers.costs.read` / `reports.financial`; public catalog reads return active products only.

## Authentication

- `express-session` stores sessions in the `session` table via `connect-pg-simple`.
- Cookie `ims.sid`: HttpOnly, SameSite=Lax, `Secure` when `COOKIE_SECURE=true`, 8-hour rolling expiry.
- Login regenerates the session ID; logout, password reset, role/status/password changes revoke
  sessions server-side.
- Argon2id hashes passwords. Five failed logins lock an account for 15 minutes.
- CSRF is a per-session random token exposed by `GET /api/auth/csrf`; every state-changing request
  must echo it in `x-csrf-token`. Comparisons use `timingSafeEqual`.
- Login, registration, and password-reset endpoints are rate limited.
- `app.set('trust proxy', TRUST_PROXY)` is deliberate: behind the tunnel + Nginx, exactly one hop
  is trusted so cookies and client IPs are correct without blindly trusting arbitrary headers.

## Authorization

Every protected route calls `requireAuth` and then a permission check. Permissions are resolved per
request:

1. Super Admin resolves to the full catalog.
2. Otherwise the union of `role_permissions` for the role.
3. `user_permission_overrides` then applies; **DENY wins**.

Warehouse scope (`getScopedWarehouseIds`):

- Super Admin → all warehouses.
- Admin with no assignments → all warehouses; Admin with assignments → those warehouses.
- Staff → only assigned warehouses; no assignments means no inventory access.

Ownership checks are separate from permission checks: a Customer can only read their own orders,
returns, and profile; Staff can only act within scoped warehouses.

## Inventory integrity

```
InventoryBalance (product × warehouse)
  onHand, reserved, avgCost
        ▲
        │ every change writes one row
StockMovement (append-only)  quantity (signed), unitCost, balanceAfter, reference
```

- `lockBalance` inserts a zero row if missing (`ON CONFLICT DO NOTHING`) and then `SELECT ... FOR
  UPDATE` it. All multi-row operations lock in product-ID order to avoid deadlocks.
- `applyMovement` refuses to make On-hand negative (unless `allowNegativeStock`) or to consume
  Reserved stock.
- Receipts revalue the moving-average cost. Issues consume at the current average without
  changing it. Transfers use the source average at the destination.
- There is no endpoint that updates or deletes a movement. Corrections are new movements.

## Customer Order lifecycle

```
PENDING ──confirm (transaction + row locks)──► CONFIRMED ──► PROCESSING
   │                                              │              │
   └────────────── cancel (release) ◄─────────────┘              ▼
                                                       READY_FOR_DISPATCH
                                                                  │
                                                    SHIPPED ◄─────┘  (consume reservations, ISSUE stock)
                                                       │
                                                    DELIVERED ──► RETURNED (return workflow)
```

- Placing an order snapshots product name, SKU, price, tax rate, totals, and currency. No stock is
  held while PENDING.
- Confirmation locks the order row and balance rows, re-checks Available, increments Reserved, and
  writes `StockReservation` rows. A second confirmation fails without double-reserving.
- The fulfillment warehouse is chosen deterministically as the accessible warehouse with the
  greatest minimum availability across all lines.
- Cancellation before dispatch releases reservations; dispatch consumes them and writes ISSUE
  movements.
- Invalid transitions return HTTP 409.

## Procurement

Purchase Orders move `DRAFT → SUBMITTED → APPROVED/REJECTED → PARTIALLY_RECEIVED → RECEIVED`.
Totals above `SystemSetting.purchaseApprovalLimit` require
`purchase_orders.approve_unlimited` (Super Admin by default). Goods receipts lock the PO, reject
over-receipt, update received quantities, and apply RECEIPT movements in the same transaction.

## Frontend

- Vite SPA with route-level role/permission guards for UX; the backend remains authoritative.
- TanStack Query owns server state; cart state is local (localStorage) and priced again on the
  server at order creation.
- The API client fetches a CSRF token before mutations and retries once on `CSRF_FAILED`.
- Role-aware sidebar; pages exist for every module; loading, empty, error, and validation states
  are rendered.

## Operational concerns

- `api` has a health endpoint that verifies the database and a Compose healthcheck.
- The API entrypoint waits for PostgreSQL, runs `prisma migrate deploy`, optionally seeds, then
  starts.
- Structured-ish logs go to stdout; production errors do not leak stack traces or secrets.
- Uploads are stored on the `uploads-data` volume and served read-only by Nginx through the API
  path; filenames are random UUIDs and MIME types are allowlisted.
