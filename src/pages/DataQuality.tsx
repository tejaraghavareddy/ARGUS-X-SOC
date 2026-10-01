// Data quality: import batches, validation issues, completeness.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { EmptyState } from '../ui/components';
import { formatDateTime } from '../lib/util';

export default function DataQualityPage() {
  const [selected, setSelected] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const [batches, submissions, files, entities] = await Promise.all([
      db.importBatches.toArray(),
      db.submissions.toArray(),
      db.files.toArray(),
      db.entities.toArray(),
    ]);
    return { batches, submissions, files, entities };
  }, []);

  if (!data) return <div className="muted">Loading…</div>;

  if (data.batches.length === 0) {
    return (
      <div>
        <h1 className="mt-0">Data quality</h1>
        <EmptyState title="No import batches yet">
          Import submissions to see validation results, completeness, and provenance here.
        </EmptyState>
      </div>
    );
  }

  const sorted = [...data.batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selectedBatch = sorted.find((b) => b.id === selected) ?? sorted[0];
  const batchSub = data.submissions.find((s) => s.id === selectedBatch.submissionId);
  const batchFiles = data.files.filter((f) => f.submissionId === selectedBatch.submissionId);
  const entityName = data.entities.find((e) => e.id === batchSub?.entityId)?.name ?? batchSub?.entityId ?? '?';

  const errorCount = selectedBatch.issues.filter((i) => i.level === 'error').length;
  const warnCount = selectedBatch.issues.filter((i) => i.level === 'warning').length;

  return (
    <div>
      <h1 className="mt-0">Data quality</h1>
      <p className="muted small" style={{ marginTop: -8 }}>
        Validation results and completeness per import batch. Data-quality problems are reported separately from
        operational SOC weaknesses, and incomplete submissions suppress negative-space conclusions in the affected
        categories.
      </p>

      <div className="grid-2" style={{ gridTemplateColumns: '340px 1fr', alignItems: 'start' }}>
        <div className="panel">
          <h2 className="panel-title">Import batches</h2>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Batch</th><th>Entity</th><th>Period</th><th>Completeness</th></tr></thead>
              <tbody>
                {sorted.map((b) => {
                  const sub = data.submissions.find((s) => s.id === b.submissionId);
                  const name = data.entities.find((e) => e.id === sub?.entityId)?.name ?? sub?.entityId ?? '?';
                  const pct = (b.completeness.score * 100).toFixed(0);
                  return (
                    <tr
                      key={b.id}
                      className={`clickable${selectedBatch.id === b.id ? ' active' : ''}`}
                      onClick={() => setSelected(b.id)}
                      style={selectedBatch.id === b.id ? { background: 'rgba(86,220,138,0.08)' } : undefined}
                    >
                      <td className="mono tiny">{b.id.slice(0, 14)}…</td>
                      <td className="small">{name}</td>
                      <td className="mono tiny">{sub ? `${sub.periodStart}…${sub.periodEnd.slice(5)}` : '?'}</td>
                      <td className="mono small" style={{ color: b.completeness.score < 1 ? '#fde68a' : '#a5f3d0' }}>{pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="row between">
              <div>
                <h2 className="panel-title">Batch {selectedBatch.id}</h2>
                <p className="panel-sub">
                  {entityName} · period {batchSub?.periodStart} .. {batchSub?.periodEnd} · imported {formatDateTime(selectedBatch.createdAt)}
                </p>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <span className="badge status-confirmed">{errorCount} error{errorCount === 1 ? '' : 's'}</span>
                <span className="badge status-needs_more_evidence">{warnCount} warning{warnCount === 1 ? '' : 's'}</span>
              </div>
            </div>

            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginTop: 8 }}>
              <div className="kpi"><div className="kpi-label">Records read</div><div className="kpi-value">{selectedBatch.totals.read}</div></div>
              <div className="kpi"><div className="kpi-label">Accepted</div><div className="kpi-value" style={{ color: '#a5f3d0' }}>{selectedBatch.totals.accepted}</div></div>
              <div className="kpi"><div className="kpi-label">Rejected</div><div className="kpi-value" style={{ color: errorCount ? '#fca5a5' : undefined }}>{selectedBatch.totals.rejected}</div></div>
              <div className="kpi"><div className="kpi-label">Duplicates</div><div className="kpi-value">{selectedBatch.totals.duplicates}</div></div>
              <div className="kpi">
                <div className="kpi-label">Completeness</div>
                <div className="kpi-value">{(selectedBatch.completeness.score * 100).toFixed(0)}%</div>
                <div className="kpi-note">{selectedBatch.completeness.presentCategories.length}/6 categories</div>
              </div>
            </div>

            {selectedBatch.completeness.missingCategories.length > 0 && (
              <div className="callout warn">
                <strong>Missing evidence categories:</strong> {selectedBatch.completeness.missingCategories.join(', ')}.
                Negative-space findings are suppressed for these categories because the submission itself is
                incomplete — absence here is not evidence of a monitoring or workflow gap.
              </div>
            )}
            {selectedBatch.completeness.notes.map((n, i) => (
              <div key={i} className="callout info">{n}</div>
            ))}

            <h2 className="panel-title" style={{ marginTop: 14 }}>Source files</h2>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>File</th><th>Category</th><th>Records</th><th>SHA-256 (first 12)</th><th>Size</th></tr></thead>
                <tbody>
                  {batchFiles.map((f) => (
                    <tr key={f.id}>
                      <td className="mono small">{f.filename}</td>
                      <td className="small">{f.kind}</td>
                      <td className="small">{f.acceptedCount}/{f.recordCount}</td>
                      <td className="mono tiny" title={f.sha256}>{f.sha256.slice(0, 12)}…</td>
                      <td className="tiny muted">{(f.byteSize / 1024).toFixed(1)} KB</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Row-level validation issues</h2>
            <p className="panel-sub">
              Invalid records are never silently discarded; they are rejected with a reason and excluded from
              analytics that depend on the failed field.
            </p>
            {selectedBatch.issues.length === 0 ? (
              <p className="muted small">No validation issues in this batch.</p>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="data">
                  <thead><tr><th>Level</th><th>File</th><th>Row</th><th>Check</th><th>Message</th></tr></thead>
                  <tbody>
                    {selectedBatch.issues.map((iss, i) => (
                      <tr key={i}>
                        <td>
                          <span className={`badge ${iss.level === 'error' ? 'status-confirmed' : 'status-needs_more_evidence'}`}>
                            {iss.level}
                          </span>
                        </td>
                        <td className="mono tiny">{iss.filename}</td>
                        <td className="mono tiny">{iss.rowRef}</td>
                        <td className="mono tiny">{iss.rule}</td>
                        <td className="small">{iss.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
