# IQSMS Backend

Express REST API with Prisma ORM over PostgreSQL. Owns all persistence, authentication, RBAC, and the audit trail.

## Layout

```
prisma/schema.prisma   Database schema (10 models)
src/app.js             Express app — middleware, routes, error handling
src/server.js          Entry point
src/config/prisma.js   Shared PrismaClient instance
src/routes/            Route definitions
src/controllers/       Request handlers
src/services/          Business logic
src/middleware/        Auth, RBAC, audit logging
```

## Setup

```bash
npm install
cp .env.example .env      # set DATABASE_URL and JWT_SECRET
npx prisma format
npx prisma validate
npx prisma migrate dev --name init
npm run dev
```

Check it's alive: `curl http://localhost:4000/health`

## Schema

Ten models: `User`, `Zone`, `Incident`, `ChecklistTemplate`, `ChecklistItem`, `Audit`, `AuditResponse`, `CorrectiveAction`, `Attachment`, `AuditLog`.

Two design points worth knowing cold for the defense:

- **Corrective actions attach to either an Incident or an AuditResponse, never both.** Prisma has no true polymorphic relation, so this uses a `source` enum plus two optional foreign keys. Enforce "exactly one FK set" in the API layer — a Zod refinement on the request body is the simplest place.
- **Checklists are template + instance.** `ChecklistTemplate`/`ChecklistItem` define a reusable form; `Audit` is one dated run of it at a zone; `AuditResponse` holds the answers. That split is what makes it a real digital-checklist system rather than a flat form table.

## Phase 2 build order

1. JWT auth — register, login, bcrypt password hashing.
2. Auth middleware, then RBAC middleware enforcing the proposal's Section 9.3 matrix per route.
3. CRUD endpoints for each model.
4. State-machine validation on `Incident` and `CorrectiveAction` status updates — reject illegal transitions using the transition table from Phase 1.
5. Audit-log middleware on every mutating route.

**On the audit log:** `AuditLog` is insert-only. Expose no update or delete route for it — that property is the whole reason it works as ISO-aligned evidence. Write to it from one middleware rather than by hand in each controller; a single forgotten call is a hole in the trail.
