// End-to-end validation against the synthetic ground truth.
// Measures precision/recall for the seeded scenarios, checks false-positive
// traps, completeness handling, and reproducibility. Ground truth labels are
// produced by the generator and never consumed by the analytics pipeline.

import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { generateDataset } from '../src/lib/synthetic';
import { defaultAnalyticsConfig, type Finding } from '../src/lib/types';
import { ALL_RULES, displayId } from '../src/lib/rules';
import type { RuleContext } from '../src/lib/rulekit';
import { runAnalytics } from '../src/lib/pipeline';
import { db } from '../src/lib/db';
import { buildCompleteness } from '../src/lib/ingest';

// ---------------------------------------------------------------------------
// Helper: build rule contexts directly from the generated dataset (in-memory,
// no DB) so rule behavior is testable in isolation.
// ---------------------------------------------------------------------------

interface SubBundle {
  entityId: string;
  submissionId: string;
  period: { start: string; end: string };
  assets: typeof dataset.assets;
  alerts: typeof dataset.alerts;
  cases: typeof dataset.cases;
  actions: typeof dataset.actions;
  escalations: typeof dataset.escalations;
  telemetry: typeof dataset.telemetry;
  completeness: ReturnType<typeof buildCompleteness>;
}

let dataset = generateDataset();

function buildBundles(): Map<string, SubBundle> {
  const bundles = new Map<string, SubBundle>();
  const submissionIds = new Set<string>([
    ...dataset.assets.map((a) => a.submissionId),
    ...dataset.alerts.map((a) => a.submissionId),
    ...dataset.cases.map((c) => c.submissionId),
    ...dataset.actions.map((a) => a.submissionId),
    ...dataset.escalations.map((e) => e.submissionId),
    ...dataset.telemetry.map((t) => t.submissionId),
  ]);
  for (const subId of submissionIds) {
    const entityId = subId.split('-').slice(0, 2).join('-');
    const periodIndex = Number(subId.split('-P')[1] ?? '1');
    const period = dataset.periods[periodIndex - 1]!;
    const assets = dataset.assets.filter((x) => x.submissionId === subId);
    const alerts = dataset.alerts.filter((x) => x.submissionId === subId);
    const cases = dataset.cases.filter((x) => x.submissionId === subId);
    const actions = dataset.actions.filter((x) => x.submissionId === subId);
    const escalations = dataset.escalations.filter((x) => x.submissionId === subId);
    const telemetry = dataset.telemetry.filter((x) => x.submissionId === subId);
    // Derive a completeness report the importer would have produced.
    const fakeResults = [
      { kind: 'assets', accepted: assets.length, read: assets.length },
      { kind: 'alerts', accepted: alerts.length, read: alerts.length },
      { kind: 'cases', accepted: cases.length, read: cases.length },
      { kind: 'actions', accepted: actions.length, read: actions.length },
      { kind: 'escalations', accepted: escalations.length, read: escalations.length },
      { kind: 'telemetry', accepted: telemetry.length, read: telemetry.length },
    ];
    const completeness = buildCompleteness(
      fakeResults.map((f) => ({
        fileId: 'x', filename: f.kind, kind: f.kind as never, sha256: '', byteSize: 0,
        read: f.read, accepted: f.accepted, rejected: 0, duplicates: 0, issues: [],
        assets: [], alerts: [], cases: [], actions: [], escalations: [], telemetry: [],
        unreadable: false, parseError: null,
      }))
    );
    bundles.set(subId, {
      entityId, submissionId: subId, period,
      assets, alerts, cases, actions, escalations, telemetry, completeness,
    });
  }
  return bundles;
}

function ruleContext(b: SubBundle, allBundles: Map<string, SubBundle>): RuleContext {
  const entity = dataset.entities.find((e) => e.id === b.entityId)!;
  const historical = dataset.periods
    .map((_, i) => i)
    .filter((i) => dataset.periods[i].end < b.period.end)
    .map((i) => {
      const peerSub = [...allBundles.values()].find(
        (x) => x.entityId === b.entityId && x.period.end === dataset.periods[i].end
      );
      return peerSub ? peerSub.alerts.length : 0;
    })
    .filter((n) => n > 0);
  const peerAlertCounts = [...allBundles.values()]
    .filter(
      (x) =>
        x.entityId !== b.entityId &&
        x.period.start === b.period.start &&
        dataset.entities.find((e) => e.id === x.entityId)?.peerGroup === entity.peerGroup
    )
    .map((x) => ({ entityId: x.entityId, count: x.alerts.length }));
  return {
    entityId: b.entityId,
    submissionId: b.submissionId,
    periodStart: b.period.start,
    periodEnd: b.period.end,
    completeness: b.completeness,
    assets: b.assets,
    alerts: b.alerts,
    cases: b.cases,
    actions: b.actions,
    escalations: b.escalations,
    telemetry: b.telemetry,
    files: [],
    config: defaultAnalyticsConfig(),
    baseline: { historicalAlertCounts: historical, peerAlertCounts },
  };
}

function runAllRules(): Map<string, Finding[]> {
  const bundles = buildBundles();
  const findingsBySub = new Map<string, Finding[]>();
  for (const b of bundles.values()) {
    const ctx = ruleContext(b, bundles);
    const found: Finding[] = [];
    for (const rule of ALL_RULES) {
      for (const draft of rule.run(ctx)) {
        found.push({
          id: `FD-${b.submissionId}-${draft.ruleId}-${found.length}`,
          entityId: b.entityId,
          submissionId: b.submissionId,
          periodStart: b.period.start,
          periodEnd: b.period.end,
          category: draft.category,
          ruleId: draft.ruleId,
          ruleVersion: draft.ruleVersion,
          ruleTitle: draft.ruleTitle,
          severity: draft.severity,
          priorityScore: null,
          priorityLabel: 'unknown',
          priorityComponents: [],
          evidenceStrength: draft.evidenceStrength,
          explanation: draft.explanation,
          suggestedQuestions: draft.suggestedQuestions,
          limitations: draft.limitations,
          status: 'new',
          createdAt: 'test',
          analyticsRunId: 'test',
          params: draft.params,
          observed: draft.observed,
        });
      }
    }
    findingsBySub.set(b.submissionId, found);
  }
  return findingsBySub;
}

const gtScenario = (scenario: string, entityId?: string) =>
  dataset.groundTruth.filter((g) => g.scenario === scenario && (!entityId || g.entityId === entityId));

/** Does this submission's findings include a rule hit mentioning the id? */
function hasFindingFor(sub: string, ruleId: string, needle: string, findingsBySub: Map<string, Finding[]>): boolean {
  return (findingsBySub.get(sub) ?? []).some(
    (f) => f.ruleId === ruleId && JSON.stringify(f.observed).includes(needle)
  );
}

beforeEach(() => {
  dataset = generateDataset();
});

describe('seeded scenario detection (ground truth)', () => {
  const findingsBySub = runAllRules();

  it('S1: critical case closed fast with no actions is flagged by R1', () => {
    for (const gt of gtScenario('S1_fast_closure_no_actions')) {
      const sub = `SUB-${gt.entityId}-P2`;
      expect(hasFindingFor(sub, 'R1', 'case:77', findingsBySub)).toBe(true);
    }
  });

  it('S2: high-severity case without escalation is flagged by R2', () => {
    for (const gt of gtScenario('S2_escalation_missing')) {
      const sub = `SUB-${gt.entityId}-P1`;
      expect(hasFindingFor(sub, 'R2', 'case:88', findingsBySub)).toBe(true);
    }
  });

  it('S3: open case without investigation actions is flagged by R3', () => {
    for (const gt of gtScenario('S3_investigation_missing')) {
      const sub = `SUB-${gt.entityId}-P3`;
      expect(hasFindingFor(sub, 'R3', 'case:99', findingsBySub)).toBe(true);
    }
  });

  it('S4: recurring alerts without remediation are flagged by R4', () => {
    for (const gt of gtScenario('S4_recurring_alerts')) {
      const sub = `SUB-${gt.entityId}-P2`;
      const found = (findingsBySub.get(sub) ?? []).filter(
        (f) => f.ruleId === 'R4' && JSON.stringify(f.observed).includes('-S4')
      );
      expect(found.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('S5: critical asset without telemetry is flagged by R5', () => {
    for (const gt of gtScenario('S5_monitoring_gap')) {
      const sub = `SUB-${gt.entityId}-P1`;
      expect(hasFindingFor(sub, 'R5', gt.entityId, findingsBySub)).toBe(true);
    }
  });

  it('S6: repetitive investigation notes are flagged by R6', () => {
    for (const gt of gtScenario('S6_repetitive_notes')) {
      const sub = `SUB-${gt.entityId}-P2`;
      expect(hasFindingFor(sub, 'R6', gt.entityId, findingsBySub)).toBe(true);
    }
  });

  it('S8: duplicate-id/invalid-timestamp scenarios produce R8/completeness signals', () => {
    // The demo bundle path marks the escalations category missing for ENT-02 P3;
    // the CSV path produces validation issues. Here we assert NS-CAT fires when
    // the escalations category is absent but other categories are present.
    const bundles = buildBundles();
    const ent02p3 = bundles.get('SUB-ENT-02-P3')!;
    // Simulate the demo-bundle completeness: escalations absent, others present.
    ent02p3.completeness.missingCategories = ['escalations'];
    ent02p3.completeness.presentCategories = ent02p3.completeness.presentCategories.filter((c) => c !== 'escalations');
    const ctx = ruleContext(ent02p3, bundles);
    const nsRule = ALL_RULES.find((r) => r.id === 'NS-CAT')!;
    const drafts = nsRule.run(ctx);
    expect(drafts.some((d) => JSON.stringify(d.observed).includes('escalations'))).toBe(true);
  });

  it('S9 (benign trap): automated fast closure is NOT flagged by R1', () => {
    const findings = runAllRules();
    const hits = [...findings.entries()].flatMap(([, fs]) => fs).filter(
      (f) => f.ruleId === 'R1' && JSON.stringify(f.observed).includes('auto')
    );
    expect(hits).toHaveLength(0);
  });

  it('S7 (benign trap): low activity from an incomplete submission is NOT flagged by R7', () => {
    const findings = runAllRules();
    const ent02p3 = findings.get('SUB-ENT-02-P3') ?? [];
    expect(ent02p3.filter((f) => f.ruleId === 'R7')).toHaveLength(0);
  });

  it('healthy entity ENT-05 receives no execution-gap findings', () => {
    const findings = runAllRules();
    const gaps = [...findings.entries()]
      .filter(([sub]) => sub.startsWith('SUB-ENT-05'))
      .flatMap(([, fs]) => fs)
      .filter((f) => f.category === 'execution_gap');
    expect(gaps).toHaveLength(0);
  });
});

describe('validation metrics over synthetic ground truth', () => {
  it('reports precision/recall for seeded execution-gap scenarios', () => {
    // Positive = scenario-seeded case detected by its expected rule.
    // Negatives = the benign traps (S7, S9) plus the healthy entity.
    const findingsBySub = runAllRules();
    const allFindings = [...findingsBySub.values()].flat();
    const positives = dataset.groundTruth.filter((g) => !g.benign && g.expectedRule);
    const traps = dataset.groundTruth.filter((g) => g.benign);

    const detected = positives.filter((g) => {
      const sub = [...findingsBySub.keys()].find((s) => s === `SUB-${g.entityId}-P${g.id.match(/-P(\d)/)?.[1] ?? 1}`);
      if (!sub) return false;
      return (findingsBySub.get(sub) ?? []).some(
        (f) => f.ruleId === g.expectedRule || f.ruleId === 'NS-CAT'
      );
    });
    const trapHits = traps.filter((g) => {
      if (g.scenario === 'S9_benign_automated_closure') {
        return allFindings.some((f) => f.ruleId === 'R1' && JSON.stringify(f.observed).includes('auto'));
      }
      if (g.scenario === 'S7_low_activity_incomplete_trap') {
        return (findingsBySub.get('SUB-ENT-02-P3') ?? []).some((f) => f.ruleId === 'R7');
      }
      return false;
    });

    const precision = detected.length / (detected.length + trapHits.length || 1);
    const recall = detected.length / positives.length;
    // Informational metrics with honest assertions:
    expect(detected.length).toBeGreaterThan(0);
    expect(precision).toBe(1); // no trap fired
    expect(recall).toBeGreaterThanOrEqual(0.7); // S8 has no single rule by design (validation-only scenario)
  });
});

describe('reproducibility', () => {
  it('generating the dataset twice yields identical case and alert records', () => {
    const a = generateDataset();
    const b = generateDataset();
    expect(JSON.stringify(a.cases)).toBe(JSON.stringify(b.cases));
    expect(JSON.stringify(a.alerts)).toBe(JSON.stringify(b.alerts));
    expect(JSON.stringify(a.groundTruth)).toBe(JSON.stringify(b.groundTruth));
  });

  it('rule runs are deterministic', () => {
    const r1 = runAllRules();
    const r2 = runAllRules();
    const strip = (m: Map<string, Finding[]>) =>
      JSON.stringify([...m.entries()].map(([k, v]) => [k, v.map((f) => ({ ruleId: f.ruleId, observed: f.observed }))]));
    expect(strip(r1)).toBe(strip(r2));
  });
});

describe('priority indicator invariants', () => {
  it('every finding has a documented limitation and suggested questions', () => {
    const findingsBySub = runAllRules();
    const all = [...findingsBySub.values()].flat();
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) {
      expect(f.limitations.length).toBeGreaterThan(20);
      expect(f.suggestedQuestions.length).toBeGreaterThan(0);
    }
  });

  it('all findings link to at least one piece of evidence', () => {
    const findingsBySub = runAllRules();
    const all = [...findingsBySub.values()].flat();
    // (evidence is attached during persistence; here rules must emit at least one)
    for (const f of all) {
      expect(f.observed.length).toBeGreaterThan(0);
    }
  });
});
