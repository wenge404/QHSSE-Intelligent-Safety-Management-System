# Defense demonstration script

A 12-minute live walkthrough. Every claim below is something the running system actually does —
nothing here is a mock-up.

## Before you start

```bash
docker compose up -d
```

Then three terminals:

```bash
cd ml-service && .venv/Scripts/python -m uvicorn app.main:app --port 8000
```

```bash
cd backend && npm run seed:full && npm run dev
```

```bash
cd frontend && npm run dev
```

Check <http://localhost:4000/api/v1/meta/health> reports `"mlService": { "ok": true }` **before**
you walk into the room. Have <http://localhost:3000> open on the login screen.

Re-seeding immediately before the defense gives you a clean, known dataset — the generator is
deterministic, so what you rehearsed is what you will demonstrate.

---

## 1 · The problem (1 min) — login screen

Three problems from the proposal, visible on one screen:

- Fragmented record-keeping across spreadsheets and email.
- Reactive rather than predictive safety management.
- Slow corrective-action follow-through.

Point at the three ISO clauses on the left panel. Each module maps to a specific clause — the
feature set is not arbitrary.

---

## 2 · Role-based access control (2 min) — the strongest opening

Sign in as **`reporter.field@gdc.cm`** → Incidents. Note the record count.

Sign out, sign in as **`auditor.sectiona@gdc.cm`** → more records, all in Pipeline Section A.

Sign out, sign in as **`admin@gdc.cm`** → everything.

> *Same database, same endpoint. The restriction is compiled into the SQL `WHERE` clause, not
> applied by hiding rows in the browser. And a record you cannot see returns 404, not 403 — a 403
> would confirm it exists.*

Go to **Administration → Users** and show the access-control matrix rendered live.

---

## 3 · Filing an incident, with live risk scoring (3 min) — the centrepiece

**Incidents → Report an incident.** Fill in the top section, then choose
**Primary hazard cause = Excavation damage**. The scoring panel activates.

Now demonstrate the model responding to the operator:

1. Set component `Main`, location `Public property`, pressure `200`, diameter `8`.
   Score sits around the base rate.
2. Set **Ignition occurred = Yes**, **Explosion occurred = Yes**, release type `Rupture`.
   → score climbs to ≈ **0.92, CRITICAL**.
3. Set both back to **No**, release type `Leak`, material `Plastic`, pressure `12`, diameter `1`.
   → score drops to ≈ **0.31, LOW**, below the threshold marker.

> *The red marker is the operating threshold, 0.482. That is not the 0.5 default — it is the most
> selective cut-off that still catches 90% of significant incidents. In a safety context a false
> negative costs more than a false positive, so the threshold is a stated policy choice.*

Scroll to **Consequences** and read the note aloud:

> *Fatalities, injuries and cost are captured for reporting — but they are never sent to the
> model. PHMSA's SIGNIFICANT label is computed from exactly those fields. A model given them would
> be reconstructing its own answer and would score about 99%. That number would be meaningless.*

Save as draft.

---

## 4 · The workflow state machine (2 min)

On the new record, the six-state progress bar shows `DRAFT` highlighted.

Click **Move to Submitted** — accepted.

Now try to jump ahead. As the reporter, the panel says your role cannot move a record out of
`SUBMITTED`. Sign in as **`lead.integrity@gdc.cm`**, open the same record, move it to
**Under investigation**.

Raise a corrective action (assign to anyone, any due date). Watch the incident advance to
**Corrective action pending** by itself.

Now try **Move to Verified** →

> *409. The incident cannot be verified while a corrective action against it is still open. If it
> could, the closure-rate KPI would be measuring nothing.*

Verify the action first (Corrective actions → Verified), then verify the incident. It works.

---

## 5 · The audit trail (1 min)

Scroll to **Audit trail** on the incident. Every transition you just made, with who and when.

Then **Administration → Audit log** for the organisation-wide view.

> *Insert-only. There is no update or delete route for this table anywhere in the API — and the
> verification suite asserts that PATCH, PUT and DELETE all return 404. That absence is the
> guarantee.*

Then answer the obvious follow-up before it is asked — this is the strongest 60 seconds in the
demo, so have a terminal ready:

```bash
docker exec -it iqsms-postgres psql -U iqsms -d iqsms
```

```sql
UPDATE audit_log SET action = 'TAMPERED' WHERE id = 1;
UPDATE incidents SET status = 'CLOSED' WHERE status = 'DRAFT';
```

Both are refused:

```
ERROR:  IQSMS_IMMUTABLE: audit_log is append-only; UPDATE on row 1 was refused (proposal 9.4).
ERROR:  IQSMS_TRANSITION: incident 6 cannot move DRAFT -> CLOSED. Allowed from DRAFT: SUBMITTED
```

> *That is not the API refusing — I am connected directly to PostgreSQL with psql. The rules are
> enforced by triggers as well as by Express, because the API is not the only thing that can write
> to this database. The proposal lists this as a stretch goal; it is implemented.*

`cd backend && npm run test:db` runs 19 such checks if they want to see the whole set.

---

## 6 · Audits (1.5 min)

**Audits** → open a `PLANNED` one. Answer items; mark one **Non-compliant** and add a note.
Save. The audit moves to `IN_PROGRESS` on its own.

Try **Mark Completed** with items unanswered → refused, with a count of what is outstanding.

> *These records back an ISO 9001 §9.2 internal-audit claim. A half-finished checklist is not
> evidence of anything.*

---

## 7 · KPI dashboard (1.5 min)

**Dashboard.** Three KPIs, computed live.

> *No table stores these. They are aggregate queries at request time, so the dashboard cannot show
> a stale number. And they are scoped — a Department Lead sees their department's closure rate,
> not the company's.*

Point at the bottom panel showing each formula. Point at the NMFR tile:

> *200,000 is the OSHA normalisation constant — 100 full-time employees at 2,000 hours. If nobody
> has logged person-hours the tile says so rather than showing a misleading zero.*

---

## 8 · The model, honestly (2 min) — where marks are won

**Risk model.**

Start with the leakage panel:

> *Twenty columns excluded. An accuracy above 0.95 on this problem is a symptom of leakage, not
> success.*

Then set A:

> *This is a null result and I am reporting it as one. Accuracy 0.660 against a majority-class
> baseline of 0.680 — no better than always guessing "significant". Recall of 0.91 with precision
> at the base rate tells you the model is doing exactly that. Cause, component, location, pressure
> and diameter alone do not determine whether a gas distribution incident becomes significant.*

Then set B, and the comparison panel:

> *At the same 90% recall, set B correctly clears 139 non-significant incidents against set A's
> 70 — twice the useful filtering at an identical safety level. That is the number that matters
> operationally, and it is a better statement of the gain than the accuracy delta.*

Close on the claim:

> *So the honest claim is severity triage, not prevention. It helps prioritise which logged
> incidents warrant escalation. It does not forecast which pipeline segment will fail — and
> nothing in this dataset would support that claim.*

And the SMOTE panel:

> *SMOTE is the reflex answer for safety data. At 68/32 it is not warranted. I evaluated it and
> rejected it on the evidence of the observed distribution. It becomes appropriate under the
> stricter SERIOUS flag, at 23/77, which is retained as a sensitivity analysis.*

---

## Questions you should expect

**"Why not train on GDC's own data?"**
Internal incident records are confidential and not available for academic use. PHMSA is a
public proxy, and the pipeline is structured so GDC's data could replace it with minimal change —
the platform's cause taxonomy is already PHMSA's own eight categories, so the vocabularies match.

**"Is 0.811 PRC-AUC good?"**
Against a no-skill baseline of 0.680, it is a real but modest improvement. I would not deploy it
as an autonomous decision-maker. As a triage aid that ranks a queue for human review, at 90%
recall, it earns its place.

**"What happens if the ML service goes down?"**
The incident still saves. Scoring is best-effort by design — a prediction outage must never block
a safety report. The record is simply marked unscored and can be re-scored later.
(`npm run score` backfills every unscored record.)

**"Why enforce the state machine twice?"**
Because the API is not the only thing that can write to the database. A migration script, a psql
session, or a service added next year all bypass the Express validation. The application layer is
what produces a useful 409 and applies the role gate — the database has no idea who is asking. The
trigger is the backstop for everyone who is not this API.

**"Could you just drop the trigger?"**
As the table owner, yes — and `TRUNCATE` bypasses row-level triggers entirely, which is exactly
how the seed script resets the audit log. In production the application role would be denied those
rights: `REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM iqsms_app`. The trigger stops casual
tampering through the normal connection; the grant is what stops a determined one. I would rather
state that limit than imply the trigger is tamper-proof.

**"Why Logistic Regression over Random Forest?"**
On set B they tie on PRC-AUC (0.811 both), within one standard deviation. Logistic Regression won
the tie-break by a fraction; on a 1,496-row dataset I would rather ship the simpler, more
interpretable model than claim a difference the data does not support.

**"How do you know the RBAC actually works?"**
`npm test` — 42 black-box checks over HTTP. It caught a real bug: incidents filed without a
zone were invisible to their own department lead. `npm run test:db` adds 19 more that write
straight to PostgreSQL with Express out of the picture.
