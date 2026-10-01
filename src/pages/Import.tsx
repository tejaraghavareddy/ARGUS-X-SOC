// Import page: file import (CSV/JSON), synthetic demo loader, analytics run.

import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { importDemoBundle, importSubmission, runAnalytics } from '../lib/pipeline';
import type { ImportOutcome, RunOutcome } from '../lib/pipeline';
import { EmptyState } from '../ui/components';

export default function ImportPage() {
  const [entityId, setEntityId] = useState('');
  const [label, setLabel] = useState('');
  const [periodStart, setPeriodStart] = useState('2026-01-01');
  const [periodEnd, setPeriodEnd] = useState('2026-01-31');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [runOutcome, setRunOutcome] = useState<RunOutcome | null>(null);
  const [demoDone, setDemoDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = useLiveQuery(async () => {
    const [entities, submissions] = await Promise.all([db.entities.toArray(), db.submissions.toArray()]);
    return { entities, submissions };
  }, []);

  const doDemo = async () => {
    setBusy('demo');
    setError(null);
    try {
      // Generate the bundle in-browser from the same seeded generator used by
      // the offline script (same seed => same records as generated-data/).
      const { generateDataset, DEMO_SEED } = await import('../lib/synthetic');
      const dataset = generateDataset(DEMO_SEED);
      const bundle = {
        meta: {
          seed: dataset.seed,
          generator_version: dataset.generatorVersion,
          generated_at: dataset.generatedAt,
          is_synthetic: true,
          entities: dataset.entities.map((e) => ({ id: e.id, name: e.name, sector: e.sector, peer_group: e.peerGroup })),
          periods: dataset.periods,
        },
        assets: dataset.assets,
        alerts: dataset.alerts,
        cases: dataset.cases,
        actions: dataset.actions,
        escalations: dataset.escalations,
        telemetry: dataset.telemetry,
      };
      const res = await importDemoBundle(JSON.stringify(bundle), 'demo-loader');
      setDemoDone(`${res.entities} entities · ${res.submissions} submissions · ${res.records} records (seed ${DEMO_SEED})`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    setBusy('import');
    setError(null);
    setOutcome(null);
    try {
      const files = Array.from(fileRef.current?.files ?? []);
      if (files.length === 0) throw new Error('Select at least one CSV or JSON file.');
      if (!entityId) throw new Error('Select the entity this submission belongs to.');
      if (!label.trim()) throw new Error('Give the submission a label (e.g. "January 2026 monthly export").');
      const uploads = await Promise.all(files.map(async (f) => ({ filename: f.name, text: await f.text() })));
      const entity = (await meta?.entities) ?? [];
      const name = entity.find((e) => e.id === entityId)?.name ?? entityId;
      const res = await importSubmission(
        { entityId, entityName: name, periodStart, periodEnd, label: label.trim() },
        uploads,
        'supervisor'
      );
      setOutcome(res);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doRun = async () => {
    setBusy('run');
    setError(null);
    try {
      const { defaultAnalyticsConfig } = await import('../lib/types');
      const res = await runAnalytics(defaultAnalyticsConfig(), 'supervisor');
      setRunOutcome(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="mt-0">Import &amp; demo data</h1>
      <p className="muted small" style={{ marginTop: -8 }}>
        Files are parsed locally in the browser; nothing is uploaded anywhere. Imported content is treated as
        untrusted: it is only validated and normalized, never executed.
      </p>

      <div className="panel">
        <h2 className="panel-title">1 · Load the synthetic demonstration dataset</h2>
        <p className="panel-sub">
          Five fictional entities across three 30-day reporting periods with deliberately seeded scenarios (fast
          closures, missing escalations, monitoring gaps, repetitive notes, an incomplete submission, and benign
          traps). Same seed every time, so demos are reproducible.
        </p>
        <div className="row">
          <button className="btn primary" onClick={doDemo} disabled={busy !== null}>
            {busy === 'demo' ? <span className="spin" /> : null} Load demo dataset
          </button>
          {demoDone && <span className="small" style={{ color: '#a5f3d0' }}>Loaded: {demoDone}</span>}
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          The CLI equivalent writes the same dataset to <code>generated-data/</code>: <code>bun run generate:data</code>
          {' '}— including <code>argus-demo-bundle.json</code> and a separate <code>ground-truth.json</code> used only
          by the test suite.
        </p>
      </div>

      <div className="panel">
        <h2 className="panel-title">2 · Import your own submission (CSV / JSON)</h2>
        <p className="panel-sub">
          Name files after their evidence category (<code>alerts.csv</code>, <code>cases.csv</code>,
          {' '}<code>actions.csv</code>, <code>escalations.csv</code>, <code>assets.csv</code>,
          {' '}<code>telemetry.csv</code>) or include the standard columns. JSON must be an array of records (or{' '}
          <code>{'{"records": [...]}'}</code>). See the data dictionary in <code>docs/data-dictionary.md</code>.
        </p>
        <div className="grid-2">
          <div>
            <div className="field">
              <label className="label">Entity</label>
              <select className="select" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                <option value="">— create below or pick existing —</option>
                {(meta?.entities ?? []).map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">New entity name (optional — used when “create below” is selected)</label>
              <input className="input" placeholder="e.g. Coastal Electricity Board" disabled />
              <p className="tiny muted" style={{ margin: '4px 0 0' }}>
                For the prototype, entities come from the demo loader; real entities are created by an administrator
                in a future iteration.
              </p>
            </div>
            <div className="field">
              <label className="label">Submission label</label>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. November 2025 monthly export" />
            </div>
          </div>
          <div>
            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="label">Period start</label>
                <input className="input" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label">Period end</label>
                <input className="input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label className="label">Files (CSV or JSON, up to 20 MB each)</label>
              <input className="input" type="file" multiple accept=".csv,.json,text/csv,application/json" ref={fileRef} />
            </div>
          </div>
        </div>
        <div className="row">
          <button className="btn primary" onClick={doImport} disabled={busy !== null}>
            {busy === 'import' ? <span className="spin" /> : null} Import submission
          </button>
          <button className="btn" onClick={doRun} disabled={busy !== null}>
            {busy === 'run' ? <span className="spin" /> : null} Run analytics
          </button>
          {error && <span className="small" style={{ color: '#fca5a5' }}>{error}</span>}
        </div>

        {outcome && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: '0.95rem' }}>Import summary</h3>
            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
              <div className="kpi"><div className="kpi-label">Read</div><div className="kpi-value">{outcome.totals.read}</div></div>
              <div className="kpi"><div className="kpi-label">Accepted</div><div className="kpi-value" style={{ color: '#a5f3d0' }}>{outcome.totals.accepted}</div></div>
              <div className="kpi"><div className="kpi-label">Rejected</div><div className="kpi-value" style={{ color: outcome.totals.rejected ? '#fca5a5' : undefined }}>{outcome.totals.rejected}</div></div>
              <div className="kpi"><div className="kpi-label">Duplicates</div><div className="kpi-value">{outcome.totals.duplicates}</div></div>
              <div className="kpi"><div className="kpi-label">Completeness</div><div className="kpi-value">{(outcome.completeness.score * 100).toFixed(0)}%</div></div>
            </div>
            {outcome.completeness.notes.map((n, i) => <div key={i} className="callout info">{n}</div>)}
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>File</th><th>Category</th><th>Read</th><th>Accepted</th><th>Rejected</th><th>Duplicates</th><th>SHA-256</th></tr></thead>
                <tbody>
                  {outcome.fileSummaries.map((f) => (
                    <tr key={f.filename}>
                      <td className="mono small">{f.filename}</td>
                      <td className="small">{f.kind}</td>
                      <td>{f.read}</td>
                      <td>{f.accepted}</td>
                      <td style={{ color: f.rejected ? '#fca5a5' : undefined }}>{f.rejected}</td>
                      <td>{f.duplicates}</td>
                      <td className="mono tiny" title={f.sha256}>{f.sha256.slice(0, 10)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {outcome.fileSummaries.some((f) => f.issues.length > 0) && (
              <>
                <h3 style={{ fontSize: '0.95rem' }}>Validation issues</h3>
                <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
                  <table className="data">
                    <thead><tr><th>Level</th><th>File</th><th>Row</th><th>Check</th><th>Message</th></tr></thead>
                    <tbody>
                      {outcome.fileSummaries.flatMap((f) =>
                        f.issues.map((iss, i) => (
                          <tr key={`${f.filename}-${i}`}>
                            <td><span className={`badge ${iss.level === 'error' ? 'status-confirmed' : 'status-needs_more_evidence'}`}>{iss.level}</span></td>
                            <td className="mono tiny">{f.filename}</td>
                            <td className="mono tiny">{iss.rowRef}</td>
                            <td className="mono tiny">{iss.rule}</td>
                            <td className="small">{iss.message}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {runOutcome && (
          <div className="callout info" style={{ marginTop: 14 }}>
            <strong>Analytics run {runOutcome.runId}</strong> — {runOutcome.findingsCreated} findings in{' '}
            {runOutcome.durationMs} ms ({Object.entries(runOutcome.byRule).map(([r, n]) => `${r}:${n}`).join(', ') || 'no rule hits'}).
            Reviewer decisions on unchanged findings are preserved.
          </div>
        )}
      </div>

      {(meta?.submissions?.length ?? 0) > 0 && (
        <div className="panel">
          <h2 className="panel-title">Loaded submissions</h2>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Submission</th><th>Entity</th><th>Period</th><th>Label</th><th>Imported</th></tr></thead>
              <tbody>
                {meta!.submissions.map((s) => (
                  <tr key={s.id}>
                    <td className="mono tiny">{s.id}</td>
                    <td className="small">{meta!.entities.find((e) => e.id === s.entityId)?.name ?? s.entityId}</td>
                    <td className="mono tiny">{s.periodStart} .. {s.periodEnd}</td>
                    <td className="small">{s.label}</td>
                    <td className="tiny muted">{s.createdAt.slice(0, 19).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            Re-importing an identical submission label is rejected to keep imports idempotent; duplicate record IDs
            within a submission are flagged, not merged.
          </p>
        </div>
      )}

      {(meta?.submissions?.length ?? 0) === 0 && (
        <EmptyState title="Nothing imported yet">
          Start with the demo dataset above, or bring your own CSV/JSON files.
        </EmptyState>
      )}
    </div>
  );
}
