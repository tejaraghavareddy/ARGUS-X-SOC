// Local-first persistence on IndexedDB via Dexie. No server, no cloud.
// Append-only patterns: review decisions and audit events are never updated or
// deleted, only inserted; findings keep a status pointer plus full history.

import Dexie, { type Table } from 'dexie';
import { SOFTWARE_VERSION } from './types';
import type {
  Alert,
  AnalyticsRun,
  Asset,
  AuditEvent,
  Case,
  Entity,
  Escalation,
  Finding,
  FindingEvidence,
  ImportBatch,
  InvestigationAction,
  ReviewDecision,
  SourceFile,
  Submission,
  TelemetryRecord,
} from './types';

export class ArgusDb extends Dexie {
  entities!: Table<Entity, string>;
  submissions!: Table<Submission, string>;
  files!: Table<SourceFile, string>;
  importBatches!: Table<ImportBatch, string>;
  assets!: Table<Asset, string>;
  alerts!: Table<Alert, string>;
  cases!: Table<Case, string>;
  actions!: Table<InvestigationAction, string>;
  escalations!: Table<Escalation, string>;
  telemetry!: Table<TelemetryRecord, string>;
  findings!: Table<Finding, string>;
  findingEvidence!: Table<FindingEvidence, string>;
  reviewDecisions!: Table<ReviewDecision, string>;
  auditEvents!: Table<AuditEvent, string>;
  analyticsRuns!: Table<AnalyticsRun, string>;

  constructor() {
    super('argus-sat');
    this.version(1).stores({
      entities: 'id, name, peerGroup',
      submissions: 'id, entityId, createdAt, periodStart',
      files: 'id, submissionId, kind',
      importBatches: 'id, submissionId, createdAt',
      assets: 'id, entityId, submissionId',
      alerts: 'id, entityId, submissionId, assetId, openedAt',
      cases: 'id, entityId, submissionId, severity, status',
      actions: 'id, entityId, submissionId, caseId',
      escalations: 'id, entityId, submissionId, caseId',
      telemetry: 'id, entityId, submissionId, assetId',
      findings: 'id, entityId, submissionId, analyticsRunId, status, ruleId, category',
      findingEvidence: 'id, findingId, sourceRecordId',
      reviewDecisions: 'id, findingId, at',
      auditEvents: 'id, at, eventType, targetType, targetId, submissionId',
      analyticsRuns: 'id, startedAt',
    });
  }
}

export const db = new ArgusDb();

export async function recordAudit(
  ev: Omit<AuditEvent, 'id' | 'at'> & { at?: string }
): Promise<void> {
  const event: AuditEvent = {
    id: `AE_${crypto.randomUUID()}`,
    at: ev.at ?? new Date().toISOString(),
    ...ev,
  } as AuditEvent;
  await db.auditEvents.add(event);
}

export async function resetWorkspace(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.entities, db.submissions, db.files, db.importBatches, db.assets,
      db.alerts, db.cases, db.actions, db.escalations, db.telemetry,
      db.findings, db.findingEvidence, db.reviewDecisions, db.auditEvents,
      db.analyticsRuns,
    ],
    async () => {
      await Promise.all([
        db.entities.clear(), db.submissions.clear(), db.files.clear(),
        db.importBatches.clear(), db.assets.clear(), db.alerts.clear(),
        db.cases.clear(), db.actions.clear(), db.escalations.clear(),
        db.telemetry.clear(), db.findings.clear(), db.findingEvidence.clear(),
        db.reviewDecisions.clear(), db.auditEvents.clear(), db.analyticsRuns.clear(),
      ]);
    }
  );
}

export async function exportAuditCsv(): Promise<string> {
  const { toCsv } = await import('./util');
  const events = await db.auditEvents.orderBy('at').toArray();
  return toCsv(
    ['event_id', 'timestamp', 'actor', 'event_type', 'target_type', 'target_id', 'previous_status', 'new_status', 'details'],
    events.map((e) => [e.id, e.at, e.actor, e.eventType, e.targetType, e.targetId, e.previousStatus ?? '', e.newStatus ?? '', e.details])
  );
}

export const APP_VERSION = SOFTWARE_VERSION;
