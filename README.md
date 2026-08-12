# QHSSE Intelligent Safety Management System (IQSMS)

A digital platform for incident tracking, audit management, and predictive risk classification, built for the QHSSE/IMS function at Gaz du Cameroun (GDC), Logbaba gas field, Douala.

Computer Engineering internship defense project — University of Buea, Faculty of Engineering and Technology.

| Module | ISO standard & clause | Focus |
| --- | --- | --- |
| Incident & Near-Miss Management | ISO 45001:2018 §10.2 | Incident, nonconformity and corrective action |
| Audit & Inspection Management | ISO 9001:2015 §9.2 | Internal audit |
| Predictive Risk Module | ISO 14001:2015 §6.1 | Actions to address risks and opportunities |

---

## Repository layout

```
.
├── backend/      Express.js REST API + Prisma ORM + PostgreSQL
├── frontend/     Next.js 14 + React + TypeScript + Tailwind CSS
├── ml-service/   Python + FastAPI + scikit-learn risk classifier
└── docs/         Proposal, roadmap, architecture, API reference, ML evaluation
```

Three services, run independently in development:

| Service | Port | Stack |
|---|---|---|
| `frontend` | 3000 | Next.js 14, React, TypeScript, Tailwind |
| `backend` | 4000 | Node.js, Express, Prisma, PostgreSQL |
| `ml-service` | 8000 | Python 3.11+, FastAPI, scikit-learn |

Request flow: **frontend → backend → ml-service**. The frontend never calls the ML service directly; the backend calls it during incident create/update and persists the returned risk prediction.

---

## Prerequisites

- Node.js LTS (18+; developed on 24)
- Python 3.11+
- PostgreSQL 14+ — or Docker, see below
- Git

---

## Setup

### 0. Database

The quickest path is the bundled Compose file, which starts PostgreSQL 16 on host port **5433** so it cannot collide with a local PostgreSQL on 5432:

```bash
docker compose up -d
```

To use an existing PostgreSQL instead, create an `iqsms` database and point `DATABASE_URL` at it in `backend/.env`.

### 1. Backend

```bash
cd backend && npm install && cp .env.example .env && npx prisma migrate deploy && npx prisma generate
```

Then load the demo data and start it:

```bash
cd backend && npm run seed:full && npm run dev
```

`seed:full` seeds synthetic operational records and then scores them through the ML service, so start the ML service first (step 2) if you want risk bands populated. `npm run seed` alone works without it; `npm run score` backfills later.

Health check: <http://localhost:4000/health>

### 2. ML service

```bash
cd ml-service && python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
```

Place the PHMSA gas distribution flagged file at `ml-service/data/gd2010toPresent.xlsx`, then train and serve:

```bash
cd ml-service && .venv/Scripts/python train.py && .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Health check: <http://localhost:8000/health>

> On macOS/Linux replace `.venv/Scripts/python` with `.venv/bin/python`.

### 3. Frontend

```bash
cd frontend && npm install && npm run dev
```

Open <http://localhost:3000>.

---

## Demo accounts

All use the password `Password123!`. Each role sees a different slice of the same data — signing in as more than one is the quickest way to see the access-control matrix at work.

| Email | Role | Visibility |
| --- | --- | --- |
| `admin@gdc.cm` | System Admin | Organisation-wide |
| `lead.integrity@gdc.cm` | Department Lead | Pipeline Integrity department |
| `lead.distribution@gdc.cm` | Department Lead | Distribution department |
| `auditor.sectiona@gdc.cm` | QHSSE Auditor | Pipeline Section A |
| `auditor.prms@gdc.cm` | QHSSE Auditor | PRMS Station Bonaberi |
| `reporter.plant@gdc.cm` | Field Reporter | Own submissions only |
| `reporter.field@gdc.cm` | Field Reporter | Own submissions only |
| `reporter.dist@gdc.cm` | Field Reporter | Own submissions only |

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  frontend           │────▶│  backend             │────▶│  PostgreSQL     │
│  Next.js 14, React  │ REST│  Express, Prisma, JWT│     │  triggers +     │
│  Tailwind, Recharts │     │  RBAC, state machine │     │  CHECK guards   │
│  :3000              │     │  :4000               │     └─────────────────┘
└─────────────────────┘     └──────────┬───────────┘
                                       │ POST /api/v1/predict
                                       ▼
                            ┌──────────────────────┐
                            │  ml-service          │
                            │  FastAPI + sklearn   │
                            │  :8000               │
                            └──────────────────────┘
```

`backend/src` follows the layering set out in the execution roadmap:

```
config/        env loading, shared Prisma client
routes/        thin *.routes.ts — path, middleware, handler
controllers/   *.controller.ts — request handling and business logic
services/      audit-log writer, ML service client
middleware/    authentication + RBAC, error translation
domain/        state machine, RBAC scoping, reference numbers
schemas/       Zod request validation
```

---

## Workflow integrity

The incident lifecycle

```
DRAFT → SUBMITTED → UNDER_INVESTIGATION → CORRECTIVE_ACTION_PENDING → VERIFIED → CLOSED
```

is enforced **twice, on purpose**:

1. **Application layer** — `backend/src/domain/stateMachine.ts` rejects an illegal transition with 409 and a role-forbidden one with 403, and writes every accepted transition to the audit log.
2. **Database layer** — triggers in `backend/prisma/migrations/20260812160000_state_transition_guards/` refuse the same writes even from a direct `psql` session, along with an append-only guard on `audit_log` and CHECK constraints for the polymorphic corrective-action parent.

The second is what turns the ISO 45001 §10.2 audit trail from a convention into a guarantee: the API is not the only thing that can write to this database. Listed in the proposal as a stretch goal (§13) and delivered.

---

## Verification

```bash
cd backend && npm test && npm run test:db
```

- `npm test` — **42 black-box checks over HTTP** covering authentication, RBAC visibility scoping, transition legality and role gating, the corrective-action closure guard, the insert-only audit log, predictive scoring and KPI computation. Requires all three services running with the demo seed loaded.
- `npm run test:db` — **19 checks written straight to PostgreSQL**, deliberately bypassing Express, proving the triggers and CHECK constraints hold for writers that are not this API. Each runs in a transaction that is always rolled back.

See [docs/testing.md](docs/testing.md).

---

## What the predictive model actually claims

The model performs **severity triage, not prevention**. It estimates whether an incident that has already occurred meets PHMSA's `SIGNIFICANT` threshold, so investigation can be prioritised. It does **not** forecast which pipeline segment will fail next.

| Set | Features | PRC-AUC | Claim |
| --- | --- | --- | --- |
| **A** | cause, component, location, pressure, diameter | 0.746 | Prevention — **null result**, accuracy at the majority baseline |
| **B** | A + ignition, explosion, material, release type, area, pipe age | **0.811** | Triage — served by the platform |

Set A is kept and reported as a documented baseline rather than quietly dropped. Full method, leakage control and operating-threshold rationale: [docs/ml-evaluation.md](docs/ml-evaluation.md).

---

## Documentation

- [docs/IQSMS_Execution_Roadmap.md](docs/IQSMS_Execution_Roadmap.md) — phase-by-phase checklist
- [docs/architecture.md](docs/architecture.md) — layers, state machine, RBAC, audit trail, KPIs, database guards
- [docs/api-reference.md](docs/api-reference.md) — every endpoint with request/response shapes
- [docs/ml-evaluation.md](docs/ml-evaluation.md) — dataset, leakage control, model comparison
- [docs/testing.md](docs/testing.md) — what the two verification suites prove
- [docs/defense-demo.md](docs/defense-demo.md) — a 12-minute live demonstration script

---

## Note on data

This repository is **public**. It contains no confidential or proprietary GDC material — no internal incident records, audit reports, or IMS documents. The platform is demonstrated with synthetic operational data generated against GDC's Logbaba fields (gas plant, pipeline sections A–C, PRMS stations).

The risk model is trained on the public **PHMSA Pipeline Incident Flagged Files**, gas distribution 2010–present (Form 7100.1) — 1,589 operator-submitted records, 1,496 after the fire-first exclusion. Source: <https://www.phmsa.dot.gov/data-and-statistics>. Raw datasets are gitignored (`ml-service/data/`) and are not committed.
