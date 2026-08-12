# Architecture

Cross-references are to the project proposal, *Intelligent QHSSE Safety Management System*.

---

## 1. Layers (§9.1)

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Presentation | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Recharts | Incident and audit entry, dashboards, admin |
| API / Application | Express.js, Prisma ORM, JWT | Business logic, authentication, RBAC middleware, REST endpoints |
| Data | PostgreSQL 16 | Incidents, audits, users, immutable audit log |
| Predictive service | Python 3, scikit-learn, FastAPI | Model training and inference, called at `/api/v1/predict` |

The browser talks to exactly **one** origin. The FastAPI service is never called directly from
the frontend — the model-comparison report is proxied through Express — so the Python service
needs no CORS configuration and is not exposed to the public network.

---

## 2. Workflow state machine (§9.2)

```
DRAFT ──▶ SUBMITTED ──▶ UNDER_INVESTIGATION ──▶ CORRECTIVE_ACTION_PENDING ──▶ VERIFIED ──▶ CLOSED
   ▲          │                  │
   └──────────┘                  └──▶ CLOSED   (investigation found nothing to correct)
```

Declared in [`backend/src/domain/stateMachine.ts`](../backend/src/domain/stateMachine.ts) as
data, not as scattered `if` statements. Two things are checked before any write:

1. **Is the transition legal?** An illegal jump (e.g. `DRAFT → CLOSED`) returns **409 Conflict**
   with the list of states actually reachable from the current one.
2. **Is this role entitled to make it?** The gate is keyed on the *departing* state — who may move
   a record out of where it currently sits. A Field Reporter attempting
   `SUBMITTED → UNDER_INVESTIGATION` returns **403 Forbidden**.

Two further business rules are enforced at the same point:

- Only the reporter (or a System Admin) may submit their own draft.
- An incident cannot reach `VERIFIED` or `CLOSED` while any corrective action raised against it is
  unverified — otherwise the closure-rate KPI would be measuring nothing.

Raising a corrective action against an incident in `UNDER_INVESTIGATION` advances it to
`CORRECTIVE_ACTION_PENDING` automatically, and the automatic transition is written to the audit
log with its trigger recorded.

The same rules are **also enforced in the database** — see [§6, Database-level guards](#6-databaselevel-guards-913).
The proposal lists trigger enforcement as a stretch goal (§13); it is delivered.

### Corrective actions

```
OPEN ──▶ IN_PROGRESS ──▶ COMPLETED ──▶ VERIFIED
  │            │              ▲
  └──▶ OVERDUE ┴──────────────┘
```

`VERIFIED` is terminal. `COMPLETED` means the assignee says it is done; `VERIFIED` means somebody
independent confirmed it — which is why the KPI counts only the latter as closure.

### Audits

```
PLANNED ──▶ IN_PROGRESS ──▶ COMPLETED
   └──────────────┴───────▶ CANCELLED
```

Recording the first checklist answer moves a `PLANNED` audit to `IN_PROGRESS` automatically. An
audit cannot be marked `COMPLETED` while any checklist item is unanswered — these records back an
ISO 9001 §9.2 claim, and a half-finished checklist is not evidence of anything.

---

## 3. Role-based access control (§9.3)

| Role | Create incident / audit | Dashboard visibility | Approve & verify actions |
| --- | --- | --- | --- |
| `FIELD_REPORTER` | Yes | Own submissions only | No |
| `QHSSE_AUDITOR` | Yes | Zone-level | Audit-sourced actions only |
| `DEPARTMENT_LEAD` | Yes | Department-level (all zones) | All actions in department |
| `SYSTEM_ADMIN` | Yes | Organisation-wide | All, plus user & template management |

Implemented in [`backend/src/domain/rbac.ts`](../backend/src/domain/rbac.ts) as Prisma `where`
fragments rather than by filtering in memory. The restriction is part of the SQL, so a user can
never over-fetch and have rows stripped afterwards.

**Scope reaches through the reporter as well as the zone.** Zone is optional on an incident — a
report filed from the field before the asset has been identified has no zone yet. Keying
visibility on zone alone made those records invisible to everyone but their author and the admin,
which is precisely backwards: an unlocated gas release is the one a lead most needs to see. A
Department Lead therefore also sees incidents reported by anyone in their department, and an
auditor sees those reported by anyone whose home zone is theirs.

Two further guards on verification:

- A QHSSE Auditor may verify only `AUDIT_RESPONSE`-sourced actions, never incident-sourced ones.
- Nobody except a System Admin may verify an action assigned to themselves — verification is a
  second pair of eyes, and self-signoff defeats it.

**Out-of-scope records return 404, not 403.** A 403 would confirm that a record exists.

The role and scope keys are re-read from the database on every request rather than trusted from
the token body, so a token issued before a demotion does not keep its old privileges until expiry.

---

## 4. Audit trail (§9.4)

An insert-only `audit_log` table records every state mutation:
`id, user_id, action, entity_type, entity_id, previous_state, new_state, detail, ip_address, timestamp`.

Immutability is enforced by construction:

- [`services/auditLog.service.ts`](../backend/src/services/auditLog.service.ts) exposes **only** an append
  function. There is no update or delete helper in the module.
- The admin router exposes **only** `GET /api/v1/admin/audit-log`. No `PATCH`, `PUT` or `DELETE`
  route exists anywhere in the API — the verification suite asserts all three return 404.
- Writes happen inside the same transaction as the mutation they describe, so a state change
  cannot be committed without its trail entry.

Update actions record a **shallow diff** rather than a full row snapshot, so the trail says what
actually changed.

…and, since the trigger migration, **also below the application**: a `BEFORE UPDATE OR DELETE`
trigger on `audit_log` refuses both operations outright, so a direct `psql` session cannot
rewrite history either. See §6.

---

## 5. Data model

Twelve tables. Points worth noting:

**Polymorphic corrective actions.** A `CorrectiveAction` originates from either an `Incident` or
an `AuditResponse`. Prisma has no native polymorphic relation, so this uses the standard
workaround — a `source` enum plus two optional foreign keys. "Exactly one FK set, and it must
agree with `source`" is enforced by a Zod refinement in the API layer *and* by a database CHECK
constraint (§6), which makes a violating row unrepresentable rather than merely rejected by one
validator.

**Template/instance split for checklists.** `ChecklistTemplate` + `ChecklistItem` are the reusable
definition; `Audit` is one dated run of a template at a zone; `AuditResponse` is the recorded
answer to each item. This is what makes the checklist digital rather than a static form.

**Enums are 1:1 with the PHMSA vocabulary.** `LocationType`, `SystemPart`, `ReleaseType`,
`IncidentAreaType` and `PipeMaterial` hold exactly the distinct values present in
`gd2010toPresent.xlsx`, verified against the file rather than assumed from the column name. A
lossy platform→PHMSA lookup would silently push unmapped options into a category the encoder never
saw, which `handle_unknown="ignore"` then drops — a prediction that degrades quietly is worse than
one that fails loudly.

**Reference numbers derive from the primary key.** `INC-2026-0042` is generated from the row's own
id inside the creating transaction, not from `COUNT(*) + 1`, which races under concurrent inserts
and silently produces duplicates.

**KPIs are never stored.** No table holds CACR, MTTC or NMFR. They are computed with aggregate
queries at request time, so the dashboard cannot show a stale number.

---

## 6. Database-level guards (§9.2, §13)

Migration
[`20260812160000_state_transition_guards`](../backend/prisma/migrations/20260812160000_state_transition_guards/migration.sql)
adds four triggers and three CHECK constraints.

### Why, when the API already validates

Because the API is not the only thing that can write to this database. A migration script, a
`psql` session, a future reporting job, or a second service added later all bypass the Express
validation entirely. An audit trail whose integrity rests on every future caller remembering to go
through one code path is not an integrity guarantee — it is a convention.

The application layer is **not** made redundant by the triggers. It is what produces a useful 409
listing the reachable states, and what applies the role gate, which the database has no way to
know about. The trigger is the backstop for every writer that is not this API.

### What is enforced

| Object | Guard |
| --- | --- |
| `incident_transition_guard` | `BEFORE UPDATE` on `incidents` — validates `OLD.status → NEW.status` |
| `corrective_action_transition_guard` | same, on `corrective_actions` |
| `audit_transition_guard` | same, on `audits` |
| `audit_log_append_only` | `BEFORE UPDATE OR DELETE` on `audit_log` — refuses both |
| `corrective_actions_exactly_one_parent` | CHECK — exactly one FK set, agreeing with `source` |
| `incidents_non_negative_consequences` | CHECK — fatality, injury and evacuation counts ≥ 0 |

Updates that do not change `status` (a re-score, a narrative edit) pass through untouched — the
trigger returns early on `NEW.status IS NOT DISTINCT FROM OLD.status`.

### Keeping the two in step

The `CASE` arms in the migration and the transition maps in
[`stateMachine.ts`](../backend/src/domain/stateMachine.ts) are one rule expressed twice and must be
changed together. Both files carry a pointer to the other. `npm run test:db` fails loudly if they
diverge, because it asserts the database's behaviour directly rather than the API's.

### Error translation

A trigger raises with a marker prefix (`IQSMS_TRANSITION:`, `IQSMS_IMMUTABLE:`) that
[`error.middleware.ts`](../backend/src/middleware/error.middleware.ts) recognises and turns into a
409 or 403 with the database's own message, rather than a generic 500. Matching on message text is
unattractive, but it is the only handle Prisma exposes for a plpgsql raise; the markers exist so
the match is on something deliberate rather than on incidental wording.

### The honest limit

`TRUNCATE` does not fire row-level `DELETE` triggers, and a table owner can drop a trigger
outright. In production the application role would additionally be denied those rights:

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM iqsms_app;
```

The trigger stops accidental and casual tampering through the normal connection; the grant is what
stops a determined one. The seed script relies on exactly this gap — it uses `TRUNCATE ... RESTART
IDENTITY CASCADE` to reset, which a production role could not do.

---

## 7. KPI definitions (§11)

Computed in [`backend/src/controllers/kpi.controller.ts`](../backend/src/controllers/kpi.controller.ts), scoped to the
caller's visibility.

**Corrective Action Closure Rate**

```
CACR (%) = (VERIFIED corrective actions ÷ all raised corrective actions) × 100
```

"Closed" is ambiguous in a five-state lifecycle, so it is pinned down: `VERIFIED` is the terminal
state. `COMPLETED` means the assignee says it is done but nobody independent has confirmed it,
which is not closure in an ISO sense.

**Mean Time to Close**

```
MTTC (days) = mean(verifiedAt − raisedAt) over VERIFIED actions
```

**Near-Miss Frequency Rate**

```
NMFR = (near-misses ÷ operational person-hours) × 200,000
```

200,000 is the standard OSHA normalisation constant (100 FTE × 2,000 h/yr). Person-hours are
recorded per period under *Administration → Operational hours*. With none logged the tile reports
"no person-hours logged" rather than a misleading zero — every KPI carries an explicit `note`
field for exactly this reason.

Each KPI is returned with its numerator, denominator and formula so the dashboard can show its
own working.

---

## 8. Known limitations

- **JWT in `localStorage`.** Acceptable for a demonstration platform; a production deployment
  would use an httpOnly cookie so a script injection cannot read the token.
- **No file upload backing the `Attachment` table.** The schema and relations exist; no storage
  backend is wired up.
- **Overdue sweep is request-triggered**, not scheduled. The dashboard and actions list call
  `POST /corrective-actions/refresh-overdue` on load. A production deployment would use a cron job.
- **Trigger enforcement stops at the table owner** (see §6) — `TRUNCATE` and `DROP TRIGGER` remain
  available to whoever owns the schema, and closing that needs a privilege grant, not more SQL.
- **The role gate is application-layer only.** The database enforces *which* transitions are legal;
  it has no notion of who is asking, so *who may make them* is still checked only in Express.
- **No hyperparameter search** on the models — reasonable defaults only (see
  [ml-evaluation.md](ml-evaluation.md)).
