/**
 * End-to-end verification of the behaviours the proposal commits to.
 *
 * Runs against a live API on PORT with the demo seed loaded:
 *
 *     npm run seed && npm run dev      # terminal 1
 *     npm test                         # terminal 2
 *
 * This is a black-box check over HTTP rather than a unit-test suite: the claims
 * being verified (RBAC scoping, state-machine enforcement, insert-only audit
 * log) are properties of the running system, not of any single function.
 */

const BASE = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = 'Password123!';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

async function login(email: string): Promise<string> {
  const response = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`Login failed for ${email}: ${response.status}`);
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function api(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function main() {
  console.log(`IQSMS end-to-end verification against ${BASE}`);

  // ------------------------------------------------------------------ auth
  section('Authentication');

  const badLogin = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gdc.cm', password: 'wrong-password' }),
  });
  check('rejects a wrong password with 401', badLogin.status === 401, `got ${badLogin.status}`);

  const noToken = await fetch(`${BASE}/api/v1/incidents`);
  check('rejects an unauthenticated request with 401', noToken.status === 401, `got ${noToken.status}`);

  const admin = await login('admin@gdc.cm');
  const lead = await login('lead.integrity@gdc.cm');
  const auditor = await login('auditor.sectiona@gdc.cm');
  const reporter = await login('reporter.field@gdc.cm');
  check('all four demo roles can sign in', Boolean(admin && lead && auditor && reporter));

  // ------------------------------------------------------------------ rbac
  section('RBAC visibility scoping (§9.3)');

  const adminList = await api(admin, '/api/v1/incidents?pageSize=100');
  const leadList = await api(lead, '/api/v1/incidents?pageSize=100');
  const auditorList = await api(auditor, '/api/v1/incidents?pageSize=100');
  const reporterList = await api(reporter, '/api/v1/incidents?pageSize=100');

  const adminTotal = adminList.body.pagination.total;
  const leadTotal = leadList.body.pagination.total;
  const auditorTotal = auditorList.body.pagination.total;
  const reporterTotal = reporterList.body.pagination.total;

  console.log(
    `  (admin ${adminTotal}, dept lead ${leadTotal}, auditor ${auditorTotal}, reporter ${reporterTotal})`,
  );

  check('System Admin sees the whole organisation', adminTotal > 0);
  check(
    'Department Lead sees strictly fewer than the admin',
    leadTotal < adminTotal,
    `${leadTotal} vs ${adminTotal}`,
  );
  check(
    'QHSSE Auditor sees no more than the department lead',
    auditorTotal <= leadTotal,
    `${auditorTotal} vs ${leadTotal}`,
  );
  check(
    'Field Reporter sees strictly fewer than the auditor',
    reporterTotal < auditorTotal,
    `${reporterTotal} vs ${auditorTotal}`,
  );

  const reporterMe = await api(reporter, '/api/v1/auth/me');
  const reporterId = reporterMe.body.id;
  check(
    'every incident a Field Reporter sees is their own submission',
    reporterList.body.data.every((i: any) => i.reportedBy.id === reporterId),
  );

  const auditorMe = await api(auditor, '/api/v1/auth/me');
  const auditorZone = auditorMe.body.zoneId;
  check(
    'every incident a QHSSE Auditor sees is in their zone or their own',
    auditorList.body.data.every(
      (i: any) => i.zone?.id === auditorZone || i.reportedBy.id === auditorMe.body.id,
    ),
  );

  // A record the reporter cannot see must 404, not 403 — the API should not
  // confirm the existence of out-of-scope records.
  const outOfScope = adminList.body.data.find(
    (i: any) => i.reportedBy.id !== reporterId,
  );
  const denied = await api(reporter, `/api/v1/incidents/${outOfScope.id}`);
  check('out-of-scope record is 404, not 403', denied.status === 404, `got ${denied.status}`);

  // -------------------------------------------------------- state machine
  section('Workflow state machine (§9.2)');

  const created = await api(reporter, '/api/v1/incidents', {
    method: 'POST',
    body: JSON.stringify({
      title: 'E2E test — suspected leak at test riser',
      description: 'Automated end-to-end verification record. Safe to delete.',
      occurredAt: new Date().toISOString(),
      type: 'INCIDENT',
      causeCategory: 'EXCAVATION_DAMAGE',
      systemPart: 'MAIN',
      locationType: 'PUBLIC_PROPERTY',
      linePressurePsig: 60,
      pipeDiameterInches: 4,
      ignitionOccurred: true,
      explosionOccurred: false,
      pipeMaterial: 'STEEL',
      releaseType: 'MECHANICAL_PUNCTURE',
      incidentAreaType: 'UNDERGROUND',
      yearInstalled: 1995,
    }),
  });
  check('Field Reporter can create an incident', created.status === 201, `got ${created.status}`);
  const incidentId = created.body?.id;
  check('new incident starts in DRAFT', created.body?.status === 'DRAFT', created.body?.status);
  check(
    'reference number is assigned from the row id',
    /^INC-\d{4}-\d{4}$/.test(created.body?.referenceNumber ?? ''),
    created.body?.referenceNumber,
  );

  // Illegal jump: DRAFT cannot go straight to CLOSED.
  const illegal = await api(reporter, `/api/v1/incidents/${incidentId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status: 'CLOSED' }),
  });
  check('illegal DRAFT → CLOSED jump is rejected with 409', illegal.status === 409, `got ${illegal.status}`);

  const legal = await api(reporter, `/api/v1/incidents/${incidentId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status: 'SUBMITTED' }),
  });
  check('legal DRAFT → SUBMITTED is accepted', legal.status === 200, `got ${legal.status}`);

  // A Field Reporter may not drive an investigation forward.
  const forbidden = await api(reporter, `/api/v1/incidents/${incidentId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status: 'UNDER_INVESTIGATION' }),
  });
  check(
    'Field Reporter cannot move SUBMITTED → UNDER_INVESTIGATION (403)',
    forbidden.status === 403,
    `got ${forbidden.status}`,
  );

  const byLead = await api(lead, `/api/v1/incidents/${incidentId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status: 'UNDER_INVESTIGATION' }),
  });
  check('Department Lead can move it to UNDER_INVESTIGATION', byLead.status === 200, `got ${byLead.status}`);

  // ------------------------------------------------- corrective actions
  section('Corrective actions and closure guard');

  const action = await api(lead, '/api/v1/corrective-actions', {
    method: 'POST',
    body: JSON.stringify({
      description: 'E2E test — re-brief the excavation crew on permit-to-dig.',
      source: 'INCIDENT',
      incidentId,
      assignedToId: reporterId,
      dueDate: new Date(Date.now() + 14 * 86400000).toISOString(),
    }),
  });
  check('Department Lead can raise a corrective action', action.status === 201, `got ${action.status}`);
  const actionId = action.body?.id;

  const afterRaise = await api(lead, `/api/v1/incidents/${incidentId}`);
  check(
    'raising an action advances the incident to CORRECTIVE_ACTION_PENDING',
    afterRaise.body?.status === 'CORRECTIVE_ACTION_PENDING',
    afterRaise.body?.status,
  );

  const prematureClose = await api(lead, `/api/v1/incidents/${incidentId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status: 'VERIFIED' }),
  });
  check(
    'incident cannot be verified while an action is unverified (409)',
    prematureClose.status === 409,
    `got ${prematureClose.status}`,
  );

  // Polymorphic parent guard: both FKs set at once must be rejected.
  const bothParents = await api(lead, '/api/v1/corrective-actions', {
    method: 'POST',
    body: JSON.stringify({
      description: 'E2E test — should be rejected.',
      source: 'INCIDENT',
      incidentId,
      auditResponseId: 1,
      assignedToId: reporterId,
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    }),
  });
  check(
    'corrective action with two parents is rejected (400)',
    bothParents.status === 400,
    `got ${bothParents.status}`,
  );

  await api(reporter, `/api/v1/corrective-actions/${actionId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status: 'IN_PROGRESS' }),
  });
  await api(reporter, `/api/v1/corrective-actions/${actionId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status: 'COMPLETED' }),
  });

  const selfVerify = await api(reporter, `/api/v1/corrective-actions/${actionId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status: 'VERIFIED' }),
  });
  check(
    'Field Reporter cannot verify their own action (403)',
    selfVerify.status === 403,
    `got ${selfVerify.status}`,
  );

  const leadVerify = await api(lead, `/api/v1/corrective-actions/${actionId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status: 'VERIFIED' }),
  });
  check('Department Lead can verify it', leadVerify.status === 200, `got ${leadVerify.status}`);

  const nowClose = await api(lead, `/api/v1/incidents/${incidentId}/transition`, {
    method: 'POST',
    body: JSON.stringify({ status: 'VERIFIED' }),
  });
  check(
    'incident can be verified once its actions are verified',
    nowClose.status === 200,
    `got ${nowClose.status}`,
  );

  // -------------------------------------------------------- audit trail
  section('Immutable audit log (§9.4)');

  const history = await api(lead, `/api/v1/incidents/${incidentId}`);
  const entries = history.body?.history ?? [];
  check('every state change was recorded', entries.length >= 5, `${entries.length} entries`);
  check(
    'entries carry previous and new state',
    entries.some((e: any) => e.previousState === 'DRAFT' && e.newState === 'SUBMITTED'),
  );

  const reporterLog = await api(reporter, '/api/v1/admin/audit-log');
  check(
    'Field Reporter cannot read the audit log (403)',
    reporterLog.status === 403,
    `got ${reporterLog.status}`,
  );

  const adminLog = await api(admin, '/api/v1/admin/audit-log?entityType=INCIDENT');
  check('System Admin can read the audit log', adminLog.status === 200, `got ${adminLog.status}`);

  for (const method of ['PATCH', 'DELETE', 'PUT']) {
    const attempt = await api(admin, `/api/v1/admin/audit-log/${entries[0]?.id ?? 1}`, { method });
    check(`audit log exposes no ${method} route (404)`, attempt.status === 404, `got ${attempt.status}`);
  }

  // ---------------------------------------------------------- prediction
  section('Predictive risk service (§8.2)');

  const scored = await api(lead, `/api/v1/incidents/${incidentId}`);
  check(
    'incident was scored on creation',
    scored.body?.predictedRiskScore !== null && scored.body?.predictedRiskLevel !== null,
    `${scored.body?.predictedRiskLevel} / ${scored.body?.predictedRiskScore}`,
  );
  check(
    'the serving model is recorded against the incident',
    typeof scored.body?.predictedByModel === 'string' && scored.body.predictedByModel.includes('set B'),
    scored.body?.predictedByModel,
  );

  const severe = await api(lead, '/api/v1/predict', {
    method: 'POST',
    body: JSON.stringify({
      causeCategory: 'EXCAVATION_DAMAGE',
      systemPart: 'MAIN',
      locationType: 'PUBLIC_PROPERTY',
      linePressurePsig: 200,
      pipeDiameterInches: 8,
      ignitionOccurred: true,
      explosionOccurred: true,
      pipeMaterial: 'STEEL',
      releaseType: 'RUPTURE',
      incidentAreaType: 'UNDERGROUND',
      pipeAgeYears: 45,
    }),
  });
  const minor = await api(lead, '/api/v1/predict', {
    method: 'POST',
    body: JSON.stringify({
      causeCategory: 'CORROSION_FAILURE',
      systemPart: 'SERVICE',
      locationType: 'PRIVATE_PROPERTY',
      linePressurePsig: 12,
      pipeDiameterInches: 1,
      ignitionOccurred: false,
      explosionOccurred: false,
      pipeMaterial: 'PLASTIC',
      releaseType: 'LEAK',
      incidentAreaType: 'UNDERGROUND',
      pipeAgeYears: 4,
    }),
  });
  check('predict endpoint responds', severe.status === 200 && minor.status === 200);
  check(
    'an ignited rupture scores above a minor plastic leak',
    severe.body.probability > minor.body.probability,
    `${severe.body.probability?.toFixed(3)} vs ${minor.body.probability?.toFixed(3)}`,
  );

  // ---------------------------------------------------------------- KPIs
  section('KPI computation (§11)');

  const kpis = await api(admin, '/api/v1/kpis');
  const { cacr, mttc, nmfr } = kpis.body.kpis;
  check('CACR is a percentage in range', cacr.value >= 0 && cacr.value <= 100, String(cacr.value));
  check('MTTC is a positive number of days', mttc.value > 0, String(mttc.value));
  check('NMFR is computed from logged person-hours', nmfr.value > 0, String(nmfr.value));
  check(
    'CACR agrees with its own numerator and denominator',
    Math.abs(cacr.value - (cacr.numerator / cacr.denominator) * 100) < 1e-9,
  );

  const leadKpis = await api(lead, '/api/v1/kpis');
  check(
    'KPIs are scoped to the caller',
    leadKpis.body.counts.totalIncidents < kpis.body.counts.totalIncidents,
    `${leadKpis.body.counts.totalIncidents} vs ${kpis.body.counts.totalIncidents}`,
  );

  // --------------------------------------------------------------- admin
  section('Platform administration');

  const reporterCreatesUser = await api(reporter, '/api/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: 'nope@gdc.cm',
      password: 'Password123!',
      fullName: 'Should Not Exist',
      role: 'FIELD_REPORTER',
    }),
  });
  check(
    'only System Admin can create users (403)',
    reporterCreatesUser.status === 403,
    `got ${reporterCreatesUser.status}`,
  );

  const validation = await api(admin, '/api/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: 'not-an-email', password: 'short', fullName: 'X', role: 'NOPE' }),
  });
  check('invalid payloads are rejected with 400', validation.status === 400, `got ${validation.status}`);

  // --------------------------------------------------------------- done
  console.log(`\n${'='.repeat(52)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n  Failures:`);
    for (const name of failures) console.log(`    - ${name}`);
  }
  console.log('='.repeat(52));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nTest run crashed:', error);
  process.exit(1);
});
