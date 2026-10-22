# Inventory Management System

A production-oriented, multi-warehouse inventory and order-management system with four roles
(Customer, Staff, Admin, Super Admin), server-side sessions, deny-by-default authorization, an
immutable stock ledger, moving weighted-average valuation, and Cloudflare Tunnel deployment.

## What is implemented

- **Authentication**: PostgreSQL-backed sessions, Argon2id password hashing, CSRF protection,
  rate limiting, session revocation, single-use password-reset tokens, configurable SMTP.
- **Authorization**: four fixed roles, code-defined permission catalog, database-backed role
  permissions, per-user allow/deny overrides, warehouse scoping, protected Super Admin invariants.
- **Catalog**: products (SKU/barcode, prices, categories, images, archive), categories, search.
- **Inventory**: per-warehouse on-hand/reserved/available balances, immutable stock movements,
  opening stock, goods receipts, transfers at source cost, adjustment requests and approvals.
- **Procurement**: suppliers, purchase orders with submission/approval limits, partial and full
  goods receipts.
- **Sales**: customer catalog and cart, order requests, confirmation-time stock reservation with
  row locking and oversell prevention, validated order state machine, cancellation release,
  dispatch consumption, payment recording, returns with restocking.
- **Reporting**: dashboard summary, low stock, inventory valuation, sales, top products,
  purchasing, stock movements, CSV exports. Revenue is never labelled as profit.
- **Audit + notifications**: append-only audit entries for sensitive actions and in-app
  notifications.
- **UI**: responsive React dashboard with role-specific navigation and pages for every module.
- **Tests**: 29 Vitest/Supertest tests, including RBAC boundaries, warehouse scope, concurrent
  reservations/oversell, valuation, and ledger immutability.

Deferred for v1 (tracked in [docs/feature-checklist.md](docs/feature-checklist.md)): MFA,
hardware barcode scanners, bulk CSV import, multi-currency conversion, a full tax engine,
storage-bin-level balances, and a payment gateway.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, RHF + Zod, Recharts, Lucide |
| Backend | Node.js 22, TypeScript, Express 4, Prisma 6, Zod, express-session + connect-pg-simple, Argon2id |
| Database | PostgreSQL 16 |
| Infra | Docker Compose, Nginx (SPA + API proxy), optional Cloudflare Tunnel |

## Quick start (Docker Compose)

```bash
cp .env.example .env
# Edit .env: at minimum change POSTGRES_PASSWORD and SESSION_SECRET.
# Generate a secret with: openssl rand -hex 48

docker compose up -d --build
docker compose ps
docker compose logs -f api
```

The API container applies `prisma migrate deploy` on startup. Seed demo data once (optional):

```bash
docker compose exec api npm run db:seed --workspace apps/api
```

### Create the initial Super Admin

Run this once, after the API is healthy. It prompts for the password without echoing it:

```bash
docker compose exec -it api node apps/api/dist/scripts/create-super-admin.js \
  --email you@example.com --name "Super Admin"
```

The command refuses to run if any Super Admin already exists, so it cannot be replayed to
create extra privileged accounts. Further Super Admins must be created from **Users** while
signed in as a Super Admin. Passwords are never accepted as command-line arguments.

Then open:

- Web app — <http://localhost:8080>
- API health — <http://localhost:8080/api/health>
- API docs (Swagger UI) — <http://localhost:8080/api/docs>

Sign in at <http://localhost:8080/login> with the email and password you entered.

Or use the helper script, which builds, starts, waits for health, applies migrations, prints the
URLs, and stops the services when you press Ctrl+C:

```bash
./run.sh          # Linux / macOS / WSL
./run.ps1         # Windows PowerShell
```

### Demo accounts (created by the seed only)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `Admin123!Pass` |
| Staff | `staff@example.com` | `Staff123!Pass` |
| Customer | `customer@example.com` | `Customer123!Pass` |

The Super Admin is not seeded with a default password. Never enable demo data in production.

## Local development without rebuilding containers

```bash
# 1. Start PostgreSQL with a loopback-only port for host tools/tests
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres

# 2. Install dependencies
npm install

# 3. Apply migrations and seed (DATABASE_URL in .env points at localhost)
npm run db:deploy
npm run db:seed

# 4. Create the initial Super Admin (prompts for the password)
npm run create-super-admin -- --email you@example.com --name "Super Admin"

# 5. Run API (http://localhost:4000) and web (http://localhost:5173) together
npm run dev
```

For host development keep `UPLOAD_DIR=./uploads` in `.env`; inside Docker it is `/data/uploads`.

## Tests

The integration suite needs a PostgreSQL instance reachable at `TEST_DATABASE_URL`
(default `postgresql://ims:change-me-in-production@localhost:5432/ims_test`). The Compose
PostgreSQL service creates the `ims_test` database on first initialisation.

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres
npm test
```

Verified result on the build environment: **5 files, 29 tests passed**.

Tests run with `NODE_ENV=test` against `ims_test`, apply migrations, and truncate business tables
between tests. Never point `TEST_DATABASE_URL` at production.

Opt-in browser smoke tests (Playwright) with the demo data seeded:

```bash
docker compose --profile e2e run --rm e2e
```

## Project structure

```text
.
├── apps/
│   ├── api/
│   │   ├── prisma/          schema, migrations, seed
│   │   ├── src/
│   │   │   ├── config/      env, session store
│   │   │   ├── lib/         prisma, permissions, audit, errors, mailer
│   │   │   ├── middleware/  auth/RBAC, CSRF, validation
│   │   │   ├── modules/     route modules per domain
│   │   │   ├── services/    inventory valuation, order state machine
│   │   │   └── test/        Vitest + Supertest suite
│   │   └── Dockerfile
│   └── web/
│       ├── src/components/  UI primitives + app shell
│       ├── src/pages/       role-aware pages
│       ├── e2e/             Playwright smoke tests
│       ├── nginx.conf
│       └── Dockerfile
├── docs/                    architecture, DB design, API, auth matrix, deployment, backup
├── infrastructure/cloudflare/config.example.yml
├── scripts/docker-entrypoint.sh
├── compose.yaml
├── compose.dev.yaml
├── run.sh / run.ps1
└── .env.example
```

## Documentation

- [Architecture](docs/architecture.md)
- [Database design and ER diagram](docs/database-design.md)
- [API documentation](docs/api-documentation.md) (runtime Swagger at `/api/docs`)
- [Authorization matrix](docs/authorization-matrix.md)
- [Cloudflare deployment](docs/deployment.md)
- [Backup and restore](docs/backup-and-restore.md)
- [Feature checklist](docs/feature-checklist.md)
- Domain glossary: [CONTEXT.md](CONTEXT.md); decisions: [docs/adr/](docs/adr/)

## Security notes

- Never use the example secrets in production. Set `COOKIE_SECURE=true` and `NODE_ENV=production`
  behind HTTPS.
- PostgreSQL is not published in `compose.yaml`; only the loopback-bound web port is exposed.
- All authorization is enforced on the backend. Hidden UI controls are cosmetic.
- The stock ledger has no update or delete endpoint; corrections are new movements.
- Password reset links are logged only in development when SMTP is unconfigured.

## Known limitations

- Single-currency; tax is a simple per-line rate, not a tax engine.
- A Customer Order is allocated to a single fulfillment warehouse at confirmation.
- Storage Locations exist in the schema but do not hold balances in v1.
- The Cloudflare Tunnel configuration is delivered but not activated with a real domain/token.
