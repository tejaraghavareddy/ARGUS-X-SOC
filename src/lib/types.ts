// ARGUS SAT core domain types.

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export type FindingStatus =
  | 'new'
  | 'in_review'
  | 'confirmed'
  | 'dismissed'
  | 'needs_more_evidence'
  | 'unresolved';

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  new: 'New',
  in_review: 'In review',
  confirmed: 'Confirmed',
  dismissed: 'Dismissed',
  needs_more_evidence: 'Needs more evidence',
  unresolved: 'Unresolved',
};

/** A reviewed organization whose SOC evidence is assessed. */
export interface Entity {
  id: string; // stable entity_id
  name: string;
  sector?: string;
  peerGroup?: string;
  createdAt: string;
}

/** An imported data submission for one entity + reporting period. */
export interface Submission {
  id: string;
  entityId: string;
  periodStart: string; // ISO date
  periodEnd: string;
  label: string;
  createdAt: string;
  /** sha-256 of each original file content. */
  fileHashes: string[];
  notes?: string;
}

/** One uploaded file, retained for provenance. */
export interface SourceFile {
  id: string;
  submissionId: string;
  filename: string;
  kind: string; // asset | alert | case | action | escalation
  sha256: string;
  byteSize: number;
  recordCount: number;
  acceptedCount: number;
  rejectedCount: number;
  importedAt: string;
  softwareVersion: string;
}

export interface ValidationIssue {
  fileId: string;
  filename: string;
  rowRef: string; // row number or JSON pointer
  level: 'error' | 'warning';
  rule: string;
  message: string;
}

/** Import batch = files + validation issues + completeness for one submission. */
export interface ImportBatch {
  id: string;
  submissionId: string;
  createdAt: string;
  issues: ValidationIssue[];
  totals: {
    read: number;
    accepted: number;
    rejected: number;
    duplicates: number;
  };
  completeness: CompletenessReport;
}

export interface CompletenessReport {
  /** Expected evidence categories for a full submission. */
  expectedCategories: string[];
  /** Categories actually present and accepted in this submission. */
  presentCategories: string[];
  /** Categories missing entirely (or rejected wholesale). */
  missingCategories: string[];
  /** Fraction of records accepted per present category, 0..1. */
  acceptRate: Record<string, number>;
  /** Overall 0..1 estimate of submission completeness. */
  score: number;
  notes: string[];
}

export type AssetCriticality = 'critical' | 'high' | 'medium' | 'low';

export interface Asset {
  id: string;
  entityId: string;
  submissionId: string;
  criticality: AssetCriticality | 'unknown';
  monitoringExpected: boolean | null; // null = unknown
  assetType?: string;
  sourceRecordId: string;
  fileId: string;
  rowRef: string;
}

export interface Alert {
  id: string;
  entityId: string;
  submissionId: string;
  assetId: string | null;
  severity: Severity | 'unknown';
  openedAt: string | null;
  closedAt: string | null;
  status: string;
  disposition: string;
  sourceRecordId: string;
  fileId: string;
  rowRef: string;
  alertFamily?: string;
}

export interface Case {
  id: string;
  entityId: string;
  submissionId: string;
  severity: Severity | 'unknown';
  status: string;
  openedAt: string | null;
  closedAt: string | null;
  linkedAlertIds: string[];
  category?: string;
  automated?: boolean;
  sourceRecordId: string;
  fileId: string;
  rowRef: string;
}

export interface InvestigationAction {
  id: string;
  entityId: string;
  submissionId: string;
  caseId: string;
  actionType: string;
  actionAt: string | null;
  actionDescription?: string;
  investigatorReference: string; // pseudonymous
  sourceRecordId: string;
  fileId: string;
  rowRef: string;
}

export interface Escalation {
  id: string;
  entityId: string;
  submissionId: string;
  caseId: string;
  destination?: string;
  escalatedAt: string | null;
  status: string;
  sourceRecordId: string;
  fileId: string;
  rowRef: string;
}

/** Minimal telemetry evidence record (for monitoring coverage checks). */
export interface TelemetryRecord {
  id: string;
  entityId: string;
  submissionId: string;
  assetId: string | null;
  lastSeenAt: string | null;
  sourceRecordId: string;
  fileId: string;
  rowRef: string;
}

export type FindingCategory =
  | 'execution_gap'
  | 'negative_space'
  | 'unusual_pattern'
  | 'data_quality'
  | 'statistical_anomaly';

export const FINDING_CATEGORY_LABELS: Record<FindingCategory, string> = {
  execution_gap: 'Execution gap',
  negative_space: 'Negative space',
  unusual_pattern: 'Unusual pattern',
  data_quality: 'Data quality',
  statistical_anomaly: 'Statistical anomaly',
};

export type EvidenceStrength = 'strong' | 'moderate' | 'weak' | 'indicative';

export const EVIDENCE_STRENGTH_LABELS: Record<EvidenceStrength, string> = {
  strong: 'Strong - directly verifiable in submitted records',
  moderate: 'Moderate - consistent records, some assumptions',
  weak: 'Weak - based on partial or low-volume data',
  indicative: 'Indicative - signal only, verify before concluding',
};

export interface PriorityComponent {
  key: 'S' | 'E' | 'C' | 'R';
  label: string;
  raw: number | null; // 0..100 or null when unknown
  weight?: number;
  used: boolean;
  note: string;
}

export interface Finding {
  id: string;
  entityId: string;
  submissionId: string | null;
  periodStart: string;
  periodEnd: string;
  category: FindingCategory;
  ruleId: string;
  ruleVersion: string;
  ruleTitle: string;
  severity: Severity;
  priorityScore: number | null; // 0..100, null when insufficient inputs
  priorityLabel: string; // 'high' | 'medium' | 'low' | 'unknown'
  priorityComponents: PriorityComponent[];
  evidenceStrength: EvidenceStrength;
  explanation: string;
  suggestedQuestions: string[];
  limitations: string;
  status: FindingStatus;
  createdAt: string;
  analyticsRunId: string;
  params: Record<string, string | number | boolean | null>;
  /** Keyed values shown in the detail view. */
  observed: { label: string; value: string }[];
}

export type EvidenceRole = 'supporting' | 'contradicting' | 'contextual';

export interface FindingEvidence {
  id: string;
  findingId: string;
  sourceRecordType: string; // case | alert | asset | action | escalation | import_batch | telemetry
  sourceRecordId: string;
  sourceFileId: string | null;
  sourceRowRef: string | null;
  evidenceRole: EvidenceRole;
  note?: string;
}

export interface ReviewDecision {
  id: string;
  findingId: string;
  previousStatus: FindingStatus | null;
  newStatus: FindingStatus;
  reviewer: string;
  notes: string;
  at: string;
}

export type AuditEventType =
  | 'import'
  | 'normalization'
  | 'analytics_run'
  | 'finding_status_change'
  | 'reviewer_note'
  | 'report_export'
  | 'dataset_generated'
  | 'workspace_reset';

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  eventType: AuditEventType;
  targetType: string;
  targetId: string;
  previousStatus?: string;
  newStatus?: string;
  details: string;
  submissionId?: string;
}

export interface AnalyticsRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  softwareVersion: string;
  configHash: string;
  config: AnalyticsConfig;
  recordCounts: {
    assets: number;
    alerts: number;
    cases: number;
    actions: number;
    escalations: number;
    telemetry: number;
  };
  findingsCreated: number;
  notes: string[];
}

export interface AnalyticsConfig {
  rules: Record<
    string,
    { enabled: boolean; version: string; params: Record<string, number | boolean | string> }
  >;
  priorityWeights: { S: number; E: number; C: number; R: number };
}

export const SOFTWARE_VERSION = '0.1.0';

export function defaultAnalyticsConfig(): AnalyticsConfig {
  return {
    priorityWeights: { S: 0.4, E: 0.3, C: 0.2, R: 0.1 },
    rules: {
      R1: {
        enabled: true,
        version: '1.0.0',
        params: { fastClosureHours: 24, minActionsForEvidence: 2 },
      },
      R2: {
        enabled: true,
        version: '1.0.0',
        params: { requireEscalationForSeverities: 'critical,high' },
      },
      R3: {
        enabled: true,
        version: '1.0.0',
        params: { minActionsForEvidence: 1 },
      },
      R4: {
        enabled: true,
        version: '1.0.0',
        params: { recurrenceThreshold: 5, windowHours: 720 },
      },
      R5: {
        enabled: true,
        version: '1.0.0',
        params: { minInventoryCoverage: 0.8 },
      },
      R6: {
        enabled: true,
        version: '1.0.0',
        params: { similarityThreshold: 0.8, minCases: 4 },
      },
      R7: {
        enabled: true,
        version: '1.0.0',
        params: { lowFactor: 0.5, minPeerRecords: 10 },
      },
      R8: {
        enabled: true,
        version: '1.0.0',
        params: {},
      },
    },
  };
}
