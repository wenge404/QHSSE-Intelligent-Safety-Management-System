# API reference

Base URL `http://localhost:4000`. All routes are prefixed `/api/v1`.

Every endpoint except `POST /auth/login` and `GET /meta/health` requires
`Authorization: Bearer <token>`.

## Conventions

| Status | Meaning |
| --- | --- |
| 400 | Validation failed — body includes `details[]` with `path` and `message` |
| 401 | Missing, invalid or expired token; or account deactivated |
| 403 | Authenticated, but the role is not entitled to this action |
| 404 | Record does not exist **or is outside your visibility scope** |
| 409 | Illegal state transition, or a business rule blocks the write |
| 503 | Predictive service unreachable |

Errors are `{ "error": "message", "details": ... }`.

Collections return `{ "data": [...] }`; paginated collections add
`{ "pagination": { page, pageSize, total, pages } }`.

---

## Authentication

### `POST /auth/login`

```json
{ "email": "admin@gdc.cm", "password": "Password123!" }
```

→ `200`

```json
{
  "token": "eyJhbGciOi...",
  "user": {
    "id": 1, "email": "admin@gdc.cm", "fullName": "Amina Njoya",
    "role": "SYSTEM_ADMIN", "department": "Corporate",
    "zoneId": null, "zoneName": null, "scopeLabel": "Organisation-wide"
  }
}
```

Wrong password and unknown address return the same `401` after comparable work, so the response
does not reveal whether an address is registered. Successful logins are written to the audit log.

### `GET /auth/me`

Returns the current principal. Role and scope are re-read from the database, not from the token.

---

## Metadata

| Endpoint | Description |
| --- | --- |
| `GET /meta/enums` | Every Prisma enum, keyed by name. The frontend builds its dropdowns from this so the vocabulary has one source of truth. |
| `GET /meta/workflow` | Legal transitions and role gates for incidents, corrective actions and audits. The UI uses it to grey out impossible buttons. |
| `GET /meta/health` | *(unauthenticated)* API status and predictive-service reachability. |

---

## Incidents

### `GET /incidents`

Query: `status`, `type`, `causeCategory`, `zoneId`, `from`, `to`, `search`, `page`, `pageSize`
(max 100).

Scoped to the caller (see [architecture §3](architecture.md#3-role-based-access-control-93)).

### `GET /incidents/:id`

Full record plus `correctiveActions[]`, `attachments[]`, and `history[]` — the audit-log entries
for this incident in chronological order.

### `POST /incidents`

Creates in `DRAFT` under the caller's name, assigns a reference number from the row id, and scores
the record through the predictive service. **Scoring is best-effort**: a predictive-service outage
must never stop a safety report from being filed.

```json
{
  "type": "INCIDENT",
  "title": "Third-party excavation strike on distribution main",
  "description": "A contractor struck a buried steel main during roadworks…",
  "occurredAt": "2026-08-11T09:30:00Z",
  "zoneId": 3,
  "causeCategory": "EXCAVATION_DAMAGE",
  "systemPart": "MAIN",
  "locationType": "PUBLIC_PROPERTY",
  "linePressurePsig": 60,
  "pipeDiameterInches": 4,
  "ignitionOccurred": true,
  "explosionOccurred": false,
  "pipeMaterial": "STEEL",
  "releaseType": "MECHANICAL_PUNCTURE",
  "incidentAreaType": "UNDERGROUND",
  "yearInstalled": 1995,
  "severity": "HIGH",
  "fatalities": 0,
  "injuries": 1,
  "propertyDamageCost": 4200000,
  "gasVolumeReleasedMcf": 12.5,
  "evacuationCount": 8
}
```

Every field after `occurredAt` is optional.

### `PATCH /incidents/:id`

Editable only in `DRAFT`, `SUBMITTED` or `UNDER_INVESTIGATION`. In `DRAFT` only the reporter (or
an approver) may edit; afterwards only investigators may. Re-scores the record, since any edit can
change the model inputs.

### `POST /incidents/:id/transition`

```json
{ "status": "SUBMITTED", "note": "optional, recorded in the audit trail" }
```

`409` if the transition is illegal, `403` if the role is not entitled to it, `409` if closing
while corrective actions remain unverified.

### `POST /incidents/:id/score`

Re-runs the prediction and persists it. `503` if the predictive service is down.

---

## Audits

| Endpoint | Description |
| --- | --- |
| `GET /audits` | Scoped list with template, zone, conductor and response counts |
| `GET /audits/:id` | Audit with full checklist, recorded responses and audit-log history |
| `POST /audits` | `{ templateId, zoneId?, scheduledDate, conductedById? }` — only a System Admin may schedule for someone else |
| `POST /audits/:id/responses` | Bulk upsert, keyed on `(auditId, checklistItemId)` so re-answering corrects rather than duplicates |
| `POST /audits/:id/transition` | `409` if completing with unanswered items |

```json
{ "responses": [ { "checklistItemId": 12, "complianceStatus": "NON_COMPLIANT", "notes": "…" } ] }
```

Items that do not belong to the audit's template are rejected with `400`.

---

## Corrective actions

| Endpoint | Description |
| --- | --- |
| `GET /corrective-actions` | Scoped list; `?mine=true` restricts to actions assigned to you |
| `POST /corrective-actions` | Raise an action |
| `POST /corrective-actions/:id/transition` | Move through the lifecycle |
| `POST /corrective-actions/refresh-overdue` | Sweep elapsed due dates into `OVERDUE`; returns `{ markedOverdue }` |

```json
{
  "description": "Re-brief all excavation contractors on the permit-to-dig procedure.",
  "source": "INCIDENT",
  "incidentId": 42,
  "assignedToId": 7,
  "dueDate": "2026-09-15T00:00:00Z"
}
```

Exactly one of `incidentId` / `auditResponseId` must be present and must agree with `source`;
otherwise `400`. Raising an action against an incident in `UNDER_INVESTIGATION` advances it to
`CORRECTIVE_ACTION_PENDING`.

Verification is doubly guarded: a QHSSE Auditor may verify only `AUDIT_RESPONSE`-sourced actions,
and nobody but a System Admin may verify an action assigned to themselves.

---

## KPIs

### `GET /kpis`

Query: `from`, `to` (default: last 12 months), `zoneId`.

```json
{
  "period": { "from": "2025-08-12T…", "to": "2026-08-12T…" },
  "scope": "Organisation-wide",
  "kpis": {
    "cacr": { "value": 53.06, "unit": "%", "label": "Corrective Action Closure Rate",
              "formula": "(closed corrective actions / total raised) x 100",
              "numerator": 26, "denominator": 49, "note": null },
    "mttc": { "value": 30.8, "unit": "days", "sampleSize": 26, "note": null },
    "nmfr": { "value": 9.84, "unit": "per 200,000 person-hours",
              "nearMisses": 16, "personHours": 325192, "note": null }
  },
  "counts": { "totalIncidents": 47, "nearMisses": 16, "overdueActions": 19, "…": "…" },
  "breakdowns": { "byStatus": [], "byCause": [], "byPredictedRisk": [], "byZone": [], "monthly": [] }
}
```

Every KPI carries its numerator, denominator and formula so the dashboard can show its working,
and a `note` that explains a `null` value rather than rendering a misleading zero.

### `GET /kpis/corrective-actions`

Raw rows behind the tiles, for drill-down.

---

## Prediction

### `POST /predict`

Ad-hoc scoring with no persistence — the incident form calls this as the user types.

```json
{
  "causeCategory": "EXCAVATION_DAMAGE", "systemPart": "MAIN",
  "locationType": "PUBLIC_PROPERTY", "linePressurePsig": 200,
  "pipeDiameterInches": 8, "ignitionOccurred": true, "explosionOccurred": true,
  "pipeMaterial": "STEEL", "releaseType": "RUPTURE",
  "incidentAreaType": "UNDERGROUND", "pipeAgeYears": 45,
  "featureSet": "B"
}
```

→

```json
{
  "probability": 0.916, "riskLevel": "CRITICAL", "model": "Logistic Regression",
  "featureSet": "B", "threshold": 0.482, "predictedSignificant": true, "baseRate": 0.68
}
```

All inputs are optional — the pipeline imputes missing numerics and treats absent categoricals as
a learned `MISSING` category, so scoring a half-filled draft is legitimate.

`featureSet` defaults to `B` (triage, served). `A` is the circumstances-only baseline, reported in
the evaluation as a null result.

### `GET /predict/models`

The full cross-validated comparison, proxied from the FastAPI service.

---

## Administration

| Endpoint | Role required |
| --- | --- |
| `GET /admin/users` | Any authenticated user — assigning an action requires picking an assignee |
| `POST /admin/users` | System Admin |
| `PATCH /admin/users/:id` | System Admin — refuses to remove the last active admin |
| `GET /admin/zones` | Any |
| `POST /admin/zones` | System Admin |
| `GET /admin/templates` | Any |
| `POST /admin/templates` | System Admin |
| `GET /admin/operational-hours` | Any |
| `POST /admin/operational-hours` | System Admin or Department Lead |
| `GET /admin/audit-log` | System Admin or Department Lead |

### `GET /admin/audit-log`

Query: `entityType`, `entityId`, `userId`, `page`, `pageSize` (max 200).

**This is the only audit-log route.** No `POST`, `PATCH`, `PUT` or `DELETE` exists — that absence
is what makes the table insert-only at the application layer, and the verification suite asserts
all three mutating verbs return 404.
