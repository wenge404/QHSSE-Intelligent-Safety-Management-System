-- ============================================================================
-- Database-level guards for the IQSMS workflow
--
-- Proposal §9.2 and §13: the state machine is enforced at the application layer
-- in src/domain/stateMachine.ts, with trigger-based enforcement listed as a
-- hardening step. This migration implements it.
--
-- Why bother, when the API already checks?  Because the API is not the only
-- thing that can write to this database. A migration script, a psql session, a
-- future reporting job, or a second service added later all bypass the Express
-- validation entirely. An ISO 45001 §10.2 audit trail whose integrity rests on
-- every future caller remembering to go through one code path is not an
-- integrity guarantee — it is a convention.
--
-- These triggers and the TypeScript state machine are two expressions of ONE
-- rule. Change them together. src/domain/stateMachine.ts carries a pointer back
-- to this file.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Incident lifecycle
--
--    DRAFT → SUBMITTED → UNDER_INVESTIGATION → CORRECTIVE_ACTION_PENDING
--          → VERIFIED → CLOSED
--
--    plus SUBMITTED → DRAFT (returned to the reporter for more detail) and
--    UNDER_INVESTIGATION → CLOSED (investigation found nothing to correct).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION iqsms_check_incident_transition()
RETURNS TRIGGER AS $$
DECLARE
  allowed "IncidentStatus"[];
BEGIN
  -- Updates that do not touch the status (a re-score, an edit to the
  -- narrative) are none of this trigger's business.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.status
    WHEN 'DRAFT'                     THEN ARRAY['SUBMITTED']::"IncidentStatus"[]
    WHEN 'SUBMITTED'                 THEN ARRAY['UNDER_INVESTIGATION', 'DRAFT']::"IncidentStatus"[]
    WHEN 'UNDER_INVESTIGATION'       THEN ARRAY['CORRECTIVE_ACTION_PENDING', 'CLOSED']::"IncidentStatus"[]
    WHEN 'CORRECTIVE_ACTION_PENDING' THEN ARRAY['VERIFIED']::"IncidentStatus"[]
    WHEN 'VERIFIED'                  THEN ARRAY['CLOSED']::"IncidentStatus"[]
    WHEN 'CLOSED'                    THEN ARRAY[]::"IncidentStatus"[]
  END;

  IF NOT (NEW.status = ANY (allowed)) THEN
    RAISE EXCEPTION
      'IQSMS_TRANSITION: incident % cannot move % -> %. Allowed from %: %',
      OLD.id, OLD.status, NEW.status, OLD.status,
      COALESCE(NULLIF(array_to_string(allowed, ', '), ''), 'none (terminal state)');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS incident_transition_guard ON incidents;
CREATE TRIGGER incident_transition_guard
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION iqsms_check_incident_transition();


-- ---------------------------------------------------------------------------
-- 2. Corrective action lifecycle
--
--    OPEN → IN_PROGRESS → COMPLETED → VERIFIED, with OVERDUE reachable from
--    the two live states and recoverable back into them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION iqsms_check_corrective_action_transition()
RETURNS TRIGGER AS $$
DECLARE
  allowed "CorrectiveActionStatus"[];
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.status
    WHEN 'OPEN'        THEN ARRAY['IN_PROGRESS', 'OVERDUE']::"CorrectiveActionStatus"[]
    WHEN 'IN_PROGRESS' THEN ARRAY['COMPLETED', 'OVERDUE']::"CorrectiveActionStatus"[]
    WHEN 'OVERDUE'     THEN ARRAY['IN_PROGRESS', 'COMPLETED']::"CorrectiveActionStatus"[]
    WHEN 'COMPLETED'   THEN ARRAY['VERIFIED', 'IN_PROGRESS']::"CorrectiveActionStatus"[]
    WHEN 'VERIFIED'    THEN ARRAY[]::"CorrectiveActionStatus"[]
  END;

  IF NOT (NEW.status = ANY (allowed)) THEN
    RAISE EXCEPTION
      'IQSMS_TRANSITION: corrective action % cannot move % -> %. Allowed from %: %',
      OLD.id, OLD.status, NEW.status, OLD.status,
      COALESCE(NULLIF(array_to_string(allowed, ', '), ''), 'none (terminal state)');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS corrective_action_transition_guard ON corrective_actions;
CREATE TRIGGER corrective_action_transition_guard
  BEFORE UPDATE ON corrective_actions
  FOR EACH ROW EXECUTE FUNCTION iqsms_check_corrective_action_transition();


-- ---------------------------------------------------------------------------
-- 3. Audit lifecycle
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION iqsms_check_audit_transition()
RETURNS TRIGGER AS $$
DECLARE
  allowed "AuditStatus"[];
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.status
    WHEN 'PLANNED'     THEN ARRAY['IN_PROGRESS', 'CANCELLED']::"AuditStatus"[]
    WHEN 'IN_PROGRESS' THEN ARRAY['COMPLETED', 'CANCELLED']::"AuditStatus"[]
    WHEN 'COMPLETED'   THEN ARRAY[]::"AuditStatus"[]
    WHEN 'CANCELLED'   THEN ARRAY[]::"AuditStatus"[]
  END;

  IF NOT (NEW.status = ANY (allowed)) THEN
    RAISE EXCEPTION
      'IQSMS_TRANSITION: audit % cannot move % -> %. Allowed from %: %',
      OLD.id, OLD.status, NEW.status, OLD.status,
      COALESCE(NULLIF(array_to_string(allowed, ', '), ''), 'none (terminal state)');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_transition_guard ON audits;
CREATE TRIGGER audit_transition_guard
  BEFORE UPDATE ON audits
  FOR EACH ROW EXECUTE FUNCTION iqsms_check_audit_transition();


-- ---------------------------------------------------------------------------
-- 4. Audit-log immutability (proposal §9.4)
--
--    The API exposes no UPDATE or DELETE route for audit_log. This makes that
--    property structural rather than a promise about the routing table: even a
--    direct psql UPDATE is refused.
--
--    Note the honest limit. TRUNCATE does not fire row-level DELETE triggers,
--    and a table owner can drop the trigger outright. In production the
--    application role would additionally be denied those rights:
--
--      REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM iqsms_app;
--
--    The trigger stops accidental and casual tampering through the normal
--    connection; the grant is what stops a determined one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION iqsms_audit_log_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'IQSMS_IMMUTABLE: audit_log is append-only; % on row % was refused (proposal 9.4).',
    TG_OP, COALESCE(OLD.id, -1);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION iqsms_audit_log_is_append_only();


-- ---------------------------------------------------------------------------
-- 5. Polymorphic parent integrity for corrective actions
--
--    schema.prisma design note 2: Prisma has no native polymorphic relation,
--    so CorrectiveAction carries a `source` enum plus two nullable foreign
--    keys, with "exactly one FK set" enforced by a Zod refinement in the API.
--    A CHECK constraint makes a row that violates it unrepresentable rather
--    than merely rejected by one validator.
-- ---------------------------------------------------------------------------

ALTER TABLE corrective_actions
  DROP CONSTRAINT IF EXISTS corrective_actions_exactly_one_parent;

ALTER TABLE corrective_actions
  ADD CONSTRAINT corrective_actions_exactly_one_parent CHECK (
    (source = 'INCIDENT'       AND "incidentId" IS NOT NULL AND "auditResponseId" IS NULL)
    OR
    (source = 'AUDIT_RESPONSE' AND "auditResponseId" IS NOT NULL AND "incidentId" IS NULL)
  );


-- ---------------------------------------------------------------------------
-- 6. Consequence counts cannot be negative
--
--    Cheap, and it closes the gap where a direct SQL write could produce a
--    negative fatality count that the KPI aggregates would then happily sum.
-- ---------------------------------------------------------------------------

ALTER TABLE incidents
  DROP CONSTRAINT IF EXISTS incidents_non_negative_consequences;

ALTER TABLE incidents
  ADD CONSTRAINT incidents_non_negative_consequences CHECK (
    fatalities >= 0 AND injuries >= 0 AND "evacuationCount" >= 0
  );
