// Review workflow: append-only decisions + report generation (CSV, HTML).
// A dismissed finding is never deleted; every state change is recorded.

import { db, recordAudit } from './db';
import { FINDING_CATEGORY_LABELS, SOFTWARE_VERSION } from './types';
import type {
  AnalyticsRun,
  Entity,
  Finding,
  FindingEvidence,
  FindingStatus,
  ImportBatch,
  ReviewDecision,
  Submission,
} from './types';
import { formatDateTime, toCsv } from './util';

export const PERMITTED_STATUSES: FindingStatus[] = [
  'new',
  'in_review',
  'confirmed',
  'dismissed',
  'needs_more_evidence',
  'unresolved',
];

export async function recordDecision(
  findingId: string,
  newStatus: FindingStatus,
  reviewer: string,
  notes: string,
  actor: string
): Promise<void> {
  const finding = await db.findings.get(findingId);
  if (!finding) throw new Error(`Finding ${findingId} not found.`);
  if (!PERMITTED_STATUSES.includes(newStatus)) throw new Error(`Status "${newStatus}" is not permitted.`);
  if (!reviewer.trim()) throw new Error('Reviewer identifier is required.');

  const decision: ReviewDecision = {
    id: `RD_${crypto.randomUUID()}`,
    findingId,
    previousStatus: finding.status,
    newStatus,
    reviewer: reviewer.trim(),
    notes: notes.trim(),
    at: new Date().toISOString(),
  };
  await db.transaction('rw', [db.findings, db.reviewDecisions, db.auditEvents], async () => {
    await db.reviewDecisions.add(decision);
    await db.findings.update(findingId, { status: newStatus });
    await recordAudit({
      actor: reviewer.trim() || actor,
      eventType: 'finding_status_change',
      targetType: 'finding',
      targetId: findingId,
      previousStatus: decision.previousStatus ?? undefined,
      newStatus,
      details: notes.trim()
        ? `Status changed to ${newStatus}: ${notes.trim()}`
        : `Status changed to ${newStatus}.`,
    });
  });
}

export async function getDecisionHistory(findingId: string): Promise<ReviewDecision[]> {
  return db.reviewDecisions.where('findingId').equals(findingId).sortBy('at');
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportScope {
  entityId: string | 'all';
  periodStart?: string;
  periodEnd?: string;
  submissionId?: string;
}

export async function exportFindingsCsv(scope: ReportScope): Promise<string> {
  const [findings, entities] = await Promise.all([db.findings.toArray(), db.entities.toArray()]);
  const rows = findings.filter((f) => scope.entityId === 'all' || f.entityId === scope.entityId);
  const header = [
    'finding_id', 'entity', 'period', 'category', 'rule', 'rule_version', 'severity',
    'priority_score', 'priority_label', 'evidence_strength', 'status', 'explanation', 'limitations',
  ];
  const body = rows.map((f) => [
    f.id,
    entities.find((e) => e.id === f.entityId)?.name ?? f.entityId,
    `${f.periodStart}..${f.periodEnd}`,
    FINDING_CATEGORY_LABELS[f.category],
    f.ruleId,
    f.ruleVersion,
    f.severity,
    f.priorityScore ?? '',
    f.priorityLabel,
    f.evidenceStrength,
    f.status,
    f.explanation,
    f.limitations,
  ]);
  return toCsv(header, body);
}

export interface HtmlReportInput {
  scope: ReportScope;
  reviewer: string;
}

interface ReportData {
  entityName: string;
  findings: Finding[];
  entities: Entity[];
  submissions: Submission[];
  batches: ImportBatch[];
  runs: AnalyticsRun[];
  evidence: FindingEvidence[];
  decisions: ReviewDecision[];
}

async function collectReportData(scope: ReportScope): Promise<ReportData> {
  const [entities, submissions, batches, runs, findings, evidence, decisions] = await Promise.all([
    db.entities.toArray(),
    db.submissions.toArray(),
    db.importBatches.toArray(),
    db.analyticsRuns.toArray(),
    db.findings.toArray(),
    db.findingEvidence.toArray(),
    db.reviewDecisions.toArray(),
  ]);
  const filtered = findings.filter((f) => {
    if (scope.entityId !== 'all' && f.entityId !== scope.entityId) return false;
    if (scope.periodStart && f.periodStart < scope.periodStart) return false;
    if (scope.periodEnd && f.periodEnd > scope.periodEnd) return false;
    return true;
  });
  return {
    entityName:
      scope.entityId === 'all'
        ? 'All entities'
        : (entities.find((e) => e.id === scope.entityId)?.name ?? scope.entityId),
    findings: filtered,
    entities,
    submissions,
    batches,
    runs,
    evidence,
    decisions,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Build a printable, standalone HTML report (no external assets). */
export async function buildHtmlReport(input: HtmlReportInput): Promise<string> {
  const data = await collectReportData(input.scope);
  const generatedAt = new Date().toISOString();
  const latestRun = data.runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const synthetic =
    data.submissions.some((s) => (s.notes ?? '').includes('synthetic')) || true; // prototype ships synthetic by default

  const byCategory = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const f of data.findings) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
    byStatus.set(f.status, (byStatus.get(f.status) ?? 0) + 1);
  }

  const statusRow = (label: string, n: number) => `<tr><td>${label}</td><td>${n}</td></tr>`;
  const findingSections = [...data.findings]
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
    .map((f) => {
      const ev = data.evidence.filter((e) => e.findingId === f.id);
      const entity = data.entities.find((e) => e.id === f.entityId);
      const history = data.decisions
        .filter((d) => d.findingId === f.id)
        .sort((a, b) => a.at.localeCompare(b.at));
      return `
  <section class="finding">
    <h3>${esc(f.ruleId)} — ${esc(f.ruleTitle)}</h3>
    <p class="meta">Finding ${esc(f.id)} · ${esc(entity?.name ?? f.entityId)} · period ${esc(f.periodStart)}..${esc(f.periodEnd)} ·
      category ${esc(FINDING_CATEGORY_LABELS[f.category])} · severity ${esc(f.severity)} ·
      review priority ${f.priorityScore ?? 'n/a'} (${esc(f.priorityLabel)}) · evidence ${esc(f.evidenceStrength)} · status ${esc(f.status)}</p>
    <p>${esc(f.explanation)}</p>
    <h4>Observed values</h4>
    <ul>${f.observed.map((o) => `<li><strong>${esc(o.label)}:</strong> ${esc(o.value)}</li>`).join('')}</ul>
    <h4>Evidence (${ev.length})</h4>
    <ul>${ev.map((e) => `<li>${esc(e.sourceRecordType)} ${esc(e.sourceRecordId)}${e.sourceRowRef ? ` @ ${esc(e.sourceRowRef)}` : ''} (${esc(e.evidenceRole)})</li>`).join('')}</ul>
    <h4>Limitations</h4><p>${esc(f.limitations)}</p>
    <h4>Decision history</h4>
    ${history.length === 0 ? '<p>No reviewer decisions recorded.</p>' : `<ul>${history.map((d) => `<li>${esc(formatDateTime(d.at))} — ${esc(d.reviewer)}: ${esc(d.previousStatus ?? '—')} → ${esc(d.newStatus)}${d.notes ? ` — “${esc(d.notes)}”` : ''}</li>`).join('')}</ul>`}
  </section>`;
    })
    .join('\n');

  const dataQuality = data.batches
    .filter((b) => (input.scope.entityId === 'all' ? true : data.submissions.find((s) => s.id === b.submissionId)?.entityId === input.scope.entityId))
    .map(
      (b) => `<tr><td>${esc(b.id)}</td><td>${esc(b.submissionId)}</td><td>${b.totals.read}</td><td>${b.totals.accepted}</td>
      <td>${b.totals.rejected}</td><td>${b.totals.duplicates}</td><td>${(b.completeness.score * 100).toFixed(0)}%</td>
      <td>${esc(b.completeness.missingCategories.join(', ') || '—')}</td><td>${b.issues.length}</td></tr>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>ARGUS SAT report — ${esc(data.entityName)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: Georgia, 'Times New Roman', serif; margin: 2rem auto; max-width: 900px; color: #1a2b22; line-height: 1.5; }
  h1 { font-size: 1.6rem; border-bottom: 3px solid #14532d; padding-bottom: .4rem; }
  h3 { margin-top: 1.4rem; }
  .banner { background: #fef3c7; border: 1px solid #d97706; padding: .6rem 1rem; border-radius: 6px; font-weight: 600; }
  .meta { color: #4b6358; font-size: .85rem; }
  table { border-collapse: collapse; width: 100%; margin: .8rem 0; font-size: .85rem; }
  th, td { border: 1px solid #cbd5d0; padding: .35rem .55rem; text-align: left; }
  th { background: #e8f2ec; }
  .finding { border-top: 2px solid #d3e4da; padding-top: .6rem; margin-top: 1.2rem; page-break-inside: avoid; }
  @media print { body { margin: 1cm; } }
</style>
</head>
<body>
<h1>ARGUS SAT — Supervisory Analytics Report</h1>
<p class="meta">Scope: ${esc(data.entityName)} · Generated ${esc(formatDateTime(generatedAt))} · ARGUS SAT v${SOFTWARE_VERSION} ·
analytics run ${esc(latestRun?.id ?? 'n/a')} (${esc(latestRun?.softwareVersion ?? '')}, config ${esc(latestRun?.configHash.slice(0, 12) ?? '')}…)</p>
<p class="banner">${synthetic ? 'SYNTHETIC DATA NOTICE: this report was produced from synthetic demonstration data. All entities, records, and findings are fictional.' : 'Data source: imported submissions.'}</p>

<h2>1. Scope and methodology</h2>
<p>This report summarizes potential execution gaps, negative-space conditions, unusual patterns, and data-quality issues detected in the
submitted SOC evidence for the selected scope. Findings are produced by deterministic, configurable rules (catalogue v1.0.0) and a
transparent review-priority indicator (weights S=0.40, E=0.30, C=0.20, R=0.10 — illustrative prototype values, not official weights).
Every finding is a signal for human review, not a conclusion of non-compliance.</p>

<h2>2. Data quality and completeness</h2>
<table>
<tr><th>Import batch</th><th>Submission</th><th>Read</th><th>Accepted</th><th>Rejected</th><th>Duplicates</th><th>Completeness</th><th>Missing categories</th><th>Validation issues</th></tr>
${dataQuality || '<tr><td colspan="9">No import batches in scope.</td></tr>'}
</table>

<h2>3. Findings summary</h2>
<table>
<tr><th>Category</th><th>Count</th></tr>
${[...byCategory.entries()].map(([k, v]) => statusRow(FINDING_CATEGORY_LABELS[k as keyof typeof FINDING_CATEGORY_LABELS] ?? k, v)).join('') || statusRow('No findings', 0)}
</table>
<table>
<tr><th>Review status</th><th>Count</th></tr>
${[...byStatus.entries()].map(([k, v]) => statusRow(k, v)).join('')}
</table>

<h2>4. Prioritized findings</h2>
${findingSections || '<p>No findings in scope. Run analytics after importing data.</p>'}

<h2>5. Limitations and caveats</h2>
<ul>
<li>All thresholds are configurable prototype defaults, not official requirements.</li>
<li>Missing evidence can result from incomplete exports; completeness caveats accompany each negative-space finding.</li>
<li>The review-priority indicator is an aid for ordering review work; it is not a confirmed risk score.</li>
<li>Synthetic demonstration results do not demonstrate real-world effectiveness.</li>
</ul>

<p class="meta">Report generation timestamp: ${esc(generatedAt)} · Reviewer of record: ${esc(input.reviewer || 'unspecified')}</p>
</body>
</html>`;
}
