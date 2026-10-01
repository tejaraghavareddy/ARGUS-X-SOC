// Deterministic supervisory rules R1-R8 with explicit expectations,
// negative-space methodology, evidence links, and human-readable explanations.
//
// Every rule follows the catalogue contract: stable id+version, required
// inputs, trigger condition, severity guidance, evidence, explanation,
// limitations, and configurable parameters (prototype defaults).

import { groupActionsByCase, fmtHours } from './rulekit';
import type { FindingDraft, RuleContext, EvidenceDraft } from './rulekit';
import { buildTfidf, findSimilarPairs } from './textsim';
import { hoursBetween, median } from './util';
import type { AssetCriticality, Case } from './types';

export interface RuleDef {
  id: string;
  version: string;
  title: string;
  description: string;
  requires: string[]; // categories that must be present
  run: (ctx: RuleContext) => FindingDraft[];
}

function p(ctx: RuleContext, ruleId: string, key: string, fallback: number): number {
  const rule = ctx.config.rules[ruleId];
  const v = rule?.params[key];
  return typeof v === 'number' ? v : fallback;
}
function ps(ctx: RuleContext, ruleId: string, key: string, fallback: string): string {
  const rule = ctx.config.rules[ruleId];
  const v = rule?.params[key];
  return typeof v === 'string' ? v : fallback;
}
// Rule enablement and category requirements are enforced by the orchestrator
// (pipeline.ts) so configuration lives in one place.

// ---------------------------------------------------------------------------
// R1 - Critical case closed unusually quickly (execution gap)
// ---------------------------------------------------------------------------
export const R1: RuleDef = {
  id: 'R1',
  version: '1.0.0',
  title: 'Critical case closed unusually quickly without investigation evidence',
  description:
    'Flags critical-severity cases whose closure time is below the configured threshold while the submitted investigation record is absent or unusually sparse and the case is not marked as automated.',
  requires: ['cases'],
  run(ctx) {
    const out: FindingDraft[] = [];
    const fastHours = p(ctx, 'R1', 'fastClosureHours', 24);
    const minActions = p(ctx, 'R1', 'minActionsForEvidence', 2);
    const actionsByCase = groupActionsByCase(ctx.actions);
    const automated = ps(ctx, 'R1', 'treatAutomatedAsBenign', 'true') === 'true';

    for (const c of ctx.cases) {
      if (c.severity !== 'critical' || !c.openedAt || !c.closedAt) continue;
      if (automated && c.automated) continue; // documented false-positive guard
      const hours = hoursBetween(c.openedAt, c.closedAt);
      if (hours > fastHours) continue;
      const acts = actionsByCase.get(c.id) ?? [];
      if (acts.length >= minActions) continue;

      const assetCrit: AssetCriticality | null = firstLinkedAssetCriticality(ctx, c);
      out.push({
        category: 'execution_gap',
        ruleId: 'R1',
        ruleVersion: '1.0.0',
        ruleTitle: 'Critical case closed unusually quickly without investigation evidence',
        severity: 'high',
        evidenceStrength: acts.length === 0 ? 'strong' : 'moderate',
        explanation:
          `Critical case ${displayId(c)} was closed ${fmtHours(hours)} after opening (threshold: ${fastHours} h) ` +
          `with ${acts.length} investigation action(s) submitted (expected at least ${minActions} for a manual critical case). ` +
          `${c.automated ? 'The case is marked automated.' : 'The case is not marked as automated.'} ` +
          `This is a potential execution gap in the detect-investigate-close workflow and requires human review; fast closure alone is not proof of improper handling.`,
        suggestedQuestions: [
          'Was this closure validated by an analyst or performed by an automated playbook?',
          'Why is no investigation action recorded for a critical case?',
          'Was investigation evidence generated but simply not exported in the submission?',
        ],
        limitations:
          'Fast closure alone is not proof of improper handling: automated resolution, an earlier linked investigation, or missing exports can explain it. Requires the cases (and ideally actions) categories to be present.',
        observed: [
          { label: 'Case', value: displayId(c) },
          { label: 'Severity', value: c.severity },
          { label: 'Opened', value: c.openedAt },
          { label: 'Closed', value: c.closedAt ?? '-' },
          { label: 'Elapsed', value: fmtHours(hours) },
          { label: 'Investigation actions submitted', value: String(acts.length) },
          { label: 'Automated flag', value: String(c.automated) },
        ],
        params: { fastClosureHours: fastHours, minActionsForEvidence: minActions },
        evidence: [
          caseRef(c, 'supporting'),
          ...acts.map((a) => actionRef(a, 'contextual')),
        ],
        priorityInputs: { S: 'high', E: acts.length === 0 ? 'strong' : 'moderate', C: assetCrit, R: 1 },
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// R2 - Required escalation missing (execution gap / negative space)
// ---------------------------------------------------------------------------
export const R2: RuleDef = {
  id: 'R2',
  version: '1.0.0',
  title: 'Required escalation record missing',
  description:
    'For cases whose severity class is configured to require escalation, flags cases with no matching escalation record in the submitted evidence.',
  requires: ['cases', 'escalations'],
  run(ctx) {
    const out: FindingDraft[] = [];
    const severities = ps(ctx, 'R2', 'requireEscalationForSeverities', 'critical,high')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    for (const c of ctx.cases) {
      if (!severities.includes(c.severity)) continue;
      if (c.automated) continue; // documented exemption: automated playbooks do not page humans
      const hasEscalation = ctx.escalations.some((e) => e.caseId === c.id);
      if (hasEscalation) continue;

      const assetCrit: AssetCriticality | null = firstLinkedAssetCriticality(ctx, c);
      out.push({
        category: 'execution_gap',
        ruleId: 'R2',
        ruleVersion: '1.0.0',
        ruleTitle: 'Required escalation record missing',
        severity: c.severity === 'critical' ? 'critical' : 'high',
        evidenceStrength: 'moderate',
        explanation:
          `Case ${displayId(c)} (severity: ${c.severity}) belongs to a severity class configured (prototype policy) to require escalation, ` +
          `but no escalation record referencing it exists in the ${ctx.escalations.length} escalation record(s) submitted for this period. ` +
          `This is a potential missing-workflow execution gap and requires human review.`,
        suggestedQuestions: [
          'Was the case escalated through a channel that does not generate escalation records?',
          'Does the organization use a different escalation recording tool not included in the export?',
          'Who approved closing this case without escalation?',
        ],
        limitations:
          'The escalation record may exist operationally but be absent from the export. Expectation comes from the prototype severity policy, not an official NTRO/NCIIPC mandate.',
        observed: [
          { label: 'Case', value: displayId(c) },
          { label: 'Severity', value: c.severity },
          { label: 'Status', value: c.status },
          { label: 'Opened', value: c.openedAt ?? '-' },
          { label: 'Escalation records searched', value: String(ctx.escalations.length) },
        ],
        params: { requireEscalationForSeverities: severities.join(',') },
        evidence: [caseRef(c, 'supporting'), ...ctx.escalations.slice(0, 3).map((e) => escRef(e, 'contextual'))],
        priorityInputs: { S: c.severity === 'critical' ? 'critical' : 'high', E: 'moderate', C: assetCrit, R: 1 },
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// R3 - Investigation evidence missing (execution gap)
// ---------------------------------------------------------------------------
export const R3: RuleDef = {
  id: 'R3',
  version: '1.0.0',
  title: 'Investigation evidence missing for a case expected to be investigated',
  description:
    'Flags cases that are closed or long-open without the expected minimum number of investigation actions.',
  requires: ['cases'],
  run(ctx) {
    const out: FindingDraft[] = [];
    const minActions = p(ctx, 'R3', 'minActionsForEvidence', 1);
    const longOpenDays = p(ctx, 'R3', 'longOpenDays', 14);
    const actionsByCase = groupActionsByCase(ctx.actions);

    for (const c of ctx.cases) {
      const acts = actionsByCase.get(c.id) ?? [];
      if (acts.length >= minActions) continue;
      // Documented exemption: fully automated playbooks legitimately record a
      // single automated containment action instead of analyst investigation.
      if (acts.length === 1 && c.automated && acts[0]!.investigatorReference.startsWith('PLAYBOOK')) continue;
      const isClosed = c.status === 'closed' && c.closedAt;
      const daysOpen = c.openedAt
        ? (Date.now() - Date.parse(c.openedAt)) / 86_400_000 > longOpenDays || hoursBetween(c.openedAt, ctx.periodEnd + 'T23:59:59Z') / 24 > longOpenDays
        : false;
      if (!isClosed && !daysOpen) continue;

      const assetCrit: AssetCriticality | null = firstLinkedAssetCriticality(ctx, c);
      out.push({
        category: 'execution_gap',
        ruleId: 'R3',
        ruleVersion: '1.0.0',
        ruleTitle: 'Investigation evidence missing for a case expected to be investigated',
        severity: c.severity === 'unknown' ? 'low' : c.severity === 'critical' ? 'high' : 'medium',
        evidenceStrength: 'strong',
        explanation:
          `Case ${displayId(c)} (status: ${c.status}, severity: ${c.severity}) is ${isClosed ? 'closed' : `open for more than ${longOpenDays} days`} ` +
          `but has ${acts.length} investigation action(s) submitted (expected at least ${minActions}). ` +
          `A closed or long-open case without recorded investigation work is a potential execution gap in the investigate workflow.`,
        suggestedQuestions: [
          'How was this case dispositioned without recorded investigation steps?',
          'Are investigation records stored in a system not covered by this submission?',
        ],
        limitations:
          'Only meaningful when the actions category is expected for this case type. If the actions category is missing from the submission entirely, this rule is suppressed by the completeness check.',
        observed: [
          { label: 'Case', value: displayId(c) },
          { label: 'Status', value: c.status },
          { label: 'Severity', value: c.severity },
          { label: 'Investigation actions', value: String(acts.length) },
          { label: 'Opened', value: c.openedAt ?? '-' },
        ],
        params: { minActionsForEvidence: minActions, longOpenDays },
        evidence: [caseRef(c, 'supporting'), ...acts.map((a) => actionRef(a, 'contextual'))],
        priorityInputs: { S: c.severity === 'unknown' ? 'low' : c.severity === 'critical' ? 'high' : 'medium', E: 'strong', C: assetCrit, R: 1 },
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// R4 - Recurring alerts without documented remediation
// ---------------------------------------------------------------------------
export const R4: RuleDef = {
  id: 'R4',
  version: '1.0.0',
  title: 'Recurring alerts on the same asset without documented remediation',
  description:
    'Groups alerts by asset + family within a time window; flags groups whose recurrence exceeds the threshold with no linked case or remediation action.',
  requires: ['alerts'],
  run(ctx) {
    const out: FindingDraft[] = [];
    const threshold = p(ctx, 'R4', 'recurrenceThreshold', 5);
    const windowHours = p(ctx, 'R4', 'windowHours', 720);
    const caseIdsByAlert = new Map<string, string[]>();
    for (const c of ctx.cases) for (const aid of c.linkedAlertIds) {
      caseIdsByAlert.set(aid, [...(caseIdsByAlert.get(aid) ?? []), c.id]);
    }

    const groups = new Map<string, typeof ctx.alerts>();
    for (const a of ctx.alerts) {
      if (!a.assetId || !a.openedAt) continue;
      const key = `${a.assetId}::${a.alertFamily ?? 'unspecified'}`;
      const list = groups.get(key) ?? [];
      list.push(a);
      groups.set(key, list);
    }

    for (const alerts of groups.values()) {
      if (alerts.length < threshold) continue;
      const sorted = [...alerts].sort((a, b) => (a.openedAt ?? '').localeCompare(b.openedAt ?? ''));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (!first?.openedAt || !last?.openedAt) continue;
      if (hoursBetween(first.openedAt, last.openedAt) > windowHours) continue;

      const linkedCaseIds = new Set(sorted.flatMap((a) => caseIdsByAlert.get(a.id) ?? []));
      const remediationActions = ctx.actions.filter(
        (ac) => linkedCaseIds.has(ac.caseId) && ['remediation', 'containment'].includes(ac.actionType)
      );
      if (remediationActions.length > 0) continue; // remediation evidence exists
      void sorted;

      const asset = ctx.assets.find((x) => x.id === first.assetId);
      const crit: AssetCriticality = asset?.criticality && asset.criticality !== 'unknown' ? asset.criticality : 'medium';
      const assetRef: EvidenceDraft[] = asset
        ? [{ sourceRecordType: 'asset', sourceRecordId: asset.id, sourceFileId: asset.fileId, sourceRowRef: asset.rowRef, evidenceRole: 'contextual' as const }]
        : [];

      out.push({
        category: 'unusual_pattern',
        ruleId: 'R4',
        ruleVersion: '1.0.0',
        ruleTitle: 'Recurring alerts on the same asset without documented remediation',
        severity: crit === 'critical' ? 'high' : 'medium',
        evidenceStrength: 'strong',
        explanation:
          `${alerts.length} alerts of family "${first.alertFamily ?? 'unspecified'}" recurred on asset ${displayId(first.assetId)} ` +
          `between ${first.openedAt} and ${last.openedAt} (threshold: ${threshold} within ${windowHours} h). ` +
          `No remediation or containment action is linked via submitted cases. This is a potential unresolved underlying issue, not proof of one.`,
        suggestedQuestions: [
          'Is this alert family known-noisy and accepted by policy?',
          'What root-cause work has been done between recurrences?',
          'Why is there no linked case or remediation record?',
        ],
        limitations:
          'Recurrence can be expected for noisy detections; linked remediation may exist outside the submitted export.',
        observed: [
          { label: 'Asset', value: displayId(first.assetId) },
          { label: 'Alert family', value: first.alertFamily ?? 'unspecified' },
          { label: 'Recurrence count', value: String(alerts.length) },
          { label: 'First seen', value: first.openedAt },
          { label: 'Last seen', value: last.openedAt },
          { label: 'Linked cases', value: linkedCaseIds.size > 0 ? [...linkedCaseIds].join(', ') : 'none' },
        ],
        params: { recurrenceThreshold: threshold, windowHours },
        evidence: [
          ...assetRef,
          ...sorted.slice(0, 5).map((a) => alertRef(a, 'supporting')),
        ],
        priorityInputs: { S: crit === 'critical' ? 'high' : 'medium', E: 'strong', C: crit, R: alerts.length },
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// R5 - Expected telemetry / monitoring record missing (negative space)
// ---------------------------------------------------------------------------
export const R5: RuleDef = {
  id: 'R5',
  version: '1.0.0',
  title: 'Expected monitoring/telemetry record missing for an asset',
  description:
    'For assets explicitly marked monitoring_expected=true in the inventory, flags assets with no telemetry record in the period. Runs only when the telemetry feed is substantially present.',
  requires: ['assets', 'telemetry'],
  run(ctx) {
    const out: FindingDraft[] = [];
    const minCoverage = p(ctx, 'R5', 'minInventoryCoverage', 0.8);
    const monitored = ctx.assets.filter((a) => a.monitoringExpected === true);
    if (monitored.length === 0) return out;
    const withTelemetry = new Set(ctx.telemetry.map((t) => t.assetId).filter(Boolean) as string[]);
    // Completeness gate: telemetry feed must be substantially present, otherwise
    // absences are unreliable and the submission is treated as incomplete.
    const feedCoverage = withTelemetry.size / monitored.length;
    if (feedCoverage < minCoverage * 0.5) return out;

    for (const asset of monitored) {
      if (withTelemetry.has(asset.id)) continue;
      out.push({
        category: 'negative_space',
        ruleId: 'R5',
        ruleVersion: '1.0.0',
        ruleTitle: 'Expected monitoring/telemetry record missing for an asset',
        severity: asset.criticality === 'critical' ? 'critical' : asset.criticality === 'high' ? 'high' : 'medium',
        evidenceStrength: 'moderate',
        explanation:
          `Asset ${displayId(asset)} is marked monitoring_expected=true (criticality: ${asset.criticality}) in the submitted inventory, ` +
          `but no telemetry record covers it in ${ctx.periodStart}..${ctx.periodEnd}. ` +
          `${ctx.telemetry.length} telemetry records were searched. The expectation comes from the inventory flag; the absence is a negative-space signal that requires human confirmation.`,
        suggestedQuestions: [
          'Was the sensor decommissioned or the asset retired during the period?',
          'Is telemetry collected by a tool not included in the submission?',
          'What is the actual current monitoring status of this asset?',
        ],
        limitations:
          'Only assets explicitly flagged monitoring_expected=true are in scope. If most telemetry records are missing, the submission is treated as incomplete and this rule stays silent.',
        observed: [
          { label: 'Asset', value: displayId(asset) },
          { label: 'Criticality', value: asset.criticality },
          { label: 'Monitoring expected', value: 'true (inventory flag)' },
          { label: 'Period', value: `${ctx.periodStart} .. ${ctx.periodEnd}` },
          { label: 'Telemetry records searched', value: String(ctx.telemetry.length) },
        ],
        params: { minInventoryCoverage: minCoverage },
        evidence: [
          { sourceRecordType: 'asset', sourceRecordId: asset.id, sourceFileId: asset.fileId, sourceRowRef: asset.rowRef, evidenceRole: 'supporting' as const },
        ],
        priorityInputs: { S: asset.criticality === 'critical' ? 'critical' : 'high', E: 'moderate', C: asset.criticality === 'unknown' ? null : asset.criticality, R: 1 },
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// R6 - Repetitive investigation patterns (text similarity)
// ---------------------------------------------------------------------------
export const R6: RuleDef = {
  id: 'R6',
  version: '1.0.0',
  title: 'Repetitive investigation narratives across cases',
  description:
    'TF-IDF + cosine similarity over investigation descriptions; flags unusually similar narratives among cases that are not linked to the same alerts.',
  requires: ['actions'],
  run(ctx) {
    const out: FindingDraft[] = [];
    const threshold = p(ctx, 'R6', 'similarityThreshold', 0.8);
    const minCases = p(ctx, 'R6', 'minCases', 4);
    const withText = ctx.actions.filter((a) => (a.actionDescription ?? '').length > 80);
    if (withText.length < minCases) return out;

    const index = buildTfidf(withText.map((a) => ({ id: a.id, text: a.actionDescription as string })));
    const pairs = findSimilarPairs(index, threshold);
    if (pairs.length === 0) return out;

    // Cluster actions connected by similar pairs (union-find).
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      const px = parent.get(x) ?? x;
      if (px === x) return x;
      const r = find(px);
      parent.set(x, r);
      return r;
    };
    for (const pr of pairs) {
      parent.set(find(pr.aId), find(pr.bId));
    }
    const clusters = new Map<string, string[]>();
    for (const id of parent.keys()) {
      const root = find(id);
      clusters.set(root, [...(clusters.get(root) ?? []), id]);
    }

    const actionById = new Map(ctx.actions.map((a) => [a.id, a]));
    for (const [, ids] of clusters) {
      if (ids.length < minCases) continue;
      const acts = ids.map((id) => actionById.get(id)).filter(Boolean) as typeof ctx.actions;
      const caseIds = [...new Set(acts.map((a) => a.caseId))];
      const caseRecs = ctx.cases.filter((c) => caseIds.includes(c.id));
      const categories = [...new Set(caseRecs.map((c) => c.category ?? 'unspecified'))];
      const sim = pairs
        .filter((pr) => ids.includes(pr.aId) && ids.includes(pr.bId))
        .reduce((m, pr) => Math.max(m, pr.similarity), 0);

      out.push({
        category: 'unusual_pattern',
        ruleId: 'R6',
        ruleVersion: '1.0.0',
        ruleTitle: 'Repetitive investigation narratives across cases',
        severity: 'medium',
        evidenceStrength: 'moderate',
        explanation:
          `${caseIds.length} cases across ${categories.length} category/categories (${categories.join(', ')}) share unusually similar investigation ` +
          `narratives (max cosine similarity ${sim.toFixed(2)}, threshold ${threshold}). Similar wording can indicate copy-paste investigation ` +
          `records or templated note-taking; templates are a legitimate explanation and this requires human review.`,
        suggestedQuestions: [
          'Do these cases share a template? If so, is per-case detail being lost?',
          'Were the investigations genuinely distinct?',
        ],
        limitations:
          'Standard operating procedures naturally produce similar wording. Threshold is a prototype default; adjust per organization.',
        observed: [
          { label: 'Cases involved', value: caseIds.join(', ') },
          { label: 'Max similarity', value: sim.toFixed(2) },
          { label: 'Threshold', value: String(threshold) },
          { label: 'Categories', value: categories.join(', ') },
        ],
        params: { similarityThreshold: threshold, minCases },
        evidence: acts.slice(0, 6).map((a) => actionRef(a, 'supporting')),
        priorityInputs: { S: 'medium', E: 'moderate', C: null, R: caseIds.length },
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// R7 - Unusually low or absent activity (statistical, peer/baseline aware)
// ---------------------------------------------------------------------------
export const R7: RuleDef = {
  id: 'R7',
  version: '1.0.0',
  title: 'Unusually low activity compared with baseline',
  description:
    'Compares alert volume with the entity\'s own historical periods and its peer group; suppressed when submission completeness indicates missing data.',
  requires: ['alerts'],
  run(ctx) {
    const out: FindingDraft[] = [];
    const lowFactor = p(ctx, 'R7', 'lowFactor', 0.5);
    const minPeerRecords = p(ctx, 'R7', 'minPeerRecords', 10);

    // Completeness gate: an incomplete submission must never produce a
    // low-activity conclusion. Missing data is never treated as zero activity.
    if (ctx.completeness.missingCategories.length > 0 || ctx.completeness.score < 0.99) return out;
    if (!ctx.baseline) return out;

    const observed = ctx.alerts.length;
    const historical = ctx.baseline.historicalAlertCounts;
    const peers = ctx.baseline.peerAlertCounts.map((x) => x.count);
    const comparison = [...historical, ...peers];
    if (comparison.length < minPeerRecords || observed === 0) return out;

    const baselineMedian = median(comparison);
    if (!Number.isFinite(baselineMedian) || baselineMedian <= 0) return out;
    const ratio = observed / baselineMedian;
    if (ratio > lowFactor) return out;

    const sources: string[] = [];
    if (historical.length > 0) sources.push(`${historical.length} prior period(s) of the same entity`);
    if (peers.length > 0) sources.push(`${peers.length} peer submission(s) in the same period`);

    out.push({
      category: 'statistical_anomaly',
      ruleId: 'R7',
      ruleVersion: '1.0.0',
      ruleTitle: 'Unusually low activity compared with baseline',
      severity: 'medium',
      evidenceStrength: 'weak',
      explanation:
        `Alert volume (${observed}) is ${ratio.toFixed(2)}x the comparison median (${baselineMedian.toFixed(1)}), below the configured low-activity factor (${lowFactor}). ` +
        `Comparison group: ${sources.join(' and ')}; minimum ${minPeerRecords} comparison values required. ` +
        `The submission passed completeness checks (no missing categories), so the low count is not explained by missing data. ` +
        `This is a statistical signal only: quieter periods, system migrations, and reporting changes are legitimate explanations, and low activity must never be labeled a security failure without review.`,
      suggestedQuestions: [
        'Was there an operational change (migration, maintenance window, policy) in this period?',
        'Were alert sources or detection rules changed?',
        'Does the entity confirm the volume reflects real activity?',
      ],
      limitations:
        'Median comparison is a simple baseline; seasonal effects are not modeled. Requires at least minPeerRecords comparison values; otherwise the rule stays silent.',
      observed: [
        { label: 'Observed alerts', value: String(observed) },
        { label: 'Comparison median', value: baselineMedian.toFixed(1) },
        { label: 'Ratio', value: ratio.toFixed(2) },
        { label: 'Low-activity factor', value: String(lowFactor) },
        { label: 'Comparison values used', value: String(comparison.length) },
        { label: 'Historical counts', value: historical.join(', ') || 'none' },
        { label: 'Peer counts', value: peers.join(', ') || 'none' },
      ],
      params: { lowFactor, minPeerRecords },
      evidence: [
        {
          sourceRecordType: 'import_batch',
          sourceRecordId: ctx.submissionId,
          evidenceRole: 'supporting',
          note: 'Completeness-verified submission with low alert volume',
        },
      ],
      priorityInputs: { S: 'medium', E: 'weak', C: null, R: 1 },
    });
    return out;
  },
};

// ---------------------------------------------------------------------------
// R8 - Data quality / submission inconsistency
// ---------------------------------------------------------------------------
export const R8: RuleDef = {
  id: 'R8',
  version: '1.0.0',
  title: 'Data quality or submission inconsistency',
  description:
    'Surfaces validation issues (invalid timestamps, duplicates, impossible ordering, orphan references) as data-quality findings distinct from operational weaknesses.',
  requires: [],
  run(ctx) {
    const out: FindingDraft[] = [];
    const orphanActions = ctx.actions.filter((a) => !ctx.cases.some((c) => c.id === a.caseId));
    const orphanEscalations = ctx.escalations.filter((e) => !ctx.cases.some((c) => c.id === e.caseId));
    const orphanAlertRefs = ctx.cases.flatMap((c) =>
      c.linkedAlertIds.filter((aid) => !ctx.alerts.some((al) => al.id === aid)).map((aid) => ({ case: c, alert: aid }))
    );
    const unmonitorable = ctx.alerts.filter((a) => a.assetId && !ctx.assets.some((x) => x.id === a.assetId));

    const problems: { label: string; value: string; count: number; refs: EvidenceDraft[] }[] = [];
    if (orphanActions.length > 0)
      problems.push({
        label: 'Investigation actions referencing unknown cases',
        value: String(orphanActions.length),
        count: orphanActions.length,
        refs: orphanActions.slice(0, 5).map((a) => actionRef(a, 'supporting')),
      });
    if (orphanEscalations.length > 0)
      problems.push({
        label: 'Escalations referencing unknown cases',
        value: String(orphanEscalations.length),
        count: orphanEscalations.length,
        refs: orphanEscalations.slice(0, 5).map((e) => escRef(e, 'supporting')),
      });
    if (orphanAlertRefs.length > 0)
      problems.push({
        label: 'Cases referencing unknown alerts',
        value: String(orphanAlertRefs.length),
        count: orphanAlertRefs.length,
        refs: orphanAlertRefs.slice(0, 5).map((x) => caseRef(x.case, 'supporting', `linked alert ${displayId(x.alert)} not found`)),
      });
    if (unmonitorable.length > 0)
      problems.push({
        label: 'Alerts referencing unknown assets',
        value: String(unmonitorable.length),
        count: unmonitorable.length,
        refs: unmonitorable.slice(0, 5).map((a) => alertRef(a, 'supporting')),
      });

    for (const prob of problems) {
      out.push({
        category: 'data_quality',
        ruleId: 'R8',
        ruleVersion: '1.0.0',
        ruleTitle: 'Data quality or submission inconsistency',
        severity: 'medium',
        evidenceStrength: 'strong',
        explanation:
          `${prob.label}: ${prob.value} record(s) in this submission fail referential consistency. ` +
          `These records are excluded from the specific analytics that depend on the broken reference. ` +
          `Data-quality issues are reported separately from operational SOC weaknesses.`,
        suggestedQuestions: [
          'Was the export generated with a filter that dropped referenced records?',
          'Can the organization re-submit corrected data?',
        ],
        limitations:
          'Cross-submission references (e.g. an alert in a previous period) are not treated as orphans here.',
        observed: [{ label: prob.label, value: prob.value }],
        params: {},
        evidence: prob.refs,
        priorityInputs: { S: 'medium', E: 'strong', C: null, R: prob.count },
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Negative-space: expected evidence category absent from a submission
// ---------------------------------------------------------------------------
export const NS_CATEGORY: RuleDef = {
  id: 'NS-CAT',
  version: '1.0.0',
  title: 'Expected evidence category absent from submission',
  description:
    'Flags evidence categories expected for a full submission that are entirely missing, ONLY when other categories were accepted (so the import itself demonstrably worked).',
  requires: [],
  run(ctx) {
    const out: FindingDraft[] = [];
    // Only assert negative space if the import pipeline worked (>= 3 categories present).
    if (ctx.completeness.presentCategories.length < 3) return out;
    for (const cat of ctx.completeness.missingCategories) {
      out.push({
        category: 'negative_space',
        ruleId: 'NS-CAT',
        ruleVersion: '1.0.0',
        ruleTitle: 'Expected evidence category absent from submission',
        severity: cat === 'cases' || cat === 'alerts' ? 'high' : cat === 'escalations' ? 'medium' : 'low',
        evidenceStrength: 'strong',
        explanation:
          `The submission for ${ctx.periodStart}..${ctx.periodEnd} contains no accepted ${cat} records, while other categories ` +
          `(${ctx.completeness.presentCategories.join(', ')}) imported successfully. A full submission is expected to include ` +
          `${cat} per the prototype's completeness baseline. The absence is a negative-space signal: either the records were not ` +
          `generated, not exported, or intentionally withheld - a reviewer must determine which.`,
        suggestedQuestions: [
          `Does the organization genuinely have no ${cat} records for this period?`,
          'Was the export filtered or truncated?',
          `Is ${cat} stored in a different system?`,
        ],
        limitations:
          'Expectation is defined by the prototype baseline (all six categories). Adjust per data-sharing agreement with the entity.',
        observed: [
          { label: 'Missing category', value: cat },
          { label: 'Present categories', value: ctx.completeness.presentCategories.join(', ') },
          { label: 'Period', value: `${ctx.periodStart} .. ${ctx.periodEnd}` },
        ],
        params: {},
        evidence: [
          {
            sourceRecordType: 'import_batch',
            sourceRecordId: ctx.submissionId,
            evidenceRole: 'supporting',
            note: 'Completeness report of this submission',
          },
        ],
        priorityInputs: { S: cat === 'cases' || cat === 'alerts' ? 'high' : 'medium', E: 'strong', C: null, R: 1 },
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------

export const ALL_RULES: RuleDef[] = [R1, R2, R3, R4, R5, R6, R7, R8, NS_CATEGORY];

/** displayId renders a record reference (or raw id) for human-readable output. */
export function displayId(rec: string | null | undefined | { id: string; sourceRecordId?: string }): string {
  if (rec == null) return 'unknown';
  if (typeof rec === 'string') return rec;
  return rec.sourceRecordId ?? rec.id;
}

function caseRef(c: Case, role: EvidenceDraft['evidenceRole'], note?: string): EvidenceDraft {
  return {
    sourceRecordType: 'case',
    sourceRecordId: c.id,
    sourceFileId: c.fileId,
    sourceRowRef: c.rowRef,
    evidenceRole: role,
    note,
  };
}
function alertRef(a: { id: string; fileId: string; rowRef: string }, role: EvidenceDraft['evidenceRole']): EvidenceDraft {
  return { sourceRecordType: 'alert', sourceRecordId: a.id, sourceFileId: a.fileId, sourceRowRef: a.rowRef, evidenceRole: role };
}
function actionRef(a: { id: string; fileId: string; rowRef: string }, role: EvidenceDraft['evidenceRole']): EvidenceDraft {
  return { sourceRecordType: 'action', sourceRecordId: a.id, sourceFileId: a.fileId, sourceRowRef: a.rowRef, evidenceRole: role };
}
function escRef(e: { id: string; fileId: string; rowRef: string }, role: EvidenceDraft['evidenceRole']): EvidenceDraft {
  return { sourceRecordType: 'escalation', sourceRecordId: e.id, sourceFileId: e.fileId, sourceRowRef: e.rowRef, evidenceRole: role };
}

function firstLinkedAssetCriticality(ctx: RuleContext, c: Case): AssetCriticality | null {
  for (const aid of c.linkedAlertIds) {
    const alert = ctx.alerts.find((a) => a.id === aid);
    if (!alert?.assetId) continue;
    const asset = ctx.assets.find((x) => x.id === alert.assetId);
    if (asset && asset.criticality !== 'unknown') return asset.criticality;
  }
  return null;
}
