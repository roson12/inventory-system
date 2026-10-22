# Fixed roles with a code-defined permission catalog

Authorization uses four fixed roles (Customer, Staff, Admin, Super Admin), a permission catalog defined in code, DB-backed `role_permissions`, and per-user ALLOW/DENY overrides. DENY wins over ALLOW. Unknown permissions fail closed.

**Why:** the business needs configurable sensitive capabilities (for example allowing one Admin to manage Staff) without a fully dynamic role builder that would make escalation easy to misconfigure. Keeping the catalog in code means a typo cannot silently grant a permission.

**Invariants enforced in middleware:**
- Public registration only creates Customers.
- No Admin may assign or modify Super Admin.
- The last active Super Admin cannot be deactivated or demoted.
- Only Super Admins may edit role permissions and system settings.
- Warehouse-scoped roles are filtered by `user_warehouse_assignments` on every inventory query.

**Implementation:** `apps/api/src/lib/permissions.ts`, `apps/api/src/middleware/auth.ts`.
