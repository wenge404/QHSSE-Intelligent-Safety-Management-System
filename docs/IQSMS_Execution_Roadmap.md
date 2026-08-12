# Intelligent QHSSE Safety Management System — Execution Roadmap

The proposal's Section 13 keeps the 6 phases at a level a supervisor can read in thirty seconds. This is the version you actually work from — every phase broken into what you'd sit down and do. Same 12 weeks, same 6 phases, nothing renumbered.

---

## Before Phase 1 — Groundwork (no code yet)

- [ ] Get the proposal signed off by your academic and industry supervisors
- [ ] Set up local dev environment: Node.js LTS, Python 3.11, PostgreSQL, Git
- [ ] Create the GitHub repo — monorepo layout: `/frontend`, `/backend`, `/ml-service`
- [ ] Pull the real PHMSA gas distribution + transmission incident data; confirm the actual column names against Section 10.2's mapping table and correct it if anything's named differently
- [ ] Profile the data: build the severity index from Section 8.2 and check the real class split at a few candidate cutoffs (e.g. upper quartile, upper third) — pick the one that gives a workable balance
- [ ] Re-check `schema.prisma` against what the real data actually looks like — adjust only if something doesn't fit; it shouldn't need much

## Phase 1 — Requirements & Schema Design (Weeks 1–2)

- [ ] Finalize `schema.prisma` (already drafted — this is a review pass, not a rewrite)
- [ ] Set up local PostgreSQL, run the first `prisma migrate dev`
- [ ] Write a seed script: Zones (wellhead / processing / pipeline / office), one starter `ChecklistTemplate` with a few `ChecklistItem`s, one admin `User`
- [ ] Write the formal state-transition table for `Incident` and `CorrectiveAction` status — which transitions are legal from which state. This becomes the single source of truth the API validation *and* your report's Section 9.2 diagram both point back to
- [ ] Confirm `npx prisma format` and `npx prisma validate` run clean locally — my sandbox couldn't reach Prisma's binary servers to check this, so it's your first real verification of the schema

## Phase 2 — Core Backend & RBAC (Weeks 3–4)

- [ ] Scaffold the Express project: `routes/ controllers/ services/ middleware/`
- [ ] JWT auth — register, login, password hashing (bcrypt)
- [ ] RBAC middleware enforcing the Section 9.3 matrix per-route
- [ ] CRUD endpoints: `User`, `Zone`, `ChecklistTemplate`/`ChecklistItem`, `Incident`, `Audit`, `AuditResponse`, `CorrectiveAction`
- [ ] State-machine validation on the `Incident`/`CorrectiveAction` update endpoints — reject illegal transitions using the table from Phase 1
- [ ] `AuditLog` write on every mutating request — one middleware, not scattered manual calls, so nothing slips through
- [ ] Postman collection covering every endpoint, plus one scripted "happy path" run through the whole flow
- [ ] *Stretch, only if ahead of schedule:* a Postgres trigger enforcing the same transition rules at the database level (Section 9.2 / 13)

## Phase 3 — Frontend (Weeks 5–6)

- [ ] Scaffold Next.js + Tailwind; set up the API client (fetch wrapper that attaches the JWT)
- [ ] Auth pages — login, role-aware redirect after sign-in
- [ ] Incident form matching the PHMSA-mapped fields from Section 10.2, plus incident list/detail views
- [ ] Audit flow — pick a template, step through checklist items, submit responses
- [ ] Corrective-action board — list, assign, due date, close, verify, mirroring `CorrectiveActionStatus`
- [ ] Every screen wired to the real backend by the end of this phase — no mock data left standing

## Phase 4 — ML Pipeline & Predictive Service (Weeks 7–8)

- [ ] EDA notebook on the full cleaned PHMSA dataset — confirm the class split from your Phase-0 profiling still holds
- [ ] Feature engineering — encode `CAUSE_CATEGORY`, `SYSTEM_PART_INVOLVED`, `LOCATION_TYPE`; scale `OPERATING_PRESSURE` and `PIPE_NOMINAL_SIZE`
- [ ] Train Logistic Regression, Random Forest, and SVM; apply SMOTE and/or class-weighting per the actual imbalance found (Section 8.2)
- [ ] Evaluate all three on accuracy, precision, recall, F1, confusion matrix, and PRC-AUC — keep every result, including the losing models, for the report's comparison table
- [ ] Select the best-performing model, serialize with `joblib` (or export to ONNX)
- [ ] Build the FastAPI service with a single `/api/v1/predict` endpoint
- [ ] Smoke-test the endpoint standalone with curl/Postman *before* wiring it to Express

## Phase 5 — Integration & Dashboard (Weeks 9–10)

- [ ] Express calls FastAPI on incident create/update; stores `predictedRiskLevel`, `predictedRiskScore`, `predictedByModel`
- [ ] Show the predicted risk on the incident detail view
- [ ] Build the KPI dashboard — CACR, MTTC, NMFR (Section 11 formulas), computed live from the database, charted
- [ ] Full walkthrough: report an incident → see the prediction → raise a corrective action → close it → confirm it shows up in CACR/MTTC and in the audit log
- [ ] Seed a realistic demo dataset that tells a clear story for the defense — not random filler data
- [ ] Bug pass on whatever breaks during the walkthrough above

## Phase 6 — Documentation & Defense (Weeks 11–12)

- [ ] Expand the proposal into the final report — add results, screenshots, the model comparison table, discussion, and limitations
- [ ] Build the defense slide deck
- [ ] Script and rehearse the live demo — a fixed click-sequence you know cold
- [ ] Record a backup demo video or screenshot sequence in case the live demo fails on the day
- [ ] Prepare tight answers for the likely tough questions:
  - Why this severity threshold, and not PHMSA's own reportability criteria?
  - Why application-layer state enforcement instead of database-level?
  - Why these four RBAC roles specifically?
  - Why PHMSA data as a proxy for GDC's own operations?
- [ ] Full dry run in front of someone else, timed

---

## If you fall behind

Cut in this order — each one is already flagged as non-core in the proposal, so dropping it doesn't contradict anything you've committed to in writing:

1. **DB-level trigger enforcement** — already listed as a stretch goal, not a deliverable
2. **ONNX export** — `joblib` alone is enough to serve predictions
3. **SVM** — keep Logistic Regression and Random Forest; two models is still a real comparison
4. **Dashboard chart polish** — a working table of numbers still proves the point
