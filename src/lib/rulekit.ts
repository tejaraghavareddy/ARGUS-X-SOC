// Shared rule-engine kit: context, finding drafts, evidence, priority math.

import { SEVERITY_ORDER } from './types';
import type {
  Alert,
  AnalyticsConfig,
  Asset,
  AssetCriticality,
  Case,
  CompletenessReport,
  Escalation,
  EvidenceRole,
  EvidenceStrength,
  InvestigationAction,
  Severity,
  SourceFile,
  TelemetryRecord,
} from './types';
import { clamp } from './util';

export interface RuleContext {
  entityId: string;
  submissionId: string;
  periodStart: string;
  periodEnd: string;
  completeness: CompletenessReport;
  assets: Asset[];
  alerts: Alert[];
  cases: Case[];
  actions: InvestigationAction[];
  escalations: Escalation[];
  telemetry: TelemetryRecord[];
  files: SourceFile[];
  config: AnalyticsConfig;
  /** Cross-submission baselines for statistical rules (R7). Never includes the
   * current submission's own count. */
  baseline?: {
    historicalAlertCounts: number[]; // prior periods, same entity
    peerAlertCounts: { entityId: string; count: number }[]; // same period, peer group
  };
}

export interface EvidenceDraft {
  sourceRecordType: string; // case | alert | asset | action | escalation | telemetry | import_batch
  sourceRecordId: string;
  sourceFileId?: string | null;
  sourceRowRef?: string | null;
  evidenceRole?: EvidenceRole;
  note?: string;
}

export interface FindingDraft {
  category: 'execution_gap' | 'negative_space' | 'unusual_pattern' | 'data_quality' | 'statistical_anomaly';
  ruleId: string;
  ruleVersion: string;
  ruleTitle: string;
  severity: Severity;
  evidenceStrength: EvidenceStrength;
  explanation: string;
  suggestedQuestions: string[];
  limitations: string;
  observed: { label: string; value: string }[];
  params: Record<string, string | number | boolean | null>;
  evidence: EvidenceDraft[];
  priorityInputs: {
    S: Severity;
    E: EvidenceStrength;
    C: AssetCriticality | null; // null => unknown / not applicable
    R: number; // recurrence multiplier (1 = single occurrence)
  };
}

const SEVERITY_SCORE: Record<Severity, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
  info: 10,
};

const EVIDENCE_SCORE: Record<EvidenceStrength, number> = {
  strong: 85,
  moderate: 65,
  weak: 40,
  indicative: 25,
};

const CRITICALITY_SCORE: Record<AssetCriticality, number> = {
  critical: 100,
  high: 70,
  medium: 40,
  low: 15,
};

export interface PriorityResult {
  score: number | null;
  label: 'high' | 'medium' | 'low' | 'unknown';
  components: {
    key: 'S' | 'E' | 'C' | 'R';
    label: string;
    raw: number | null;
    weight: number;
    used: boolean;
    note: string;
  }[];
}

/**
 * Transparent review-priority indicator:
 *   P = wS*S + wE*E + wC*C + wR*R  (illustrative prototype weights)
 * Unknown components are excluded and their weight is redistributed over the
 * known components; the effect is documented on the finding.
 * This is a review-prioritization aid, NOT a confirmed risk score.
 */
export function computePriority(
  inputs: FindingDraft['priorityInputs'],
  weights: AnalyticsConfig['priorityWeights'],
  recurrenceThreshold: number
): PriorityResult {
  const recurrenceScore = clamp((inputs.R / Math.max(1, recurrenceThreshold)) * 100, 0, 100);
  const raw: { key: 'S' | 'E' | 'C' | 'R'; label: string; value: number | null; weight: number; note: string }[] = [
    { key: 'S', label: 'Potential issue severity', value: SEVERITY_SCORE[inputs.S], weight: weights.S, note: `Rule-assessed severity: ${inputs.S}.` },
    { key: 'E', label: 'Evidence strength', value: EVIDENCE_SCORE[inputs.E], weight: weights.E, note: `Evidence classified as ${inputs.E}; see evidence links for verification.` },
    {
      key: 'C',
      label: 'Asset/process criticality',
      value: inputs.C ? CRITICALITY_SCORE[inputs.C] : null,
      weight: weights.C,
      note: inputs.C ? `Affected asset criticality: ${inputs.C}.` : 'No asset criticality applies; component excluded and weight redistributed.',
    },
    {
      key: 'R',
      label: 'Recurrence / persistence',
      value: recurrenceScore,
      weight: weights.R,
      note: `Recurrence multiplier ${inputs.R.toFixed(1)} against threshold ${recurrenceThreshold}.`,
    },
  ];

  const known = raw.filter((c) => c.value !== null);
  const totalKnownWeight = known.reduce((n, c) => n + c.weight, 0);
  if (known.length === 0 || totalKnownWeight <= 0) {
    return {
      score: null,
      label: 'unknown',
      components: raw.map((c) => ({ ...c, raw: c.value, used: false })),
    };
  }
  let score = 0;
  for (const c of known) {
    score += (c.weight / totalKnownWeight) * (c.value as number);
  }
  const missing = raw.filter((c) => c.value === null);
  const missingNote =
    missing.length > 0
      ? ` ${missing.length} component(s) unknown, weight redistributed: ${missing.map((m) => m.key).join(', ')}.`
      : '';
  return {
    score: Math.round(clamp(score, 0, 100)),
    label: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low',
    components: raw.map((c) => ({
      key: c.key,
      label: c.label,
      raw: c.value,
      weight: c.weight,
      used: c.value !== null,
      note: c.note + missingNote,
    })),
  };
}

export function severityToScore(s: Severity): number {
  return SEVERITY_ORDER[s];
}

export function fileFor(ctx: RuleContext, fileId: string | null | undefined): SourceFile | undefined {
  return ctx.files.find((f) => f.id === fileId);
}

/** Helper: actions grouped per case. */
export function groupActionsByCase(actions: InvestigationAction[]): Map<string, InvestigationAction[]> {
  const map = new Map<string, InvestigationAction[]>();
  for (const a of actions) {
    const list = map.get(a.caseId) ?? [];
    list.push(a);
    map.set(a.caseId, list);
  }
  return map;
}

export function fmtHours(h: number): string {
  return h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`;
}
