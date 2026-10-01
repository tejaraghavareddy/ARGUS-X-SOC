// Settings: rule configuration (prototype thresholds), reviewer identity,
// and workspace reset. All values are documented prototype defaults.

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { defaultAnalyticsConfig, SOFTWARE_VERSION } from '../lib/types';
import type { AnalyticsConfig } from '../lib/types';
import { resetWorkspace } from '../lib/db';
import { recordAudit } from '../lib/db';

const RULE_DESCRIPTIONS: Record<string, string> = {
  R1: 'Critical case closed unusually quickly without investigation evidence.',
  R2: 'Required escalation record missing for a case whose severity class requires escalation.',
  R3: 'Investigation evidence missing for a case expected to be investigated.',
  R4: 'Recurring alerts on the same asset without documented remediation.',
  R5: 'Expected monitoring/telemetry record missing for an asset marked monitoring_expected.',
  R6: 'Repetitive investigation narratives across cases (TF-IDF + cosine similarity).',
  R7: 'Unusually low activity compared with entity/peer baselines (suppressed when completeness fails).',
  R8: 'Data quality or submission inconsistency (orphans, duplicates, invalid timestamps).',
  'NS-CAT': 'Negative space: expected evidence category absent from a submission.',
};

const PARAM_LABELS: Record<string, string> = {
  fastClosureHours: 'Fast-closure threshold (hours)',
  minActionsForEvidence: 'Minimum investigation actions expected',
  requireEscalationForSeverities: 'Severities requiring escalation (comma-separated)',
  recurrenceThreshold: 'Recurrence threshold (alerts)',
  windowHours: 'Recurrence window (hours)',
  minInventoryCoverage: 'Min. telemetry feed coverage (fraction)',
  similarityThreshold: 'Text similarity threshold (0-1)',
  minCases: 'Minimum cases in a similarity cluster',
  lowFactor: 'Low-activity factor (vs comparison median)',
  minPeerRecords: 'Minimum comparison values required',
  longOpenDays: 'Long-open case threshold (days)',
};

export default function SettingsPage() {
  const [config, setConfig] = useState<AnalyticsConfig>(() => defaultAnalyticsConfig());
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [reviewer, setReviewer] = useState(() => localStorage.getItem('argus.lastReviewer') ?? '');

  useEffect(() => {
    db.table('analyticsRuns').orderBy('startedAt').last().then((run) => {
      if (run) setConfig(run.config);
    });
  }, []);

  const save = async () => {
    // Persist by writing a marker run; the next analytics run picks this config
    // via the UI state. (Prototype: config travels with the run; recorded in audit.)
    await recordAudit({
      actor: reviewer.trim() || 'administrator',
      eventType: 'analytics_run',
      targetType: 'config',
      targetId: 'settings',
      details: `Configuration updated: ${JSON.stringify(config)}`,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const doReset = async () => {
    await recordAudit({
      actor: reviewer.trim() || 'administrator',
      eventType: 'workspace_reset',
      targetType: 'workspace',
      targetId: 'all',
      details: 'Workspace reset requested from Settings; all local data cleared.',
    });
    await resetWorkspace();
    setConfirmReset(false);
  };

  const runs = useLiveQuery(() => db.analyticsRuns.orderBy('startedAt').reverse().limit(5).toArray(), []);

  const setRuleEnabled = (id: string, enabled: boolean) =>
    setConfig((c) => ({ ...c, rules: { ...c.rules, [id]: { ...c.rules[id]!, enabled } } }));
  const setRuleParam = (id: string, key: string, value: string) =>
    setConfig((c) => {
      const prev = c.rules[id]!.params[key];
      const parsed = typeof prev === 'number' ? Number(value) : value;
      return { ...c, rules: { ...c.rules, [id]: { ...c.rules[id]!, params: { ...c.rules[id]!.params, [key]: parsed } } } };
    });

  return (
    <div>
      <h1 className="mt-0">Settings</h1>
      <p className="muted small" style={{ marginTop: -8 }}>
        All thresholds below are <strong>prototype defaults</strong>, not official requirements. Rules are stable,
        versioned, and independently disableable; the configuration travels with each analytics run and is recorded
        in the audit trail.
      </p>

      <div className="panel">
        <h2 className="panel-title">Reviewer identity (local)</h2>
        <div className="row" style={{ gap: 10, maxWidth: 420 }}>
          <input className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. supervisor.k" />
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          The prototype has no authentication: this identifier is recorded in decision history and audit events.
          Production access control is documented as a limitation, not simulated here.
        </p>
      </div>

      <div className="panel">
        <h2 className="panel-title">Rule catalogue v1.0.0</h2>
        <p className="panel-sub">Disable a rule or adjust its parameters; changes apply on the next analytics run.</p>
        {Object.entries(config.rules).map(([id, rule]) => (
          <div key={id} style={{ borderTop: '1px solid rgba(36,70,58,0.6)', padding: '14px 0' }}>
            <div className="row between">
              <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={rule.enabled}
                  onChange={(e) => setRuleEnabled(id, e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: '#2ea36a' }}
                />
                <span className="mono" style={{ fontWeight: 700 }}>{id} v{rule.version}</span>
                <span className="small muted">{RULE_DESCRIPTIONS[id]}</span>
              </label>
            </div>
            <div className="row" style={{ gap: 14, marginTop: 10, paddingLeft: 26 }}>
              {Object.entries(rule.params).map(([k, v]) => (
                <div key={k} style={{ minWidth: 200 }}>
                  <label className="label">{PARAM_LABELS[k] ?? k}</label>
                  <input
                    className="input" defaultValue={String(v)}
                    key={`${id}-${k}-${String(v)}`}
                    onBlur={(e) => setRuleParam(id, k, e.target.value)}
                  />
                </div>
              ))}
              {Object.keys(rule.params).length === 0 && <span className="tiny muted">No parameters.</span>}
            </div>
          </div>
        ))}

        <h3 style={{ fontSize: '0.95rem', marginTop: 18 }}>Priority weights (illustrative)</h3>
        <div className="row" style={{ gap: 14 }}>
          {(['S', 'E', 'C', 'R'] as const).map((k) => (
            <div key={k} style={{ minWidth: 120 }}>
              <label className="label">{k === 'S' ? 'S — severity' : k === 'E' ? 'E — evidence' : k === 'C' ? 'C — criticality' : 'R — recurrence'}</label>
              <input
                className="input" type="number" step="0.05" min="0" max="1"
                value={config.priorityWeights[k]}
                onChange={(e) => setConfig((c) => ({ ...c, priorityWeights: { ...c.priorityWeights, [k]: Number(e.target.value) } }))}
              />
            </div>
          ))}
          <button className="btn subtle small" style={{ alignSelf: 'flex-end' }} onClick={() => setConfig((c) => ({ ...c, priorityWeights: { S: 0.4, E: 0.3, C: 0.2, R: 0.1 } }))}>
            Reset weights
          </button>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn primary" onClick={save}>Record configuration in audit trail</button>
          <button className="btn subtle" onClick={() => setConfig(defaultAnalyticsConfig())}>Restore defaults</button>
          {saved && <span className="small" style={{ color: '#a5f3d0' }}>Recorded.</span>}
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Recent analytics runs</h2>
        {!runs || runs.length === 0 ? (
          <p className="muted small">No runs yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Run</th><th>Started</th><th>Software</th><th>Config hash</th><th>Findings</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="mono tiny">{r.id}</td>
                    <td className="mono tiny">{r.startedAt.slice(0, 19).replace('T', ' ')}</td>
                    <td className="small">v{r.softwareVersion}</td>
                    <td className="mono tiny" title={r.configHash}>{r.configHash.slice(0, 12)}…</td>
                    <td>{r.findingsCreated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Workspace</h2>
        <p className="panel-sub">
          ARGUS SAT v{SOFTWARE_VERSION} stores everything locally in your browser (IndexedDB). Resetting clears
          entities, submissions, findings, decisions, and audit events. This action cannot be undone.
        </p>
        {confirmReset ? (
          <div className="row">
            <button className="btn danger" onClick={doReset}>Yes, erase all local data</button>
            <button className="btn subtle" onClick={() => setConfirmReset(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn danger" onClick={() => setConfirmReset(true)}>Reset workspace…</button>
        )}
      </div>
    </div>
  );
}
