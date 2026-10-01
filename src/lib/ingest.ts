// CSV/JSON ingestion: schema validation, normalization, provenance.
// Never executes file content; every record keeps its source reference.

import { normalizeTimestamp, parseCsv, parseJsonRecords, sha256Hex, shortHash } from './util';
import type {
  Alert,
  Asset,
  AssetCriticality,
  Case,
  CompletenessReport,
  Escalation,
  InvestigationAction,
  Severity,
  TelemetryRecord,
} from './types';

export const EXPECTED_CATEGORIES = ['assets', 'alerts', 'cases', 'actions', 'escalations', 'telemetry'] as const;
export type EvidenceCategory = (typeof EXPECTED_CATEGORIES)[number];

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB per file (prototype limit)
export const MAX_ROWS_PER_FILE = 200_000; // prototype limit

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export interface ParsedFile {
  filename: string;
  kind: EvidenceCategory;
  contentSha256: string;
  byteSize: number;
  records: Record<string, unknown>[];
  rowRefs: string[]; // parallel to records: "L12" or JSON pointer
  parseError: string | null;
  /** true when the file is not valid CSV/JSON at all (wholesale rejection). */
  unreadable: boolean;
}

export interface IngestIssue {
  rowRef: string;
  level: 'error' | 'warning';
  rule: string;
  message: string;
}

export interface KindResult {
  fileId: string;
  filename: string;
  kind: EvidenceCategory;
  sha256: string;
  byteSize: number;
  read: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  issues: IngestIssue[];
  assets: Asset[];
  alerts: Alert[];
  cases: Case[];
  actions: InvestigationAction[];
  escalations: Escalation[];
  telemetry: TelemetryRecord[];
  unreadable: boolean;
  parseError: string | null;
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());

function normSeverity(v: unknown): Severity | 'unknown' {
  const s = str(v).toLowerCase();
  return (SEVERITIES as string[]).includes(s) ? (s as Severity) : 'unknown';
}

function normBool(v: unknown): boolean | null {
  const s = str(v).toLowerCase();
  if (['true', '1', 'yes', 'y', 'required', 'expected'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'not_required', 'not required'].includes(s)) return false;
  return null; // unknown
}

function detectKind(filename: string, headersOrKeys: string[]): EvidenceCategory | null {
  const f = filename.toLowerCase();
  const nameMatch = (['assets', 'alerts', 'cases', 'actions', 'escalations', 'telemetry'] as const).find((k) =>
    f.includes(k)
  );
  if (nameMatch) return nameMatch;
  const has = (...keys: string[]) => keys.every((k) => headersOrKeys.includes(k));
  if (has('asset_id', 'criticality')) return 'assets';
  if (has('alert_id', 'opened_at')) return 'alerts';
  if (has('case_id', 'opened_at', 'status')) return 'cases';
  if (has('action_id', 'case_id')) return 'actions';
  if (has('escalation_id', 'case_id')) return 'escalations';
  if (has('telemetry_id') || has('last_seen_at', 'asset_id')) return 'telemetry';
  return null;
}

/** Parse one uploaded file into raw records without interpreting field values. */
export function parseFile(filename: string, text: string): ParsedFile {
  const byteSize = new TextEncoder().encode(text).length;
  const base = {
    filename,
    contentSha256: '', // filled async by caller via sha256Hex
    byteSize,
  };
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ...base, kind: 'alerts', records: [], rowRefs: [], parseError: 'File is empty.', unreadable: true };
  }
  try {
    if (filename.toLowerCase().endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const records = parseJsonRecords(text);
      return {
        ...base,
        kind: detectKind(filename, Object.keys(records[0] ?? {})) ?? 'alerts',
        records,
        rowRefs: records.map((_, i) => `/records/${i}`),
        parseError: null,
        unreadable: false,
      };
    }
    const { headers, rows } = parseCsv(text);
    const kind = detectKind(filename, headers);
    if (!kind) {
      return {
        ...base,
        kind: 'alerts',
        records: [],
        rowRefs: [],
        parseError: `Cannot determine evidence category from columns: ${headers.slice(0, 6).join(', ')}. Name the file after the category (e.g. alerts.csv) or include standard columns.`,
        unreadable: false,
      };
    }
    if (rows.length > MAX_ROWS_PER_FILE) {
      return {
        ...base,
        kind,
        records: [],
        rowRefs: [],
        parseError: `File has ${rows.length} rows, exceeding the prototype limit of ${MAX_ROWS_PER_FILE}.`,
        unreadable: false,
      };
    }
    const records = rows.map((r) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => (obj[h] = r[i] ?? ''));
      return obj;
    });
    return {
      ...base,
      kind,
      records,
      rowRefs: rows.map((_, i) => `L${i + 2}`), // +2: header line and 1-based rows
      parseError: null,
      unreadable: false,
    };
  } catch (e) {
    return { ...base, kind: 'alerts', records: [], rowRefs: [], parseError: (e as Error).message, unreadable: true };
  }
}

/** Validate + normalize records of one parsed file into typed records. */
export function normalizeParsedFile(
  parsed: ParsedFile,
  ctx: { entityId: string; submissionId: string; fileId: string; softwareVersion: string },
  seenIds: Map<string, string> // category:id -> fileId (cross-file duplicate detection)
): KindResult {
  const issues: IngestIssue[] = [];
  const result: KindResult = {
    fileId: ctx.fileId,
    filename: parsed.filename,
    kind: parsed.kind,
    sha256: parsed.contentSha256,
    byteSize: parsed.byteSize,
    read: parsed.records.length,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    issues,
    assets: [],
    alerts: [],
    cases: [],
    actions: [],
    escalations: [],
    telemetry: [],
    unreadable: parsed.unreadable,
    parseError: parsed.parseError,
  };

  if (parsed.parseError) {
    issues.push({
      rowRef: '-',
      level: 'error',
      rule: 'file_parse',
      message: parsed.parseError,
    });
  }
  if (parsed.unreadable || parsed.parseError) return result;

  const push = (rowRef: string, level: 'error' | 'warning', rule: string, message: string) =>
    issues.push({ rowRef, level, rule, message });

  const localSeen = new Set<string>();

  parsed.records.forEach((rec, i) => {
    const rowRef = parsed.rowRefs[i] ?? `#${i}`;
    const rawIdKey =
      parsed.kind === 'assets' ? 'asset_id' :
      parsed.kind === 'alerts' ? 'alert_id' :
      parsed.kind === 'cases' ? 'case_id' :
      parsed.kind === 'actions' ? 'action_id' :
      parsed.kind === 'escalations' ? 'escalation_id' : 'telemetry_id';
    const rawId = str(rec[rawIdKey]);
    if (!rawId) {
      result.rejected++;
      push(rowRef, 'error', 'missing_id', `Missing required field ${rawIdKey}.`);
      return;
    }
    // Duplicate detection within and across files of the same submission.
    const dupKey = `${ctx.submissionId}:${parsed.kind}:${rawId}`;
    if (localSeen.has(rawId) || seenIds.get(dupKey)) {
      result.duplicates++;
      push(rowRef, 'warning', 'duplicate_id', `Duplicate ${rawIdKey} "${rawId}" in this submission; record kept as flagged duplicate and excluded from analytics.`);
      return;
    }
    localSeen.add(rawId);
    seenIds.set(dupKey, ctx.fileId);

    const baseMeta = { sourceRecordId: rawId, fileId: ctx.fileId, rowRef };

    switch (parsed.kind) {
      case 'assets': {
        const criticalityRaw = str(rec.criticality).toLowerCase();
        const critList: readonly string[] = ['critical', 'high', 'medium', 'low'];
        const criticality = critList.includes(criticalityRaw)
          ? (criticalityRaw as AssetCriticality)
          : 'unknown';
        if (criticality === 'unknown' && str(rec.criticality))
          push(rowRef, 'warning', 'unknown_criticality', `Unrecognized criticality "${str(rec.criticality)}"; treated as unknown.`);
        result.assets.push({
          id: `AS:${ctx.submissionId}:${rawId}`,
          entityId: ctx.entityId,
          submissionId: ctx.submissionId,
          criticality,
          monitoringExpected: normBool(rec.monitoring_expected),
          assetType: str(rec.asset_type) || undefined,
          ...baseMeta,
        });
        break;
      }
      case 'alerts': {
        const openedAt = normalizeTimestamp(str(rec.opened_at));
        if (!openedAt) {
          result.rejected++;
          push(rowRef, 'error', 'invalid_timestamp', `Alert "${rawId}" has invalid opened_at "${str(rec.opened_at)}"; record rejected (never silently dropped).`);
          return;
        }
        const closedRaw = str(rec.closed_at);
        const closedAt = closedRaw ? normalizeTimestamp(closedRaw) : null;
        if (closedRaw && !closedAt) push(rowRef, 'warning', 'invalid_timestamp', `Alert "${rawId}" closed_at "${closedRaw}" is invalid; treated as not closed.`);
        if (closedAt && closedAt < openedAt) push(rowRef, 'error', 'impossible_ordering', `Alert "${rawId}" closes (${closedAt}) before it opens (${openedAt}).`);
        const severity = normSeverity(rec.severity);
        if (severity === 'unknown' && str(rec.severity)) push(rowRef, 'warning', 'unknown_severity', `Alert "${rawId}" has unrecognized severity "${str(rec.severity)}".`);
        const assetRef = str(rec.asset_id) || null;
        result.alerts.push({
          id: `AL:${ctx.submissionId}:${rawId}`,
          entityId: ctx.entityId,
          submissionId: ctx.submissionId,
          assetId: assetRef ? `AS:${ctx.submissionId}:${assetRef}` : null,
          severity,
          openedAt,
          closedAt,
          status: str(rec.status).toLowerCase() || 'unknown',
          disposition: str(rec.disposition).toLowerCase() || 'unknown',
          alertFamily: str(rec.alert_family) || undefined,
          ...baseMeta,
        });
        break;
      }
      case 'cases': {
        const openedAt = normalizeTimestamp(str(rec.opened_at));
        if (!openedAt) {
          result.rejected++;
          push(rowRef, 'error', 'invalid_timestamp', `Case "${rawId}" has invalid opened_at "${str(rec.opened_at)}"; record rejected.`);
          return;
        }
        const closedRaw = str(rec.closed_at);
        const closedAt = closedRaw ? normalizeTimestamp(closedRaw) : null;
        if (closedRaw && !closedAt) push(rowRef, 'warning', 'invalid_timestamp', `Case "${rawId}" closed_at "${closedRaw}" is invalid; treated as not closed.`);
        if (closedAt && closedAt < openedAt) push(rowRef, 'error', 'impossible_ordering', `Case "${rawId}" closes (${closedAt}) before it opens (${openedAt}).`);
        const linkedRaw = str(rec.linked_alert_ids);
        const linkedAlertIds = linkedRaw
          ? linkedRaw.split(/[|;]/).map((s) => s.trim()).filter(Boolean).map((id) => `AL:${ctx.submissionId}:${id}`)
          : [];
        const automatedRaw = str(rec.automated).toLowerCase();
        result.cases.push({
          id: `CS:${ctx.submissionId}:${rawId}`,
          entityId: ctx.entityId,
          submissionId: ctx.submissionId,
          severity: normSeverity(rec.severity),
          status: str(rec.status).toLowerCase() || 'unknown',
          openedAt,
          closedAt,
          linkedAlertIds,
          category: str(rec.category).toLowerCase() || undefined,
          automated: automatedRaw ? automatedRaw === 'true' || automatedRaw === '1' || automatedRaw === 'yes' : false,
          ...baseMeta,
        });
        break;
      }
      case 'actions': {
        const actionAt = normalizeTimestamp(str(rec.action_at));
        if (!actionAt) {
          result.rejected++;
          push(rowRef, 'error', 'invalid_timestamp', `Action "${rawId}" has invalid action_at "${str(rec.action_at)}"; record rejected.`);
          return;
        }
        result.actions.push({
          id: `AC:${ctx.submissionId}:${rawId}`,
          entityId: ctx.entityId,
          submissionId: ctx.submissionId,
          caseId: `CS:${ctx.submissionId}:${str(rec.case_id)}`,
          actionType: str(rec.action_type).toLowerCase() || 'unspecified',
          actionAt,
          actionDescription: str(rec.action_description) || undefined,
          investigatorReference: str(rec.investigator) || str(rec.investigator_reference) || 'unattributed',
          ...baseMeta,
        });
        break;
      }
      case 'escalations': {
        const escalatedAt = normalizeTimestamp(str(rec.escalated_at));
        if (!escalatedAt) {
          result.rejected++;
          push(rowRef, 'error', 'invalid_timestamp', `Escalation "${rawId}" has invalid escalated_at "${str(rec.escalated_at)}"; record rejected.`);
          return;
        }
        result.escalations.push({
          id: `ES:${ctx.submissionId}:${rawId}`,
          entityId: ctx.entityId,
          submissionId: ctx.submissionId,
          caseId: `CS:${ctx.submissionId}:${str(rec.case_id)}`,
          destination: str(rec.destination).toLowerCase() || undefined,
          escalatedAt,
          status: str(rec.status).toLowerCase() || 'unknown',
          ...baseMeta,
        });
        break;
      }
      case 'telemetry': {
        const lastSeenAt = normalizeTimestamp(str(rec.last_seen_at));
        if (!lastSeenAt) {
          result.rejected++;
          push(rowRef, 'error', 'invalid_timestamp', `Telemetry record "${rawId}" has invalid last_seen_at "${str(rec.last_seen_at)}"; record rejected.`);
          return;
        }
        const assetRef = str(rec.asset_id) || null;
        result.telemetry.push({
          id: `TL:${ctx.submissionId}:${rawId}`,
          entityId: ctx.entityId,
          submissionId: ctx.submissionId,
          assetId: assetRef ? `AS:${ctx.submissionId}:${assetRef}` : null,
          lastSeenAt,
          ...baseMeta,
        });
        break;
      }
    }
    result.accepted++;
  });

  return result;
}

/** Completeness report: distinguishes a genuinely missing category from bad rows. */
export function buildCompleteness(results: KindResult[]): CompletenessReport {
  const presentCategories: string[] = [];
  const missingCategories: string[] = [];
  const acceptRate: Record<string, number> = {};
  const notes: string[] = [];

  for (const cat of EXPECTED_CATEGORIES) {
    const files = results.filter((r) => r.kind === cat);
    const accepted = files.reduce((n, r) => n + r.accepted, 0);
    if (accepted > 0) {
      presentCategories.push(cat);
      const read = files.reduce((n, r) => n + r.read, 0);
      acceptRate[cat] = read > 0 ? accepted / read : 1;
      if (acceptRate[cat] < 0.95) notes.push(`${cat}: only ${Math.round(acceptRate[cat] * 100)}% of records passed validation.`);
    } else {
      missingCategories.push(cat);
    }
  }
  const score = presentCategories.length / EXPECTED_CATEGORIES.length;
  if (missingCategories.length > 0) {
    notes.push(`Missing evidence categories: ${missingCategories.join(', ')}. Absence findings are suppressed for these categories because the submission itself is incomplete there.`);
  }
  return { expectedCategories: [...EXPECTED_CATEGORIES], presentCategories, missingCategories, acceptRate, score, notes };
}

export async function hashText(text: string): Promise<string> {
  return sha256Hex(text);
}

export function makeFileId(submissionId: string, filename: string): string {
  return `F:${submissionId}:${shortHash(filename)}`;
}
