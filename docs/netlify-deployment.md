# Deploying the frontend on Netlify

## Why there is no Docker Compose file for Netlify

Netlify is a static-site/serverless host. A deployment is an artifact (HTML/JS
assets and optional functions) built from a Git repository. It does not run a
Docker daemon, does not accept `docker compose` stacks, and does not provide
PostgreSQL. This application's API is a long-lived Express process backed by
PostgreSQL, server-side sessions, and disk uploads, so it cannot be deployed to
Netlify as-is.

Netlify *can* host the React/Vite frontend (`apps/web/dist`) and proxy `/api/*`
and `/uploads/*` to the API running on a Docker host. The browser then sees one
origin, so the existing `ims.sid` cookie (`SameSite=Lax`), CSRF token flow, and
relative `fetch('/api...')` calls work unchanged.

```text
Browser ──https──> app.netlify.app  ──/api/*, /uploads/* proxy──> api.example.com
                   (static frontend)                              (Docker: api + postgres)
```

The repository contains [`netlify.toml`](../netlify.toml) for exactly this setup.
The existing [`compose.yaml`](../compose.yaml) remains the way to run the API
and database on the Docker host.

## 1. Deploy the API on a Docker host

### Fast path: Render Blueprint

The repository includes [`render.yaml`](../render.yaml), which provisions the
API container, a managed PostgreSQL database, a 1 GB uploads disk, and the
required environment variables.

1. Push this repository to GitHub (already done).
2. Render Dashboard → **New** → **Blueprint** → select this repository.
3. When prompted for `APP_URL`, enter your Netlify site URL
   (`https://your-site.netlify.app`).
4. Apply, wait for the deploy, then copy the service URL
   (`https://inventory-api-xxxx.onrender.com`).
5. Change both `api.example.com` targets in `netlify.toml` to that hostname,
   commit, and push. Netlify redeploys automatically.

Blueprint notes:

- `plan: free` on the database expires after 30 days and is deleted. Upgrade to
  `basic-256mb` before storing real data.
- `plan: starter` on the web service is required for the uploads disk and for
  the service to stay awake. A free web service sleeps and cannot keep uploaded
  files.
- Change `region` in `render.yaml` if `oregon` is not closest to your users;
  the database and web service must stay in the same region.
- Do not set `SEED_ON_START=true` in production.

### Any other Docker host

Use `apps/api/Dockerfile` with the repository root as the build context. The
container applies `prisma migrate deploy` on startup via
[`scripts/docker-entrypoint.sh`](../scripts/docker-entrypoint.sh).

Pick any host that runs Docker containers:

| Host | Notes |
|---|---|
| Railway | Dockerfile path `apps/api/Dockerfile`, add its PostgreSQL plugin, attach a volume at `/data/uploads`. |
| Render | Web Service → Docker; Dockerfile path `apps/api/Dockerfile`; add Render PostgreSQL; mount a disk at `/data/uploads`. Health check path: `/api/health`. |
| Fly.io | `fly launch` with the API Dockerfile; use Fly Postgres and a volume for `/data/uploads`. |
| VPS | Run `docker compose up -d postgres api` from this repo, then expose port 4000 through a reverse proxy or the Cloudflare Tunnel profile already defined in `compose.yaml`. |

Set these environment variables on the API host:

```dotenv
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB?schema=public
SESSION_SECRET=<openssl rand -hex 48>
COOKIE_SECURE=true
TRUST_PROXY=1
APP_URL=https://YOUR-SITE.netlify.app
UPLOAD_DIR=/data/uploads
MAX_UPLOAD_MB=5
# Optional: password-reset email
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=no-reply@example.com
```

Notes:

- `APP_URL` must be the Netlify URL because it is used to build password-reset
  links.
- `CORS_ORIGIN` is not needed for the proxied setup: requests are same-origin to
  the browser. Set it only if clients call the API host directly.
- Mount persistent storage at `UPLOAD_DIR`; otherwise product images are lost on
  redeploy.
- Give the API a public HTTPS hostname (for example `api.example.com`).

Create the first Super Admin once the API is healthy:

```bash
# From the host's shell/console (Railway shell, Render shell, or docker compose exec):
SUPER_ADMIN_PASSWORD='<strong password>' \
  node apps/api/dist/scripts/create-super-admin.js \
  --email you@example.com --name "Super Admin"
```

If your host cannot run one-off commands with environment variables, use
`docker compose exec -it api node apps/api/dist/scripts/create-super-admin.js
--email you@example.com --name "Super Admin"` and enter the password at the
prompt. Remove `SUPER_ADMIN_PASSWORD` from the service environment afterwards if
you used it.

## 2. Point Netlify at the API

Edit the two proxy targets in [`netlify.toml`](../netlify.toml), replacing
`api.example.com` with the API's public hostname. Netlify does not expand
environment variables inside redirect rules, so these must be literal URLs.

## 3. Deploy on Netlify

1. Push this repository to GitHub/GitLab/Bitbucket.
2. Netlify → **Add new site** → **Import an existing project** → pick the repo.
3. Keep the detected settings; `netlify.toml` supplies them:
   - base: repository root
   - build command: `npm run build -w apps/web`
   - publish directory: `apps/web/dist`
4. Deploy. No frontend environment variables are required — the app uses
   relative `/api` paths.

## 4. Verify

```bash
curl -i https://YOUR-SITE.netlify.app/api/health     # {"status":"ok","database":"up",...}
```

Then open the site, sign in with the Super Admin account, and confirm that a
product image upload renders from `/uploads/...`.

## Limitations of the Netlify proxy

- Proxied requests pass through Netlify's edge and are subject to its request
  timeout and body-size behavior. Reports/CSV exports are small, but very large
  uploads (near `MAX_UPLOAD_MB`) may fail depending on plan limits. The API also
  rejects bodies over 1 MB for JSON requests by design.
- Netlify is not in the request path for database traffic, so database backups
  and the Postgres lifecycle are entirely the API host's responsibility.
- Netlify's proxy forwards the request and response; it does not add CORS
  headers. That is fine for the same-origin setup above.
- Do not convert the API to Netlify Functions without redesigning sessions,
  Prisma connection pooling, and uploads; short-lived functions are a poor fit
  for this API.

## Alternative: no Netlify — run everything with Docker Compose

If your goal is simply a public URL, the existing stack can serve the frontend
and API together on a VPS:

```bash
cp .env.example .env    # set POSTGRES_PASSWORD, SESSION_SECRET, APP_URL, COOKIE_SECURE=true
docker compose up -d --build
```

Publish port 8080 through a reverse proxy, or use the bundled Cloudflare Tunnel
profile (`docker compose --profile tunnel up -d`) so no inbound ports are
opened. See the "Quick start (Docker Compose)" section in the
[README](../README.md) and [ADR 0006](adr/0006-cloudflare-tunnel.md).
