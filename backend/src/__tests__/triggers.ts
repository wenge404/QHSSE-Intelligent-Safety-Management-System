/**
 * Database-level guard verification.
 *
 *     npm run test:db
 *
 * Every write here goes straight to PostgreSQL through Prisma or raw SQL,
 * deliberately bypassing Express, its Zod schemas and the state machine in
 * src/domain/stateMachine.ts. That is the whole point: these checks prove the
 * rules hold for writers that are not this API, which is the difference
 * between an integrity guarantee and a convention (proposal §9.2, §9.4, §13).
 *
 * Each check runs inside a transaction that is always rolled back, so the
 * suite leaves no trace — including in audit_log, which cannot be cleaned up
 * afterwards by design.
 */

import { PrismaClient } from '@prisma/client';

// A dedicated client with logging off, rather than the shared one: almost every
// query in this file is *expected* to fail, and Prisma's error log would bury
// the actual PASS/FAIL lines under stack traces for errors we asked for.
const prisma = new PrismaClient({ log: [] });

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

/** Thrown to unwind a transaction once the assertion has been made. */
class Rollback extends Error {}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function expectRejected(name: string, marker: string, fn: (tx: Tx) => Promise<unknown>) {
  let accepted = false;
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      accepted = true;
      throw new Rollback();
    });
  } catch (error) {
    if (!accepted) {
      const message = error instanceof Error ? error.message : String(error);
      check(
        name,
        message.includes(marker),
        message.includes(marker) ? '' : `refused, but not by ${marker}: ${message.slice(0, 140)}`,
      );
      return;
    }
  }
  check(name, false, 'the database ACCEPTED a write it should have refused');
}

async function expectAccepted(name: string, fn: (tx: Tx) => Promise<unknown>) {
  let accepted = false;
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      accepted = true;
      throw new Rollback();
    });
  } catch (error) {
    if (!accepted) {
      const message = error instanceof Error ? error.message : String(error);
      check(name, false, message.slice(0, 160));
      return;
    }
  }
  check(name, true);
}

async function main() {
  console.log('IQSMS database guard verification (Express is not involved)');

  const reporter = await prisma.user.findFirstOrThrow({ where: { role: 'FIELD_REPORTER' } });
  const zone = await prisma.zone.findFirstOrThrow();
  const template = await prisma.checklistTemplate.findFirstOrThrow();

  /** A fresh DRAFT incident inside the caller's transaction. */
  async function newIncident(tx: Tx, status = 'DRAFT') {
    return tx.incident.create({
      data: {
        referenceNumber: `INC-TRIGGER-${Math.random().toString(36).slice(2, 10)}`,
        title: 'Trigger verification record',
        description: 'Created inside a transaction that is always rolled back.',
        occurredAt: new Date(),
        reportedById: reporter.id,
        zoneId: zone.id,
        status: status as never,
      },
    });
  }

  // ---------------------------------------------------------------- incidents
  section('Incident transition trigger');

  await expectRejected(
    'DRAFT → CLOSED is refused by the database',
    'IQSMS_TRANSITION',
    async (tx) => {
      const incident = await newIncident(tx);
      await tx.$executeRawUnsafe(
        `UPDATE incidents SET status = 'CLOSED' WHERE id = ${incident.id}`,
      );
    },
  );

  await expectAccepted('DRAFT → SUBMITTED is allowed', async (tx) => {
    const incident = await newIncident(tx);
    await tx.$executeRawUnsafe(
      `UPDATE incidents SET status = 'SUBMITTED' WHERE id = ${incident.id}`,
    );
  });

  await expectRejected(
    'CLOSED is terminal — no transition out of it',
    'IQSMS_TRANSITION',
    async (tx) => {
      const incident = await newIncident(tx, 'CLOSED');
      await tx.$executeRawUnsafe(
        `UPDATE incidents SET status = 'DRAFT' WHERE id = ${incident.id}`,
      );
    },
  );

  await expectRejected(
    'skipping investigation (SUBMITTED → VERIFIED) is refused',
    'IQSMS_TRANSITION',
    async (tx) => {
      const incident = await newIncident(tx, 'SUBMITTED');
      await tx.$executeRawUnsafe(
        `UPDATE incidents SET status = 'VERIFIED' WHERE id = ${incident.id}`,
      );
    },
  );

  await expectAccepted('an update that does not touch status is unaffected', async (tx) => {
    const incident = await newIncident(tx);
    await tx.incident.update({
      where: { id: incident.id },
      data: { title: 'Edited without changing state' },
    });
  });

  // ------------------------------------------------------- corrective actions
  section('Corrective action transition trigger');

  async function newAction(tx: Tx, status = 'OPEN') {
    const incident = await newIncident(tx, 'CORRECTIVE_ACTION_PENDING');
    return tx.correctiveAction.create({
      data: {
        referenceNumber: `CA-TRIGGER-${Math.random().toString(36).slice(2, 10)}`,
        description: 'Trigger verification action.',
        source: 'INCIDENT',
        incidentId: incident.id,
        assignedToId: reporter.id,
        dueDate: new Date(Date.now() + 86400000),
        status: status as never,
      },
    });
  }

  await expectRejected(
    'OPEN → VERIFIED skips the work and is refused',
    'IQSMS_TRANSITION',
    async (tx) => {
      const action = await newAction(tx);
      await tx.$executeRawUnsafe(
        `UPDATE corrective_actions SET status = 'VERIFIED' WHERE id = ${action.id}`,
      );
    },
  );

  await expectAccepted('OPEN → IN_PROGRESS is allowed', async (tx) => {
    const action = await newAction(tx);
    await tx.$executeRawUnsafe(
      `UPDATE corrective_actions SET status = 'IN_PROGRESS' WHERE id = ${action.id}`,
    );
  });

  await expectAccepted('OVERDUE → COMPLETED recovers correctly', async (tx) => {
    const action = await newAction(tx, 'OVERDUE');
    await tx.$executeRawUnsafe(
      `UPDATE corrective_actions SET status = 'COMPLETED' WHERE id = ${action.id}`,
    );
  });

  await expectRejected(
    'VERIFIED is terminal for corrective actions',
    'IQSMS_TRANSITION',
    async (tx) => {
      const action = await newAction(tx, 'VERIFIED');
      await tx.$executeRawUnsafe(
        `UPDATE corrective_actions SET status = 'OPEN' WHERE id = ${action.id}`,
      );
    },
  );

  // -------------------------------------------------------------------- audits
  section('Audit transition trigger');

  async function newAudit(tx: Tx, status = 'PLANNED') {
    return tx.audit.create({
      data: {
        referenceNumber: `AUD-TRIGGER-${Math.random().toString(36).slice(2, 10)}`,
        templateId: template.id,
        zoneId: zone.id,
        conductedById: reporter.id,
        scheduledDate: new Date(),
        status: status as never,
      },
    });
  }

  await expectRejected('a COMPLETED audit cannot be reopened', 'IQSMS_TRANSITION', async (tx) => {
    const audit = await newAudit(tx, 'COMPLETED');
    await tx.$executeRawUnsafe(`UPDATE audits SET status = 'PLANNED' WHERE id = ${audit.id}`);
  });

  await expectAccepted('PLANNED → IN_PROGRESS is allowed', async (tx) => {
    const audit = await newAudit(tx);
    await tx.$executeRawUnsafe(`UPDATE audits SET status = 'IN_PROGRESS' WHERE id = ${audit.id}`);
  });

  // ----------------------------------------------------------------- audit log
  section('Audit-log append-only trigger (§9.4)');

  await expectAccepted('INSERT into audit_log is allowed', async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: reporter.id,
        action: 'TRIGGER_TEST',
        entityType: 'INCIDENT',
        entityId: 1,
        newState: 'DRAFT',
      },
    });
  });

  await expectRejected('UPDATE of an audit_log row is refused', 'IQSMS_IMMUTABLE', async (tx) => {
    const entry = await tx.auditLog.create({
      data: { userId: reporter.id, action: 'TRIGGER_TEST', entityType: 'INCIDENT', entityId: 1 },
    });
    await tx.$executeRawUnsafe(
      `UPDATE audit_log SET action = 'TAMPERED' WHERE id = ${entry.id}`,
    );
  });

  await expectRejected('DELETE of an audit_log row is refused', 'IQSMS_IMMUTABLE', async (tx) => {
    const entry = await tx.auditLog.create({
      data: { userId: reporter.id, action: 'TRIGGER_TEST', entityType: 'INCIDENT', entityId: 1 },
    });
    await tx.$executeRawUnsafe(`DELETE FROM audit_log WHERE id = ${entry.id}`);
  });

  await expectRejected(
    'a blanket DELETE of the whole trail is refused',
    'IQSMS_IMMUTABLE',
    async (tx) => {
      await tx.$executeRawUnsafe('DELETE FROM audit_log');
    },
  );

  // ------------------------------------------------------------- CHECK guards
  section('CHECK constraints');

  await expectRejected(
    'a corrective action with two parents is unrepresentable',
    'corrective_actions_exactly_one_parent',
    async (tx) => {
      const incident = await newIncident(tx, 'CORRECTIVE_ACTION_PENDING');
      const audit = await newAudit(tx);
      const item = await tx.checklistItem.findFirstOrThrow({
        where: { templateId: template.id },
      });
      const response = await tx.auditResponse.create({
        data: { auditId: audit.id, checklistItemId: item.id, complianceStatus: 'NON_COMPLIANT' },
      });
      await tx.correctiveAction.create({
        data: {
          referenceNumber: `CA-TRIGGER-${Math.random().toString(36).slice(2, 10)}`,
          description: 'Two parents — should be impossible.',
          source: 'INCIDENT',
          incidentId: incident.id,
          auditResponseId: response.id,
          assignedToId: reporter.id,
          dueDate: new Date(Date.now() + 86400000),
        },
      });
    },
  );

  await expectRejected(
    'a corrective action with no parent is unrepresentable',
    'corrective_actions_exactly_one_parent',
    async (tx) => {
      await tx.correctiveAction.create({
        data: {
          referenceNumber: `CA-TRIGGER-${Math.random().toString(36).slice(2, 10)}`,
          description: 'Orphan — should be impossible.',
          source: 'INCIDENT',
          assignedToId: reporter.id,
          dueDate: new Date(Date.now() + 86400000),
        },
      });
    },
  );

  await expectRejected(
    'source must agree with the parent that is set',
    'corrective_actions_exactly_one_parent',
    async (tx) => {
      const incident = await newIncident(tx, 'CORRECTIVE_ACTION_PENDING');
      await tx.correctiveAction.create({
        data: {
          referenceNumber: `CA-TRIGGER-${Math.random().toString(36).slice(2, 10)}`,
          description: 'Source says audit, parent is an incident.',
          source: 'AUDIT_RESPONSE',
          incidentId: incident.id,
          assignedToId: reporter.id,
          dueDate: new Date(Date.now() + 86400000),
        },
      });
    },
  );

  await expectRejected(
    'a negative fatality count is refused',
    'incidents_non_negative_consequences',
    async (tx) => {
      const incident = await newIncident(tx);
      await tx.$executeRawUnsafe(
        `UPDATE incidents SET fatalities = -1 WHERE id = ${incident.id}`,
      );
    },
  );

  // ------------------------------------------------------------------- summary
  console.log(`\n${'='.repeat(52)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\n  Failures:');
    for (const name of failures) console.log(`    - ${name}`);
  }
  console.log('='.repeat(52));

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error('\nTest run crashed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
