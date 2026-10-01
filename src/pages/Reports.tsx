// Reports: scope selection, preview, CSV + printable HTML export.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { buildHtmlReport, exportFindingsCsv, type ReportScope } from '../lib/review';
import { EmptyState, download } from '../ui/components';

export default function ReportsPage() {
  const [entityId, setEntityId] = useState<string>('all');
  const [reviewer, setReviewer] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = useLiveQuery(async () => {
    const [entities, findings] = await Promise.all([db.entities.toArray(), db.findings.toArray()]);
    return { entities, findings };
  }, []);

  const scope: ReportScope = { entityId };

  const doCsv = async () => {
    setBusy(true);
    setError(null);
    try {
      const csv = await exportFindingsCsv(scope);
      download(`argus-findings-${entityId}-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await buildHtmlReport({ scope, reviewer }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doHtml = async () => {
    setBusy(true);
    setError(null);
    try {
      const html = await buildHtmlReport({ scope, reviewer });
      download(`argus-report-${entityId}-${new Date().toISOString().slice(0, 10)}.html`, html, 'text/html');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (meta && meta.findings.length === 0) {
    return (
      <div>
        <h1 className="mt-0">Reports</h1>
        <EmptyState title="Nothing to report yet">
          Run analytics on an imported submission first, then generate a report here.
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mt-0">Reports</h1>
      <p className="muted small" style={{ marginTop: -8 }}>
        Reports include scope, data quality, prioritized findings with evidence references, methodology, rule
        versions, limitations, and reviewer decisions. Generation is local and reproducible for a fixed dataset and
        configuration. Reports generated from the demo dataset are marked as synthetic.
      </p>

      <div className="panel">
        <div className="grid-2">
          <div>
            <div className="field">
              <label className="label">Entity scope</label>
              <select className="select" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                <option value="all">All entities</option>
                {(meta?.entities ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Reviewer of record</label>
              <input
                className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)}
                placeholder="e.g. supervisor.k"
              />
            </div>
          </div>
          <div>
            <p className="panel-sub" style={{ marginTop: 0 }}>
              <strong>CSV</strong> exports the findings table for spreadsheets. <strong>Printable HTML</strong> is a
              standalone document (no external assets) suitable for print-to-PDF in an air-gapped environment.
            </p>
            <div className="row">
              <button className="btn" onClick={doCsv} disabled={busy}>Export findings CSV</button>
              <button className="btn" onClick={doPreview} disabled={busy}>Preview report</button>
              <button className="btn primary" onClick={doHtml} disabled={busy}>Download HTML report</button>
            </div>
            {error && <div className="callout danger" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        </div>
      </div>

      {preview && (
        <div className="panel">
          <div className="row between" style={{ marginBottom: 10 }}>
            <h2 className="panel-title" style={{ margin: 0 }}>Report preview</h2>
            <div className="row">
              <button className="btn small" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(preview); w.document.close(); } }}>
                Open in new tab (print / save as PDF)
              </button>
              <button className="btn subtle small" onClick={() => setPreview(null)}>Close preview</button>
            </div>
          </div>
          <iframe
            title="Report preview"
            srcDoc={preview}
            style={{ width: '100%', height: 560, border: '1px solid #24463a', borderRadius: 10, background: '#fff' }}
          />
        </div>
      )}
    </div>
  );
}
