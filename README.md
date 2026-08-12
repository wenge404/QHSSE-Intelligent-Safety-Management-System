# QHSSE Intelligent Safety Management System (IQSMS)

A digital platform for incident tracking, audit management, and predictive risk classification, built for the QHSSE/IMS function at Gaz du Cameroun (GDC).

Computer Engineering internship defense project — University of Buea, Faculty of Engineering and Technology.

---

## Repository layout

```
.
├── backend/      Express.js REST API + Prisma ORM + PostgreSQL
├── frontend/     Next.js 14 + React + TypeScript + Tailwind CSS
├── ml-service/   Python + FastAPI + scikit-learn risk classifier
└── docs/         Proposal, roadmap, architecture notes
```

Three services, run independently in development:

| Service | Port | Stack |
|---|---|---|
| `frontend` | 3000 | Next.js 14, React, TypeScript, Tailwind |
| `backend` | 4000 | Node.js, Express, Prisma, PostgreSQL |
| `ml-service` | 8000 | Python 3.11, FastAPI, scikit-learn |

Request flow: **frontend → backend → ml-service**. The frontend never calls the ML service directly; the backend calls it during incident create/update and persists the returned risk prediction.

---

## Prerequisites

- Node.js LTS (18+)
- Python 3.11
- PostgreSQL 14+
- Git

---

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env        # then edit DATABASE_URL and JWT_SECRET
npx prisma format           # tidies schema.prisma
npx prisma validate         # confirms the schema is valid
npx prisma migrate dev --name init
npm run dev                 # http://localhost:4000/health
```

### 2. ML service

```bash
cd ml-service
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000   # http://localhost:8000/health
```

### 3. Frontend

Not scaffolded yet — this happens in Phase 3. From the repository root:

```bash
npx create-next-app@latest frontend --typescript --tailwind --eslint --app
```

`frontend/` currently holds only a `.gitkeep` so the directory exists in Git. Delete it before running the command above if the generator objects to a non-empty directory.

---

## Project phases

See `docs/IQSMS_Execution_Roadmap.md` for the full checklist.

| Phase | Focus | Weeks |
|---|---|---|
| 0 | Groundwork — repo, environment, PHMSA data profiling | before W1 |
| 1 | Requirements & schema design | 1–2 |
| 2 | Core backend & RBAC | 3–4 |
| 3 | Frontend & responsive UI | 5–6 |
| 4 | ML pipeline & predictive service | 7–8 |
| 5 | Integration & dashboard | 9–10 |
| 6 | Documentation & defense | 11–12 |

---

## Note on data

This repository is **public**. It must contain no confidential or proprietary GDC material — no internal incident records, audit reports, or IMS documents. The platform is demonstrated with synthetic operational data, and the risk model is trained on the public PHMSA gas-pipeline incident dataset as a proxy. Raw datasets are gitignored (`ml-service/data/`) and should not be committed.
