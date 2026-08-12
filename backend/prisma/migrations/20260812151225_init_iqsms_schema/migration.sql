-- CreateEnum
CREATE TYPE "Role" AS ENUM ('FIELD_REPORTER', 'QHSSE_AUDITOR', 'DEPARTMENT_LEAD', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('WELLHEAD', 'PROCESSING_FACILITY', 'PIPELINE_SECTION', 'DISTRIBUTION_NETWORK', 'OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('INCIDENT', 'NEAR_MISS');

-- CreateEnum
CREATE TYPE "CauseCategory" AS ENUM ('CORROSION_FAILURE', 'NATURAL_FORCE_DAMAGE', 'EXCAVATION_DAMAGE', 'OTHER_OUTSIDE_FORCE', 'PIPE_WELD_JOINT_FAILURE', 'EQUIPMENT_FAILURE', 'INCORRECT_OPERATION', 'OTHER_UNKNOWN');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_INVESTIGATION', 'CORRECTIVE_ACTION_PENDING', 'VERIFIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE', 'OBSERVATION');

-- CreateEnum
CREATE TYPE "CorrectiveActionSource" AS ENUM ('INCIDENT', 'AUDIT_RESPONSE');

-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'VERIFIED');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('PRIVATE_PROPERTY', 'PUBLIC_PROPERTY', 'UTILITY_ROW_EASEMENT', 'OPERATOR_CONTROLLED_PROPERTY');

-- CreateEnum
CREATE TYPE "SystemPart" AS ENUM ('MAIN', 'SERVICE', 'SERVICE_RISER', 'SERVICE_VALVE', 'MAIN_VALVE', 'OUTSIDE_METER_REGULATOR_SET', 'INSIDE_METER_REGULATOR_SET', 'DISTRICT_REGULATOR_METERING_STATION', 'FARM_TAP_METER_REGULATOR_SET', 'OTHER');

-- CreateEnum
CREATE TYPE "ReleaseType" AS ENUM ('LEAK', 'RUPTURE', 'MECHANICAL_PUNCTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentAreaType" AS ENUM ('UNDERGROUND', 'ABOVEGROUND', 'TRANSITION_AREA');

-- CreateEnum
CREATE TYPE "PipeMaterial" AS ENUM ('STEEL', 'PLASTIC', 'CAST_WROUGHT_IRON', 'DUCTILE_IRON', 'COPPER', 'UNKNOWN', 'OTHER');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'FIELD_REPORTER',
    "department" TEXT,
    "zoneId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "zoneType" "ZoneType" NOT NULL,
    "department" TEXT,
    "notes" TEXT,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" SERIAL NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL DEFAULT 'INCIDENT',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedById" INTEGER NOT NULL,
    "zoneId" INTEGER,
    "causeCategory" "CauseCategory",
    "causeDescription" TEXT,
    "systemPart" "SystemPart",
    "locationType" "LocationType",
    "linePressurePsig" DECIMAL(8,2),
    "pipeDiameterInches" DECIMAL(6,2),
    "ignitionOccurred" BOOLEAN,
    "explosionOccurred" BOOLEAN,
    "pipeMaterial" "PipeMaterial",
    "releaseType" "ReleaseType",
    "incidentAreaType" "IncidentAreaType",
    "yearInstalled" INTEGER,
    "severity" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "fatalities" INTEGER NOT NULL DEFAULT 0,
    "injuries" INTEGER NOT NULL DEFAULT 0,
    "propertyDamageCost" DECIMAL(12,2),
    "gasVolumeReleasedMcf" DECIMAL(10,2),
    "evacuationCount" INTEGER NOT NULL DEFAULT 0,
    "assetType" TEXT,
    "scadaPresent" BOOLEAN,
    "scadaOperational" BOOLEAN,
    "status" "IncidentStatus" NOT NULL DEFAULT 'DRAFT',
    "predictedRiskLevel" "RiskLevel",
    "predictedRiskScore" DECIMAL(5,4),
    "predictedByModel" TEXT,
    "predictedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "isoClause" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "itemText" TEXT NOT NULL,
    "category" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audits" (
    "id" SERIAL NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "templateId" INTEGER NOT NULL,
    "zoneId" INTEGER,
    "conductedById" INTEGER NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "conductedDate" TIMESTAMP(3),
    "status" "AuditStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_responses" (
    "id" SERIAL NOT NULL,
    "auditId" INTEGER NOT NULL,
    "checklistItemId" INTEGER NOT NULL,
    "complianceStatus" "ComplianceStatus" NOT NULL,
    "notes" TEXT,

    CONSTRAINT "audit_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_actions" (
    "id" SERIAL NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" "CorrectiveActionSource" NOT NULL,
    "incidentId" INTEGER,
    "auditResponseId" INTEGER,
    "assignedToId" INTEGER NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedDate" TIMESTAMP(3),
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'OPEN',
    "verifiedById" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "fileType" TEXT,
    "incidentId" INTEGER,
    "auditResponseId" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "previousState" TEXT,
    "newState" TEXT,
    "detail" JSONB,
    "ipAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_hours" (
    "id" SERIAL NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "personHours" DECIMAL(12,2) NOT NULL,
    "zoneId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "zones_name_key" ON "zones"("name");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_referenceNumber_key" ON "incidents"("referenceNumber");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_causeCategory_idx" ON "incidents"("causeCategory");

-- CreateIndex
CREATE INDEX "incidents_occurredAt_idx" ON "incidents"("occurredAt");

-- CreateIndex
CREATE INDEX "incidents_type_idx" ON "incidents"("type");

-- CreateIndex
CREATE INDEX "incidents_reportedById_idx" ON "incidents"("reportedById");

-- CreateIndex
CREATE INDEX "incidents_zoneId_idx" ON "incidents"("zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_name_key" ON "checklist_templates"("name");

-- CreateIndex
CREATE INDEX "checklist_items_templateId_idx" ON "checklist_items"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "audits_referenceNumber_key" ON "audits"("referenceNumber");

-- CreateIndex
CREATE INDEX "audits_status_idx" ON "audits"("status");

-- CreateIndex
CREATE INDEX "audits_zoneId_idx" ON "audits"("zoneId");

-- CreateIndex
CREATE INDEX "audits_conductedById_idx" ON "audits"("conductedById");

-- CreateIndex
CREATE UNIQUE INDEX "audit_responses_auditId_checklistItemId_key" ON "audit_responses"("auditId", "checklistItemId");

-- CreateIndex
CREATE UNIQUE INDEX "corrective_actions_referenceNumber_key" ON "corrective_actions"("referenceNumber");

-- CreateIndex
CREATE INDEX "corrective_actions_status_idx" ON "corrective_actions"("status");

-- CreateIndex
CREATE INDEX "corrective_actions_dueDate_idx" ON "corrective_actions"("dueDate");

-- CreateIndex
CREATE INDEX "corrective_actions_assignedToId_idx" ON "corrective_actions"("assignedToId");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_timestamp_idx" ON "audit_log"("timestamp");

-- CreateIndex
CREATE INDEX "audit_log_userId_idx" ON "audit_log"("userId");

-- CreateIndex
CREATE INDEX "operational_hours_periodStart_periodEnd_idx" ON "operational_hours"("periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "checklist_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_conductedById_fkey" FOREIGN KEY ("conductedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_responses" ADD CONSTRAINT "audit_responses_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_responses" ADD CONSTRAINT "audit_responses_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "checklist_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_auditResponseId_fkey" FOREIGN KEY ("auditResponseId") REFERENCES "audit_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_auditResponseId_fkey" FOREIGN KEY ("auditResponseId") REFERENCES "audit_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_hours" ADD CONSTRAINT "operational_hours_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
