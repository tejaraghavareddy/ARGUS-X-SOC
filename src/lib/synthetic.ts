// Synthetic dataset generator: fixed seed, deliberately seeded scenarios,
// separate ground-truth labels that never feed detection logic.

import { makeRng, addDays } from './util';
import type {
  Alert,
  Asset,
  AssetCriticality,
  Case,
  Entity,
  Escalation,
  InvestigationAction,
  Severity,
  TelemetryRecord,
} from './types';

export const DEMO_SEED = 424242;
export const DEMO_ENTITY_COUNT = 5;
export const DEMO_PERIOD_COUNT = 3; // consecutive 30-day periods

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
export const ALERT_FAMILIES = [
  'malware',
  'phishing',
  'intrusion_attempt',
  'data_exfil',
  'policy_violation',
  'ddos',
  'account_compromise',
];
export const ACTION_TYPES = [
  'triage',
  'enrichment',
  'containment',
  'forensics',
  'escalation_request',
  'remediation',
  'closure_review',
];
export const ESCALATION_DESTINATIONS = ['irt', 'management', 'legal', 'external_certs', 'upstream_soc'];

export interface GroundTruthLabel {
  id: string;
  scenario: string;
  entityId: string;
  description: string;
  /** Rule expected to fire on this scenario (informational for validation only). */
  expectedRule: string | null;
  /** A benign scenario that detection logic should NOT treat as misconduct. */
  benign: boolean;
}

export interface GeneratedDataset {
  seed: number;
  generatedAt: string;
  generatorVersion: string;
  entities: Entity[];
  periods: { start: string; end: string; label: string }[];
  assets: Asset[];
  alerts: Alert[];
  cases: Case[];
  actions: InvestigationAction[];
  escalations: Escalation[];
  telemetry: TelemetryRecord[];
  groundTruth: GroundTruthLabel[];
  scenarioIndex: Map<string, string[]>;
}

const ENTITY_BLUEPRINTS = [
  { name: 'Northern Power Grid Co', sector: 'Energy', peerGroup: 'utilities' },
  { name: 'Bharat Water Supply Corp', sector: 'Water', peerGroup: 'utilities' },
  { name: 'Meridian Transport Authority', sector: 'Transport', peerGroup: 'transport' },
  { name: 'Harbor Bank of India', sector: 'Banking', peerGroup: 'finance' },
  { name: 'Central Health Services Trust', sector: 'Healthcare', peerGroup: 'health' },
];

function isoAt(dayIso: string, hour: number, minute: number): string {
  return `${dayIso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
}

function pickSeverity(rng: Rng, weights: number[]): Severity {
  const r = rng.next();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return SEVERITIES[i];
  }
  return 'info';
}

type Rng = ReturnType<typeof makeRng>;

/**
 * Generate the demonstration dataset. Same seed => same records.
 * Ground truth is kept separate; detection logic never receives these labels.
 */
export function generateDataset(seed: number = DEMO_SEED): GeneratedDataset {
  const rng = makeRng(seed);
  const generatedAt = '2026-01-15T09:00:00Z'; // fixed for reproducibility
  const groundTruth: GroundTruthLabel[] = [];
  const scenarioIndex = new Map<string, string[]>();
  const remember = (scenario: string, ids: string[]) => {
    scenarioIndex.set(scenario, ids);
  };

  const entities: Entity[] = ENTITY_BLUEPRINTS.slice(0, DEMO_ENTITY_COUNT).map((b, i) => ({
    id: `ENT-0${i + 1}`,
    name: b.name,
    sector: b.sector,
    peerGroup: b.peerGroup,
    createdAt: generatedAt,
  }));

  const periods = Array.from({ length: DEMO_PERIOD_COUNT }, (_, i) => {
    const start = addDays('2025-10-01', i * 30);
    const end = addDays(start, 29);
    return { start, end, label: `P${i + 1} (${start}..${end})` };
  });

  const assets: Asset[] = [];
  const alerts: Alert[] = [];
  const cases: Case[] = [];
  const actions: InvestigationAction[] = [];
  const escalations: Escalation[] = [];
  const telemetry: TelemetryRecord[] = [];

  entities.forEach((entity, eIdx) => {
    // Entity behavior profile: 1 healthy, 1 with incomplete final submission,
    // others normal with seeded scenarios.
    const behaviorProfile = eIdx === 4 ? 'healthy' : eIdx === 1 ? 'incomplete_final' : 'normal';
    // ENT-02's final period is a deliberately incomplete, low-activity submission
    // (S7/S10): tests that analytics do not mistake an incomplete submission for
    // a quiet SOC.
    const caseVolume = eIdx === 1 ? [12, 14, 4] : eIdx === 0 ? [22, 24, 21] : [18, 17, 19];

    periods.forEach((period, pIdx) => {
      const submissionId = `SUB-${entity.id}-P${pIdx + 1}`;
      const fileId = `F-${entity.id}-P${pIdx + 1}`;

      // ---- Assets -------------------------------------------------------
      const assetCount = eIdx === 0 ? 26 : 18;
      const assetIds: string[] = [];
      for (let a = 0; a < assetCount; a++) {
        const criticality: AssetCriticality = a < 4 ? 'critical' : a < 10 ? 'high' : a < 15 ? 'medium' : 'low';
        // Only the first 10 assets (critical/high) are monitored; medium/low
        // assets are explicitly monitoring_expected=false so R5 has a defined
        // expectation boundary and does not flood findings.
        const asset: Asset = {
          id: `AS-${entity.id}-${pIdx + 1}-${a + 1}`,
          entityId: entity.id,
          submissionId,
          criticality,
          monitoringExpected: a < 10 ? true : false,
          assetType: rng.pick(['scada_hmi', 'server', 'workstation', 'firewall', 'database', 'sensor']),
          sourceRecordId: `${fileId}:asset:${a + 1}`,
          fileId,
          rowRef: `assets.csv#L${a + 2}`,
        };
        assets.push(asset);
        assetIds.push(asset.id);
      }
      const monitoredAssets = assetIds.filter((_, i) => i < 10);

      // ---- Alerts -------------------------------------------------------
      const alertCount = Math.round(caseVolume[pIdx] * 6);
      for (let i = 0; i < alertCount; i++) {
        const assetId = rng.chance(0.85) ? rng.pick(monitoredAssets) : null;
        const severity = pickSeverity(rng, [0.05, 0.15, 0.3, 0.35, 0.15]);
        const dayOffset = rng.int(0, 29);
        const openedAt = isoAt(addDays(period.start, dayOffset), rng.int(0, 23), rng.int(0, 59));
        const family = rng.pick(ALERT_FAMILIES);
        const status = rng.chance(0.82) ? 'closed' : 'open';
        alerts.push({
          id: `AL-${entity.id}-P${pIdx + 1}-${i + 1}`,
          entityId: entity.id,
          submissionId,
          assetId,
          severity,
          openedAt,
          closedAt: status === 'closed' ? isoAt(addDays(period.start, dayOffset), rng.int(0, 23), rng.int(0, 59)) : null,
          status,
          disposition: status === 'closed' ? rng.pick(['true_positive', 'false_positive', 'benign']) : 'pending',
          sourceRecordId: `${fileId}:alert:${i + 1}`,
          fileId,
          rowRef: `alerts.csv#L${i + 2}`,
          alertFamily: family,
        });
      }

      // ---- Cases + related evidence --------------------------------------
      const periodCases: Case[] = [];
      for (let c = 0; c < caseVolume[pIdx]; c++) {
        const severity = pickSeverity(rng, [0.12, 0.2, 0.3, 0.25, 0.13]);
        const openedDay = rng.int(0, 25);
        const openedAt = isoAt(addDays(period.start, openedDay), rng.int(0, 23), rng.int(0, 59));
        const existing = alerts.filter((al) => al.submissionId === submissionId);
        const startIdx = existing.length > 3 ? rng.int(0, existing.length - 3) : 0;
        const linked = existing
          .slice(startIdx, startIdx + rng.int(1, 3))
          .map((al) => al.id);
        const caseRec: Case = {
          id: `CS-${entity.id}-P${pIdx + 1}-${c + 1}`,
          entityId: entity.id,
          submissionId,
          severity,
          status: 'closed',
          openedAt,
          closedAt: null,
          linkedAlertIds: linked,
          category: rng.pick(['intrusion', 'malware', 'abuse', 'availability', 'policy']),
          automated: false,
          sourceRecordId: `${fileId}:case:${c + 1}`,
          fileId,
          rowRef: `cases.csv#L${c + 2}`,
        };
        periodCases.push(caseRec);
        cases.push(caseRec);

        // Investigation actions: normal closure takes 2-6 actions with varied,
        // case-specific narratives (so R6 only fires on the seeded copy-paste
        // scenario, not on templated-but-distinct records).
        const durationDays = rng.int(2, 8);
        const actionCount = rng.int(2, 6);
        const detailA = rng.pick(['proxy logs', 'EDR telemetry', 'DNS records', 'VPN session data', 'email headers', 'firewall logs']);
        const detailB = rng.pick(['the affected host', 'the service account', 'the jump server', 'the mail gateway', 'the build agent']);
        for (let ai = 0; ai < actionCount; ai++) {
          actions.push({
            id: `AC-${caseRec.id}-${ai + 1}`,
            entityId: entity.id,
            submissionId,
            caseId: caseRec.id,
            actionType: ACTION_TYPES[Math.min(ai, ACTION_TYPES.length - 1)],
            actionAt: isoAt(addDays(period.start, Math.min(29, openedDay + ai)), rng.int(0, 23), rng.int(0, 59)),
            actionDescription: `${caseRec.category} case: triaged ${detailA}, queried ${detailB}, confirmed ${rng.pick(['two indicators', 'no persistence', 'a config drift', 'one account lockout', 'routing anomalies'])}; disposition ${rng.pick(['documented', 'pending approval', 'assigned to asset owner'])}.`,
            investigatorReference: `INV-${entity.id}-${rng.int(1, 9)}`,
            sourceRecordId: `${fileId}:action:${caseRec.id}:${ai + 1}`,
            fileId,
            rowRef: `actions.csv#L${actions.length + 2}`,
          });
        }
        // S10: the incomplete final submission of ENT-02 omits the escalations
        // evidence category entirely even though it contains high-severity cases.
        const suppressEscalations = behaviorProfile === 'incomplete_final' && pIdx === 2;
        if (!suppressEscalations && (severity === 'critical' || severity === 'high')) {
          escalations.push({
            id: `ES-${caseRec.id}`,
            entityId: entity.id,
            submissionId,
            caseId: caseRec.id,
            destination: rng.pick(ESCALATION_DESTINATIONS),
            escalatedAt: isoAt(addDays(period.start, openedDay), 23, 30),
            status: 'accepted',
            sourceRecordId: `${fileId}:esc:${caseRec.id}`,
            fileId,
            rowRef: `escalations.csv#L${escalations.length + 2}`,
          });
        }
        caseRec.closedAt = isoAt(addDays(period.start, Math.min(29, openedDay + durationDays)), 17, 45);
      }
      void periodCases;

      // ---- Telemetry coverage -------------------------------------------
      for (const assetId of monitoredAssets) {
        telemetry.push({
          id: `TL-${assetId}`,
          entityId: entity.id,
          submissionId,
          assetId,
          lastSeenAt: isoAt(period.end, 20, 0),
          sourceRecordId: `${fileId}:telemetry:${assetId}`,
          fileId,
          rowRef: `telemetry.csv#L${telemetry.length + 2}`,
        });
      }

      // ================= Seeded scenarios (fixed per entity/period) =========
      if (behaviorProfile !== 'healthy') {
        // S1 (R1): critical case closed fast, no actions, NOT automated.
        if (pIdx === 1) {
          const s1 = periodCases[rng.int(0, periodCases.length - 1)];
          const caseId = `CS-${entity.id}-P2-77`;
          const c: Case = {
            ...s1,
            id: caseId,
            severity: 'critical',
            openedAt: isoAt(addDays(period.start, 5), 8, 15),
            closedAt: isoAt(addDays(period.start, 5), 9, 40),
            automated: false,
            status: 'closed',
            sourceRecordId: `${fileId}:case:77`,
            rowRef: 'cases.csv#L78',
          };
          cases.push(c);
          remember('S1_fast_closure_no_actions', [caseId]);
          groundTruth.push({
            id: `GT-${entity.id}-P2-S1`,
            scenario: 'S1_fast_closure_no_actions',
            entityId: entity.id,
            description: 'Critical case closed in 85 minutes with zero investigation actions; not marked automated.',
            expectedRule: 'R1',
            benign: false,
          });
        }

        // S2 (R2): high-severity case with no escalation record.
        if (pIdx === 0) {
          const caseId = `CS-${entity.id}-P1-88`;
          const c: Case = {
            id: caseId,
            entityId: entity.id,
            submissionId,
            severity: 'high',
            status: 'closed',
            openedAt: isoAt(addDays(period.start, 12), 10, 0),
            closedAt: isoAt(addDays(period.start, 14), 16, 0),
            linkedAlertIds: [],
            category: 'intrusion',
            automated: false,
            sourceRecordId: `${fileId}:case:88`,
            fileId,
            rowRef: 'cases.csv#L89',
          };
          cases.push(c);
          remember('S2_escalation_missing', [caseId]);
          groundTruth.push({
            id: `GT-${entity.id}-P1-S2`,
            scenario: 'S2_escalation_missing',
            entityId: entity.id,
            description: 'High-severity intrusion case closed with no escalation record anywhere in the submission.',
            expectedRule: 'R2',
            benign: false,
          });
        }

        // S3 (R3): medium case with zero investigation actions, open > 20 days.
        if (pIdx === 2) {
          const caseId = `CS-${entity.id}-P3-99`;
          const c: Case = {
            id: caseId,
            entityId: entity.id,
            submissionId,
            severity: 'medium',
            status: 'open',
            openedAt: isoAt(addDays(period.start, 3), 9, 0),
            closedAt: null,
            linkedAlertIds: [],
            category: 'policy',
            automated: false,
            sourceRecordId: `${fileId}:case:99`,
            fileId,
            rowRef: 'cases.csv#L100',
          };
          cases.push(c);
          remember('S3_investigation_missing', [caseId]);
          groundTruth.push({
            id: `GT-${entity.id}-P3-S3`,
            scenario: 'S3_investigation_missing',
            entityId: entity.id,
            description: 'Open case for 27 days with no investigation action recorded.',
            expectedRule: 'R3',
            benign: false,
          });
        }
      }

      // S4 (R4): repeated alerts, same asset+family, no remediation.
      // Uses a dedicated scenario asset so random alerts/cases cannot add
      // remediation evidence to the group and break the deterministic seed.
      if (eIdx === 0 && pIdx === 1) {
        const scenarioAssetId = `AS-${entity.id}-P2-S4`;
        assets.push({
          id: scenarioAssetId,
          entityId: entity.id,
          submissionId,
          criticality: 'critical',
          monitoringExpected: true,
          assetType: 'server',
          sourceRecordId: `${fileId}:asset:S4`,
          fileId,
          rowRef: 'assets.csv#LS4',
        });
        telemetry.push({
          id: `TL-${scenarioAssetId}`,
          entityId: entity.id,
          submissionId,
          assetId: scenarioAssetId,
          lastSeenAt: isoAt(period.end, 20, 0),
          sourceRecordId: `${fileId}:telemetry:S4`,
          fileId,
          rowRef: 'telemetry.csv#LS4',
        });
        const baseDay = 8;
        const ids: string[] = [];
        for (let i = 0; i < 7; i++) {
          const id = `AL-${entity.id}-P2-S4-${i + 1}`;
          alerts.push({
            id,
            entityId: entity.id,
            submissionId,
            assetId: scenarioAssetId,
            severity: 'high',
            openedAt: isoAt(addDays(period.start, baseDay + i), 3 + (i % 4), 10),
            closedAt: isoAt(addDays(period.start, baseDay + i), 4, 10),
            status: 'closed',
            disposition: 'true_positive',
            sourceRecordId: `${fileId}:alert:S4-${i + 1}`,
            fileId,
            rowRef: `alerts.csv#LS4-${i + 1}`,
            alertFamily: 'intrusion_attempt',
          });
          ids.push(id);
        }
        remember('S4_recurring_alerts', ids);
        groundTruth.push({
          id: `GT-${entity.id}-P2-S4`,
          scenario: 'S4_recurring_alerts',
          entityId: entity.id,
          description: '7 intrusion_attempt alerts on the same critical asset over 7 days; no remediation evidence linked.',
          expectedRule: 'R4',
          benign: false,
        });
      }

      // S5 (R5): critical asset with monitoring expected but no telemetry.
      if (eIdx === 2 && pIdx === 0) {
        const assetId = `AS-${entity.id}-1-1`; // critical asset present in inventory
        remember('S5_monitoring_gap', [assetId]);
        groundTruth.push({
          id: `GT-${entity.id}-P1-S5`,
          scenario: 'S5_monitoring_gap',
          entityId: entity.id,
          description: 'Critical asset AS-MTA-1-1 (monitoring expected) has no telemetry record in period P1.',
          expectedRule: 'R5',
          benign: false,
        });
      }

      // S6 (R6): repetitive investigation notes across unrelated cases.
      if (eIdx === 3 && pIdx === 1) {
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
          const caseId = `CS-${entity.id}-P2-5${i}`;
          const c: Case = {
            id: caseId,
            entityId: entity.id,
            submissionId,
            severity: 'medium',
            status: 'closed',
            openedAt: isoAt(addDays(period.start, 4 + i), 9, 0),
            closedAt: isoAt(addDays(period.start, 5 + i), 15, 0),
            linkedAlertIds: [],
            category: rng.pick(['malware', 'abuse', 'availability']), // deliberately unrelated categories
            automated: false,
            sourceRecordId: `${fileId}:case:5${i}`,
            fileId,
            rowRef: `cases.csv#L5${i}`,
          };
          cases.push(c);
          actions.push({
            id: `AC-${caseId}-1`,
            entityId: entity.id,
            submissionId,
            caseId,
            actionType: 'forensics',
            actionAt: isoAt(addDays(period.start, 5 + i), 12, 0),
            actionDescription:
              'Collected volatile memory, imaged the endpoint, reviewed network flow records, interviewed the assigned administrator, documented indicators, updated the runbook, restored the affected service, and recorded lessons learned in the closure summary.',
            investigatorReference: `INV-${entity.id}-1`,
            sourceRecordId: `${fileId}:action:${caseId}:1`,
            fileId,
            rowRef: `actions.csv#L${actions.length + 2}`,
          });
          ids.push(caseId);
        }
        remember('S6_repetitive_notes', ids);
        groundTruth.push({
          id: `GT-${entity.id}-P2-S6`,
          scenario: 'S6_repetitive_notes',
          entityId: entity.id,
          description: 'Five cases in unrelated categories share near-identical investigation narratives.',
          expectedRule: 'R6',
          benign: false,
        });
      }

      // S7: low activity caused by a deliberately incomplete submission.
      // This is a false-positive trap: R7 must NOT report low activity as a
      // potential SOC weakness when completeness checks show the submission
      // itself is missing data; the data-quality path must flag it instead.
      if (behaviorProfile === 'incomplete_final' && pIdx === 2) {
        groundTruth.push({
          id: `GT-${entity.id}-P3-S7`,
          scenario: 'S7_low_activity_incomplete_trap',
          entityId: entity.id,
          description:
            'Alert volume in P3 is far below the entity baseline, but the submission is also missing the escalations category. Expected outcome: no R7 low-activity finding; a missing-evidence-category finding instead.',
          expectedRule: null,
          benign: true,
        });
      }

      // S8 (R8): duplicate alert IDs and an invalid timestamp.
      if (eIdx === 1 && pIdx === 1) {
        remember('S8_data_quality', [`AL-${entity.id}-P2-dup1`, `AL-${entity.id}-P2-badts`]);
        groundTruth.push({
          id: `GT-${entity.id}-P2-S8`,
          scenario: 'S8_data_quality',
          entityId: entity.id,
          description: 'Submission contains a duplicated alert ID and an invalid timestamp in alerts.csv.',
          expectedRule: 'R8',
          benign: false,
        });
      }

      // S9: benign automated closure (false-positive trap for R1).
      if (eIdx === 4 && pIdx === 1) {
        const caseId = `CS-${entity.id}-P2-auto`;
        const c: Case = {
          id: caseId,
          entityId: entity.id,
          submissionId,
          severity: 'critical',
          status: 'closed',
          openedAt: isoAt(addDays(period.start, 7), 2, 10),
          closedAt: isoAt(addDays(period.start, 7), 2, 42),
          linkedAlertIds: [],
          category: 'malware',
          automated: true,
          sourceRecordId: `${fileId}:case:auto`,
          fileId,
          rowRef: 'cases.csv#Lauto',
        };
        cases.push(c);
        // Automated playbook action: gives R3 an explicit automation marker so
        // the benign case does not double as a false positive there either.
        actions.push({
          id: `AC-${caseId}-auto`,
          entityId: entity.id,
          submissionId,
          caseId,
          actionType: 'containment',
          actionAt: isoAt(addDays(period.start, 7), 2, 40),
          actionDescription: 'Automated containment playbook isolated the affected host and removed the malicious scheduled task; no analyst action required.',
          investigatorReference: 'PLAYBOOK-AUTO',
          sourceRecordId: `${fileId}:action:auto`,
          fileId,
          rowRef: 'actions.csv#Lauto',
        });
        remember('S9_benign_automated_closure', [caseId]);
        groundTruth.push({
          id: `GT-${entity.id}-P2-S9`,
          scenario: 'S9_benign_automated_closure',
          entityId: entity.id,
          description:
            'Critical case closed automatically in 32 minutes (automated containment playbook). Benign; R1 must not flag it, and R2/R3 must treat the automation as the documented legitimate explanation.',
          expectedRule: 'R1',
          benign: true,
        });
      }
    });

    // Missing escalation category in the final submission of the incomplete entity.
    if (behaviorProfile === 'incomplete_final' && periods.length >= 3) {
      const p3 = periods[2];
      void p3;
      groundTruth.push({
        id: `GT-${entity.id}-P3-S10`,
        scenario: 'S10_missing_evidence_category',
        entityId: entity.id,
        description: 'Final period submission omits the escalations evidence category entirely (negative space).',
        expectedRule: 'NS-CAT',
        benign: false,
      });
    }
  });

  // Remove S5 telemetry record: ENT-03 P1 has no telemetry for its critical asset.
  const s5Entity = entities[2];
  const s5SubmissionId = `SUB-${s5Entity.id}-P1`;
  const idx = telemetry.findIndex((t) => t.submissionId === s5SubmissionId && t.assetId === `AS-${s5Entity.id}-1-1`);
  if (idx >= 0) telemetry.splice(idx, 1);
  // Also remove the S5 asset from any alert linkage (it can still have telemetry removed only).

  return {
    seed,
    generatedAt,
    generatorVersion: '1.0.0',
    entities,
    periods,
    assets,
    alerts,
    cases,
    actions,
    escalations,
    telemetry,
    groundTruth,
    scenarioIndex,
  };
}
