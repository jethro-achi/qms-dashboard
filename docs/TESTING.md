# Testing guide

The project uses [Vitest](https://vitest.dev/) for fast unit tests of the
server-side security and data logic. Tests run in a **Node** environment and need
**no database** — they exercise pure functions (RBAC, branch scoping, input
validation, hashing, formatting), so they're deterministic and quick.

- [Running the tests](#running-the-tests)
- [What's covered](#whats-covered)
- [How it's configured](#how-its-configured)
- [Writing a new test](#writing-a-new-test)
- [Running in CI](#running-in-ci)
- [Running inside Docker](#running-inside-docker)

---

## Running the tests

```bash
npm install        # once
npm test           # run the whole suite once (CI mode)
```

Other ways to run:

```bash
npm run test:watch                         # re-run on file changes (dev)
npx vitest run tests/rbac.test.ts          # a single file
npx vitest run -t "fail-closed"            # only tests whose name matches
npx vitest run --coverage                  # with coverage (if configured)
```

A green run looks like:

```
 ✓ tests/rbac.test.ts
 ✓ tests/build-where.test.ts
 ✓ tests/logo-scale.test.ts
 ...
 Test Files  10 passed (10)
      Tests  57 passed (57)
```

---

## What's covered

| Test file | Focus |
| --- | --- |
| `tests/rbac.test.ts` | Roles and permission checks (who can manage users, change settings, see PII). |
| `tests/build-where.test.ts` | Row-level security predicate builder — **fail-closed** scoping, narrowing-only client filters. |
| `tests/filters.test.ts` | Zod validation of client filter inputs (dates, branches, status). |
| `tests/period.test.ts` | Reporting period maths (ranges, boundaries). |
| `tests/schedule-time.test.ts` | Next-run calculation for scheduled reports. |
| `tests/audit-canonical.test.ts` | Canonical serialization feeding the audit hash chain (tamper-evidence). |
| `tests/csv.test.ts` | CSV encoding / escaping for audit export. |
| `tests/trend.test.ts` | KPI trend/delta direction and "good vs bad" logic. |
| `tests/message-attachments.test.ts` | Attachment MIME allow-list, size limits, key/traversal safety. |
| `tests/logo-scale.test.ts` | Logo-size clamping (range + non-finite fallback). |

These deliberately target the **security-critical and correctness-critical**
logic: authorization, injection-safe query building, validation, and audit
integrity.

---

## How it's configured

[`vitest.config.ts`](../vitest.config.ts):

- `environment: "node"` — the code under test is server-side.
- `include: ["tests/**/*.test.ts"]` — all tests live in `tests/`.
- The `@/` import alias mirrors `tsconfig.json`, so tests import modules exactly
  the way the app does (e.g. `import { canManageUsers } from "@/lib/rbac"`).

No global setup and no DB fixtures — keep tests pure. If a unit needs a database,
prefer extracting the pure logic and testing that, rather than standing up a DB.

---

## Writing a new test

1. Create `tests/<thing>.test.ts`.
2. Import from `vitest` and the module under test via the `@/` alias.
3. Keep it pure — no network, no filesystem, no DB.

```ts
import { describe, it, expect } from "vitest";
import { buildWhere } from "@/lib/rbac"; // example

describe("buildWhere", () => {
  it("fails closed when a branch-scoped user has no branches", () => {
    const { sql } = buildWhere({ role: "BRANCH_OPS", allowedBranchIds: [] });
    expect(sql).toContain("1=0"); // returns nothing, never everything
  });
});
```

Guidelines:

- **Name the invariant, not the implementation** (e.g. "fails closed", "can only
  narrow scope").
- Cover the **boundary and the adversarial** case, not just the happy path.
- Don't hard-code the app's brand colours or other config the app owns — assert
  behaviour, not incidental values.

---

## Running in CI

`npm test` exits non-zero on failure, so it drops straight into any CI runner:

```yaml
# Example GitHub Actions step
- uses: actions/setup-node@v4
  with: { node-version: 20 }
- run: npm ci || npm install
- run: npm test
- run: npx tsc --noEmit      # type-check
- run: npm run build         # ensure it compiles
```

Recommended gates before merge: **tests pass**, **`tsc --noEmit` clean**, and a
successful **`next build`**.

---

## Running inside Docker

Run the suite in the builder image (which has the dev dependencies) without
touching your host toolchain:

```bash
docker build --target builder -t qms-dashboard:test .
docker run --rm qms-dashboard:test npm test
```

This is handy for reproducing a CI failure locally on the exact Node version the
image uses.
