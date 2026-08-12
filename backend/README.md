# IQSMS backend

Express.js REST API — incidents, audits, corrective actions, RBAC, KPIs, and the immutable audit
log. TypeScript throughout, with Prisma as the ORM against PostgreSQL.

## Setup

```bash
npm install && cp .env.example .env && npx prisma migrate deploy && npx prisma generate
```

```bash
npm run seed:full && npm run dev
```

`npm run seed:full` seeds synthetic operational data and then scores it through the ML service, so
start `ml-service` first if you want risk bands populated. `npm run seed` works standalone;
`npm run score` backfills afterwards.

Health check: <http://localhost:4000/health>

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Watch mode on `src/server.ts` |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run seed` | Reset and seed synthetic demo data |
| `npm run score` | Score unscored incidents (`-- --all` re-scores everything) |
| `npm run seed:full` | `seed` then `score` |
| `npm test` | 42 black-box checks over HTTP — needs all three services up |
| `npm run test:db` | 19 checks written straight to PostgreSQL — needs only the database |
| `npm run prisma:studio` | Browse the data |

## Layout

```
prisma/
  schema.prisma      12 models; enums are 1:1 with the PHMSA vocabulary
  migrations/        includes the state-transition and audit-log triggers
  seed.ts            deterministic synthetic GDC Logbaba data
src/
  config/            env loading, shared Prisma client
  routes/            thin *.routes.ts — path, middleware, handler
  controllers/       *.controller.ts — request handling and business logic
  services/          audit-log writer, ML service client
  middleware/        authentication + RBAC, error translation
  domain/            state machine, RBAC scoping, reference numbers
  schemas/           Zod request validation
  scripts/           scoreAll.ts
  __tests__/         run.ts (HTTP), triggers.ts (database)
```

## Two layers of enforcement

The incident lifecycle

```
DRAFT → SUBMITTED → UNDER_INVESTIGATION → CORRECTIVE_ACTION_PENDING → VERIFIED → CLOSED
```

is enforced in `src/domain/stateMachine.ts` **and** by triggers in
`prisma/migrations/20260812160000_state_transition_guards/`. The application layer produces a
useful 409 and applies the role gate; the trigger is the backstop for every writer that is not
this API. The two are one rule expressed twice — change them together.

See [`docs/architecture.md`](../docs/architecture.md) for the full account, and
[`docs/api-reference.md`](../docs/api-reference.md) for every endpoint.
