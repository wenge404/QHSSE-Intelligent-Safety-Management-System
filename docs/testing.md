# Verification

Two suites, checking two different layers.

```bash
cd backend && npm test        # 42 checks over HTTP — needs all three services running
cd backend && npm run test:db # 19 checks straight against PostgreSQL — needs only the database
```

Neither is a unit-test suite, deliberately. The claims being verified — RBAC scoping, state-machine
enforcement, insert-only audit log — are properties of the running system, not of any single
function. A unit test of `incidentScope()` would pass even if the route forgot to call it.

| Suite | Source | Goes through | Proves |
| --- | --- | --- | --- |
| `npm test` | [`src/__tests__/run.ts`](../backend/src/__tests__/run.ts) | Express, over HTTP | The API applies the rules |
| `npm run test:db` | [`src/__tests__/triggers.ts`](../backend/src/__tests__/triggers.ts) | Prisma / raw SQL, no Express | The rules hold *without* the API |

---

## What the 42 HTTP checks prove

### Authentication (4)

- A wrong password is rejected with 401.
- An unauthenticated request to a protected route is rejected with 401.
- All four demo roles can sign in.

### RBAC visibility scoping — proposal §9.3 (6)

- Visibility is **strictly nested**: admin > department lead ≥ auditor > field reporter, asserted
  on actual row counts rather than assumed.
- Every incident a Field Reporter can see is one they reported.
- Every incident a QHSSE Auditor can see is in their zone or their own.
- **An out-of-scope record returns 404, not 403** — the API must not confirm that a record it
  will not show you exists.

### Workflow state machine — proposal §9.2 (7)

- A Field Reporter can create an incident; it starts in `DRAFT`.
- The reference number matches `INC-YYYY-NNNN`, assigned from the row id.
- An illegal jump `DRAFT → CLOSED` is rejected with **409**.
- The legal `DRAFT → SUBMITTED` is accepted.
- A Field Reporter attempting `SUBMITTED → UNDER_INVESTIGATION` is rejected with **403** — the
  transition is legal, the role is not entitled to it. *These two failures are different and the
  suite checks they stay different.*
- A Department Lead can make the same transition.

### Corrective actions and the closure guard (7)

- A Department Lead can raise a corrective action.
- Raising one against an incident under investigation advances it to
  `CORRECTIVE_ACTION_PENDING` automatically.
- The incident **cannot** be verified while that action is unverified — 409.
- A payload with both `incidentId` and `auditResponseId` is rejected with 400 (the polymorphic
  parent guard).
- A Field Reporter cannot verify an action assigned to themselves — 403.
- A Department Lead can verify it.
- The incident can then be verified.

### Immutable audit log — proposal §9.4 (7)

- Every state change was recorded, with `previousState` and `newState` populated.
- A Field Reporter cannot read the audit log — 403.
- A System Admin can.
- `PATCH`, `PUT` and `DELETE` against an audit-log entry all return **404** — there is no such
  route to call.

### Predictive service — proposal §8.2 (4)

- A newly created incident carries a persisted risk score and band.
- The serving model is recorded against the record, and it is the set-B model.
- An ignited, exploded rupture on a large steel main scores **above** a minor plastic service
  leak. This is a directional sanity check, not an accuracy claim — it catches a model wired up
  backwards or a feature mapping that silently sends everything to `MISSING`.

### KPI computation — proposal §11 (5)

- CACR is within 0–100; MTTC is positive; NMFR is computed from logged person-hours.
- **CACR agrees with its own published numerator and denominator** — the dashboard's "show your
  working" panel cannot drift from the figure it explains.
- KPIs are scoped to the caller: a Department Lead's totals are strictly below an admin's.

### Platform administration (2)

- Only a System Admin can create users — 403 otherwise.
- Malformed payloads are rejected with 400.

---

## What the 19 database checks prove

Every write in [`triggers.ts`](../backend/src/__tests__/triggers.ts) goes straight to PostgreSQL,
deliberately bypassing Express, its Zod schemas and `stateMachine.ts`. That is the point: these
checks prove the rules hold for writers that are *not* this API — a migration script, a `psql`
session, a future service. Each runs inside a transaction that is always rolled back, so the suite
leaves no trace, including in `audit_log`, which cannot be cleaned up afterwards by design.

### Incident transition trigger (5)

- `DRAFT → CLOSED` is refused at the database.
- `DRAFT → SUBMITTED` is allowed.
- `CLOSED` is terminal — nothing transitions out of it.
- `SUBMITTED → VERIFIED` (skipping investigation) is refused.
- An update that does not touch `status` passes through untouched.

### Corrective action transition trigger (4)

- `OPEN → VERIFIED` skips the work and is refused.
- `OPEN → IN_PROGRESS` and `OVERDUE → COMPLETED` are allowed.
- `VERIFIED` is terminal.

### Audit transition trigger (2)

- A `COMPLETED` audit cannot be reopened.
- `PLANNED → IN_PROGRESS` is allowed.

### Audit-log append-only trigger — §9.4 (4)

- `INSERT` is allowed.
- `UPDATE` of a row is refused.
- `DELETE` of a row is refused.
- A blanket `DELETE FROM audit_log` is refused.

This is the check that turns §9.4 from "the API has no route for it" into "the database will not
do it". Note the limit stated in [architecture.md §6](architecture.md#6-databaselevel-guards-92-13):
`TRUNCATE` bypasses row triggers and a table owner can drop them, so the production answer is a
privilege grant on top.

### CHECK constraints (4)

- A corrective action with two parents is unrepresentable.
- One with no parent is unrepresentable.
- `source` must agree with whichever parent is set.
- A negative fatality count is refused.

---

## A bug the HTTP suite caught

The first run failed 8 of 42 checks, all cascading from one root cause: an incident created
**without a zone** was invisible to its own Department Lead, because visibility keyed on
`zone.department` alone and a null relation matches nothing.

That is exactly backwards for the domain — a report filed from the field before the asset has been
identified is the one a lead most needs to see. The fix extends the scope to reach through the
reporter as well as the zone. Nothing in the unit-testable surface would have surfaced this; it
only appears when a real record moves through a real workflow under a real role.

---

## Not covered

- Frontend component behaviour (no React test suite; the production build typechecks all 12 routes).
- Model accuracy — that is [`docs/ml-evaluation.md`](ml-evaluation.md), via cross-validation.
- Concurrency and load.
- Token expiry behaviour over time.
- Whether the trigger and `stateMachine.ts` *agree*. Both suites pass today, but they assert the
  two layers separately; a change to one map without the other would be caught only if the altered
  transition happens to be exercised. A generated test — reading the TypeScript map and asserting
  each arm against the database — would close that, and is the obvious next step.
