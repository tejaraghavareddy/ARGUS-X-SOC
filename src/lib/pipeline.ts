// Import pipeline + analytics orchestrator: ties ingestion, persistence,
// rules, prioritization, and audit together into reproducible runs.

import { db, recordAudit } from './db';
import { buildCompleteness, hashText, makeFileId, normalizeParsedFile, parseFile, MAX_FILE_BYTES } from './ingest';
import { ALL_RULES, displayId } from './rules';
import { computePriority, type FindingDraft, type RuleContext } from './rulekit';
import { SOFTWARE_VERSION } from './types';
import type {
  Alert,
  AnalyticsConfig,
  AnalyticsRun,
  Asset,
  Case,
  Entity,
  Escalation,
  Finding,
  InvestigationAction,
  SourceFile,
  Submission,
  TelemetryRecord,
} from './types';
import { makeId, shortHash } from './util';

export interface UploadInput {
  filename: string;
  text: string;
}

export interface ImportOutcome {
  submissionId: string;
  importBatchId: string;
  totals: { read: number; accepted: number; rejected: number; duplicates: number };
  fileSummaries: {
    filename: string;
    kind: string;
    read: number;
    accepted: number;
    rejected: number;
    duplicates: number;
    sha256: string;
    issues: { rowRef: string; level: string; rule: string; message: string }[];
    parseError: string | null;
  }[];
  completeness: ReturnType<typeof buildCompleteness>;
}

/** Import a set of files as one submission for an entity + reporting period. */
export async function importSubmission(
  input: { entityId: string; entityName: string; periodStart: string; periodEnd: string; label: string; notes?: string },
  uploads: UploadInput[],
  actor: string
): Promise<ImportOutcome> {
  if (uploads.length === 0) throw new Error('No files provided.');
  if (!input.periodStart || !input.periodEnd) throw new Error('Reporting period start and end are required.');
  if (input.periodEnd < input.periodStart) throw new Error('Reporting period end must not precede its start.');

  // Idempotency: detect an identical submission (same entity, period, label).
  const existing = await db.submissions
    .where('entityId')
    .equals(input.entityId)
    .filter((s) => s.periodStart === input.periodStart && s.periodEnd === input.periodEnd)
    .toArray();
  if (existing.some((s) => s.label === input.label)) {
    throw new Error(`A submission labeled "${input.label}" for this entity and period already exists. Re-importing the same data creates duplicates; choose a new label or review the existing submission.`);
  }

  // Entity must exist (created via Import page or demo loader).
  const entity = await db.entities.get(input.entityId);
  if (!entity) throw new Error(`Unknown entity "${input.entityId}".`);

  const submissionId = makeId('SUB');
  const seenIds = new Map<string, string>();
  const fileResults: ReturnType<typeof normalizeParsedFile>[] = [];

  for (const upload of uploads) {
    if (new TextEncoder().encode(upload.text).length > MAX_FILE_BYTES) {
      throw new Error(`File ${upload.filename} exceeds the configured size limit (${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).`);
    }
    const parsed = parseFile(upload.filename, upload.text);
    parsed.contentSha256 = await hashText(upload.text);
    const fileId = makeFileId(submissionId, upload.filename);
    const result = normalizeParsedFile(parsed, {
      entityId: input.entityId,
      submissionId,
      fileId,
      softwareVersion: SOFTWARE_VERSION,
    }, seenIds);
    fileResults.push(result);
  }

  const completeness = buildCompleteness(fileResults);
  const totals = fileResults.reduce(
    (acc, r) => ({
      read: acc.read + r.read,
      accepted: acc.accepted + r.accepted,
      rejected: acc.rejected + r.rejected,
      duplicates: acc.duplicates + r.duplicates,
    }),
    { read: 0, accepted: 0, rejected: 0, duplicates: 0 }
  );

  const submission: Submission = {
    id: submissionId,
    entityId: input.entityId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    label: input.label,
    createdAt: new Date().toISOString(),
    fileHashes: fileResults.map((r) => r.sha256),
    notes: input.notes,
  };
  const files: SourceFile[] = fileResults.map((r) => ({
    id: r.fileId,
    submissionId,
    filename: r.filename,
    kind: r.kind,
    sha256: r.sha256,
    byteSize: r.byteSize,
    recordCount: r.read,
    acceptedCount: r.accepted,
    rejectedCount: r.rejected,
    importedAt: new Date().toISOString(),
    softwareVersion: SOFTWARE_VERSION,
  }));

  const issues = fileResults.flatMap((r) =>
    r.issues.map((i) => ({
      fileId: r.fileId,
      filename: r.filename,
      rowRef: i.rowRef,
      level: i.level as 'error' | 'warning',
      rule: i.rule,
      message: i.message,
    }))
  );

  const importBatch: ImportBatchLike = {
    id: makeId('IB'),
    submissionId,
    createdAt: new Date().toISOString(),
    issues,
    totals,
    completeness,
  };

  // Persist everything in one transaction.
  await db.transaction(
    'rw',
    [db.submissions, db.files, db.importBatches, db.assets, db.alerts, db.cases, db.actions, db.escalations, db.telemetry, db.auditEvents],
    async () => {
      await db.submissions.add(submission);
      await db.files.bulkAdd(files);
      await db.importBatches.add(importBatch);
      await db.assets.bulkPut(fileResults.flatMap((r) => r.assets));
      await db.alerts.bulkPut(fileResults.flatMap((r) => r.alerts));
      await db.cases.bulkPut(fileResults.flatMap((r) => r.cases));
      await db.actions.bulkPut(fileResults.flatMap((r) => r.actions));
      await db.escalations.bulkPut(fileResults.flatMap((r) => r.escalations));
      await db.telemetry.bulkPut(fileResults.flatMap((r) => r.telemetry));
      await recordAudit({
        actor,
        eventType: 'import',
        targetType: 'submission',
        targetId: submissionId,
        details: `Imported ${uploads.length} file(s) for ${entity.name} (${input.periodStart}..${input.periodEnd}); ` +
          `${totals.accepted} accepted, ${totals.rejected} rejected, ${totals.duplicates} duplicate(s); completeness ${(completeness.score * 100).toFixed(0)}%.`,
        submissionId,
      });
      await recordAudit({
        actor,
        eventType: 'normalization',
        targetType: 'submission',
        targetId: submissionId,
        details: `Normalized records into the common evidence schema; source IDs, file references, and SHA-256 hashes preserved.`,
        submissionId,
      });
    }
  );

  return {
    submissionId,
    importBatchId: importBatch.id,
    totals,
    fileSummaries: fileResults.map((r) => ({
      filename: r.filename,
      kind: r.kind,
      read: r.read,
      accepted: r.accepted,
      rejected: r.rejected,
      duplicates: r.duplicates,
      sha256: r.sha256,
      issues: r.issues.map((i) => ({ rowRef: i.rowRef, level: i.level, rule: i.rule, message: i.message })),
      parseError: r.parseError,
    })),
    completeness,
  };
}

type ImportBatchLike = import('./types').ImportBatch;

export interface RunOutcome {
  runId: string;
  findingsCreated: number;
  byRule: Record<string, number>;
  durationMs: number;
  notes: string[];
}

/** Run all enabled rules over all submissions; produces reproducible findings. */
export async function runAnalytics(config: AnalyticsConfig, actor: string): Promise<RunOutcome> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const notes: string[] = [];

  const [entities, submissions, files, batches, assets, alerts, cases, actions, escalations, telemetry] = await Promise.all([
    db.entities.toArray(),
    db.submissions.toArray(),
    db.files.toArray(),
    db.importBatches.toArray(),
    db.assets.toArray(),
    db.alerts.toArray(),
    db.cases.toArray(),
    db.actions.toArray(),
    db.escalations.toArray(),
    db.telemetry.toArray(),
  ]);

  if (submissions.length === 0) throw new Error('No submissions to analyze. Import data first.');

  const configJson = JSON.stringify(config);
  const configHash = await hashText(configJson);

  const runId = makeId('RUN');
  const drafts: { draft: FindingDraft; sub: Submission }[] = [];

  for (const sub of submissions) {
    const batch = batches.find((b) => b.submissionId === sub.id);
    const subAssets = assets.filter((x) => x.submissionId === sub.id);
    const subAlerts = alerts.filter((x) => x.submissionId === sub.id);
    const subCases = cases.filter((x) => x.submissionId === sub.id);
    const subActions = actions.filter((x) => x.submissionId === sub.id);
    const subEscalations = escalations.filter((x) => x.submissionId === sub.id);
    const subTelemetry = telemetry.filter((x) => x.submissionId === sub.id);
    const subFiles = files.filter((f) => f.submissionId === sub.id);

    // R7 baselines: historical periods of the same entity + peers in the same period.
    const historical = submissions
      .filter((s) => s.entityId === sub.entityId && s.id !== sub.id && s.periodEnd < sub.periodEnd)
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
      .map((s) => alerts.filter((a) => a.submissionId === s.id).length);
    const entity = entities.find((e) => e.id === sub.entityId);
    const peerAlertCounts = submissions
      .filter((s) => s.id !== sub.id && s.periodStart === sub.periodStart && s.periodEnd === sub.periodEnd)
      .filter((s) => entity && entities.find((e) => e.id === s.entityId)?.peerGroup === entity.peerGroup)
      .map((s) => ({ entityId: s.entityId, count: alerts.filter((a) => a.submissionId === s.id).length }));

    const ctx: RuleContext = {
      entityId: sub.entityId,
      submissionId: sub.id,
      periodStart: sub.periodStart,
      periodEnd: sub.periodEnd,
      completeness: batch?.completeness ?? {
        expectedCategories: [], presentCategories: [], missingCategories: [], acceptRate: {}, score: 1,
        notes: ['No import batch found; completeness unknown.'],
      },
      assets: subAssets,
      alerts: subAlerts,
      cases: subCases,
      actions: subActions,
      escalations: subEscalations,
      telemetry: subTelemetry,
      files: subFiles,
      config,
      baseline: { historicalAlertCounts: historical, peerAlertCounts },
    };

    for (const rule of ALL_RULES) {
      const cfg = config.rules[rule.id];
      if (cfg && cfg.enabled === false) continue;
      if (rule.requires.length > 0) {
        const missing = rule.requires.filter((c) => !ctx.completeness.presentCategories.includes(c));
        if (missing.length > 0) continue;
      }
      try {
        for (const draft of rule.run(ctx)) drafts.push({ draft, sub });
      } catch (e) {
        notes.push(`Rule ${rule.id} failed on submission ${sub.id}: ${(e as Error).message}`);
      }
    }
  }

  // Persist findings + evidence. Finding IDs are deterministic (entity + rule +
  // subject + period), so re-running analytics refreshes content while reviewer
  // decisions attach to the same finding id. Decisions themselves are
  // append-only and never deleted.
  const prevFindings = await db.findings.toArray();
  const prevStatusById = new Map(prevFindings.map((f) => [f.id, f.status]));
  const stableFindingId = (sub: Submission, ruleId: string, subject: string): string =>
    `FD-${shortHash(`${sub.entityId}|${sub.periodStart}|${ruleId}|${subject}`)}`;

  const findings: Finding[] = [];
  const evidenceRows: import('./types').FindingEvidence[] = [];
  const byRule: Record<string, number> = {};

  for (const { draft, sub } of drafts) {
    const recurrenceThreshold = Number(config.rules['R4']?.params['recurrenceThreshold'] ?? 5);
    const priority = computePriority(draft.priorityInputs, config.priorityWeights, recurrenceThreshold);
    const subject = draft.observed.map((o) => `${o.label}=${o.value}`).join(';');
    const findingId = stableFindingId(sub, draft.ruleId, subject);
    findings.push({
      id: findingId,
      entityId: sub.entityId,
      submissionId: sub.id,
      periodStart: sub.periodStart,
      periodEnd: sub.periodEnd,
      category: draft.category,
      ruleId: draft.ruleId,
      ruleVersion: draft.ruleVersion,
      ruleTitle: draft.ruleTitle,
      severity: draft.severity,
      priorityScore: priority.score,
      priorityLabel: priority.label,
      priorityComponents: priority.components,
      evidenceStrength: draft.evidenceStrength,
      explanation: draft.explanation,
      suggestedQuestions: draft.suggestedQuestions,
      limitations: draft.limitations,
      status: prevStatusById.get(findingId) ?? 'new',
      createdAt: startedAt,
      analyticsRunId: runId,
      params: draft.params,
      observed: draft.observed,
    });
    for (const ev of draft.evidence) {
      evidenceRows.push({
        id: makeId('EV'),
        findingId,
        sourceRecordType: ev.sourceRecordType,
        sourceRecordId: ev.sourceRecordId,
        sourceFileId: ev.sourceFileId ?? null,
        sourceRowRef: ev.sourceRowRef ?? null,
        evidenceRole: ev.evidenceRole ?? 'contextual',
        note: ev.note,
      });
    }
    byRule[draft.ruleId] = (byRule[draft.ruleId] ?? 0) + 1;
  }

  const finishedAt = new Date().toISOString();
  const run: AnalyticsRun = {
    id: runId,
    startedAt,
    finishedAt,
    softwareVersion: SOFTWARE_VERSION,
    configHash,
    config,
    recordCounts: {
      assets: assets.length,
      alerts: alerts.length,
      cases: cases.length,
      actions: actions.length,
      escalations: escalations.length,
      telemetry: telemetry.length,
    },
    findingsCreated: findings.length,
    notes,
  };

  await db.transaction(
    'rw',
    [db.findings, db.findingEvidence, db.analyticsRuns, db.auditEvents],
    async () => {
      await db.findings.clear();
      await db.findingEvidence.clear();
      await db.findings.bulkAdd(findings);
      await db.findingEvidence.bulkAdd(evidenceRows);
      await db.analyticsRuns.add(run);
      await recordAudit({
        actor,
        eventType: 'analytics_run',
        targetType: 'analytics_run',
        targetId: runId,
        details: `Analytics run over ${submissions.length} submission(s): ${findings.length} finding(s) ` +
          `(${Object.entries(byRule).map(([r, n]) => `${r}:${n}`).join(', ') || 'none'}); config hash ${configHash.slice(0, 12)}…; ` +
          `${notes.length} rule error(s).`,
      });
    }
  );

  return {
    runId,
    findingsCreated: findings.length,
    byRule,
    durationMs: Math.round(performance.now() - t0),
    notes,
  };
}

/** Bulk loader for the synthetic demo bundle (Import page "Load demo data"). */
export async function importDemoBundle(
  bundleText: string,
  actor: string
): Promise<{ entities: number; submissions: number; records: number }> {
  interface DemoBundle {
    meta: {
      seed: number;
      generator_version: string;
      generated_at: string;
      is_synthetic: boolean;
      entities: { id: string; name: string; sector?: string; peer_group?: string }[];
      periods: { start: string; end: string; label: string }[];
    };
    assets: Asset[];
    alerts: Alert[];
    cases: Case[];
    actions: InvestigationAction[];
    escalations: Escalation[];
    telemetry: TelemetryRecord[];
  }
  let bundle: DemoBundle;
  try {
    bundle = JSON.parse(bundleText) as DemoBundle;
  } catch (e) {
    throw new Error(`Demo bundle is not valid JSON: ${(e as Error).message}`);
  }
  if (!bundle.meta?.is_synthetic) {
    throw new Error('This loader only accepts synthetic demo bundles (meta.is_synthetic must be true).');
  }

  const entityIdMap = new Map<string, string>();
  for (const e of bundle.meta.entities) {
    const existing = await db.entities.get(e.id);
    const rec: Entity = {
      id: e.id,
      name: e.name,
      sector: e.sector,
      peerGroup: e.peer_group,
      createdAt: existing?.createdAt ?? bundle.meta.generated_at,
    };
    await db.entities.put(rec);
    entityIdMap.set(e.id, rec.id);
  }

  const hash = await hashText(bundleText);
  const submissionIds: string[] = [];
  let recordCount = 0;

  await db.transaction(
    'rw',
    [db.submissions, db.files, db.importBatches, db.assets, db.alerts, db.cases, db.actions, db.escalations, db.telemetry, db.auditEvents],
    async () => {
      for (const _period of bundle.meta.periods) {
        void _period;
        const subs = new Set<string>([
          ...bundle.assets.map((a) => (a as { submissionId: string }).submissionId),
          ...bundle.alerts.map((a) => (a as { submissionId: string }).submissionId),
          ...bundle.cases.map((c) => (c as { submissionId: string }).submissionId),
        ]);
        for (const rawSubId of subs) {
          // SUB-<ENTITY>-P<n> pattern from the generator.
          const entityId = rawSubId.split('-').slice(0, 2).join('-');
          if (!entityIdMap.has(entityId)) continue;
          const submissionId = rawSubId;
          submissionIds.push(submissionId);
          const periodIndex = Number(rawSubId.split('-P')[1] ?? '1');
          const period = bundle.meta.periods[periodIndex - 1] ?? bundle.meta.periods[0];
          await db.submissions.put({
            id: submissionId,
            entityId,
            periodStart: period.start,
            periodEnd: period.end,
            label: `Synthetic bundle (seed ${bundle.meta.seed}) P${periodIndex}`,
            createdAt: bundle.meta.generated_at,
            fileHashes: [hash],
            notes: `Loaded from synthetic demo bundle generated at ${bundle.meta.generated_at} by generator v${bundle.meta.generator_version}.`,
          });
          const bySub = <T extends { submissionId: string }>(rows: T[]) => rows.filter((r) => r.submissionId === submissionId);
          const assets = bySub(bundle.assets);
          const alerts = bySub(bundle.alerts);
          const cases = bySub(bundle.cases);
          const actions = bySub(bundle.actions);
          const escalations = bySub(bundle.escalations);
          const telemetry = bySub(bundle.telemetry);
          const fileId = `F:${submissionId}:bundle`;
          await db.files.put({
            id: fileId,
            submissionId,
            filename: 'argus-demo-bundle.json',
            kind: 'bundle',
            sha256: hash,
            byteSize: new TextEncoder().encode(bundleText).length,
            recordCount: assets.length + alerts.length + cases.length + actions.length + escalations.length + telemetry.length,
            acceptedCount: assets.length + alerts.length + cases.length + actions.length + escalations.length + telemetry.length,
            rejectedCount: 0,
            importedAt: bundle.meta.generated_at,
            softwareVersion: SOFTWARE_VERSION,
          });
          const completeness = {
            expectedCategories: ['assets', 'alerts', 'cases', 'actions', 'escalations', 'telemetry'],
            presentCategories: [
              assets.length && 'assets', alerts.length && 'alerts', cases.length && 'cases',
              actions.length && 'actions', escalations.length && 'escalations', telemetry.length && 'telemetry',
            ].filter(Boolean) as string[],
            missingCategories: [] as string[],
            acceptRate: {},
            score: 1,
            notes: ['Demo bundle import: completeness computed from record categories present.'],
          };
          if (escalations.length === 0) {
            completeness.missingCategories.push('escalations');
            completeness.presentCategories = completeness.presentCategories.filter((c) => c !== 'escalations');
            completeness.score = completeness.presentCategories.length / completeness.expectedCategories.length;
            completeness.notes.push('Escalations category absent from this submission (seeded negative space).');
          }
          await db.importBatches.put({
            id: `IB:${submissionId}`,
            submissionId,
            createdAt: bundle.meta.generated_at,
            issues: [],
            totals: {
              read: assets.length + alerts.length + cases.length + actions.length + escalations.length + telemetry.length,
              accepted: assets.length + alerts.length + cases.length + actions.length + escalations.length + telemetry.length,
              rejected: 0,
              duplicates: 0,
            },
            completeness,
          });
          await db.assets.bulkPut(assets);
          await db.alerts.bulkPut(alerts);
          await db.cases.bulkPut(cases);
          await db.actions.bulkPut(actions);
          await db.escalations.bulkPut(escalations);
          await db.telemetry.bulkPut(telemetry);
          recordCount += assets.length + alerts.length + cases.length + actions.length + escalations.length + telemetry.length;
        }
      }
      await recordAudit({
        actor,
        eventType: 'import',
        targetType: 'demo_bundle',
        targetId: `seed-${bundle.meta.seed}`,
        details: `Loaded synthetic demo bundle (seed ${bundle.meta.seed}, generator v${bundle.meta.generator_version}): ` +
          `${entityIdMap.size} entities, ${submissionIds.length} submissions, ${recordCount} records. All data is synthetic.`,
      });
    }
  );

  return { entities: entityIdMap.size, submissions: submissionIds.length, records: recordCount };
}

/** Attach a human-readable case label for evidence drill-down. */
export async function caseLabel(id: string): Promise<string> {
  const c = await db.cases.get(id);
  return c ? displayId(c) : id;
}
