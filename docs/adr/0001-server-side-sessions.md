# Server-side sessions in PostgreSQL

Authentication uses `express-session` with `connect-pg-simple`, not JWTs. Sessions live in the `session` table, are revoked server-side on logout and password change, and are sent only in an HttpOnly cookie. The frontend never stores credentials or tokens in localStorage. Argon2id hashes passwords.

**Why:** immediate revocation, logout-everywhere, and no JWT invalidation workaround behind Cloudflare. The cost is one extra database lookup per authenticated request.

**Implementation:** `apps/api/src/config/session.ts`, `apps/api/src/modules/auth/routes.ts`, cookie name `ims.sid`, 8-hour rolling expiry, `SameSite=Lax`, `Secure` in production, session regeneration on login and privilege change.
