# Deploy through Cloudflare Tunnel, never by publishing PostgreSQL

Production runs Docker Compose on a self-hosted host. `web` serves the built SPA and proxies `/api` to `api` on the private Docker network. Only the optional `cloudflared` service makes outbound connections to Cloudflare; origin ports are not published publicly. PostgreSQL has no published port in the production profile and is only reachable on the internal network.

**Why:** Cloudflare Tunnel gives HTTPS and a public hostname without inbound firewall rules. Cloudflare Pages/Workers cannot host a long-lived PostgreSQL container or this Express server.

**Trust:** the API trusts exactly one proxy hop when `TRUST_PROXY=1` so cookies and client IPs are correct; forwarding headers are never blindly trusted at other hop counts. `COOKIE_SECURE=true` in production.

**Config:** `compose.yaml`, `infrastructure/cloudflare/config.example.yml`, `docs/deployment.md`.
