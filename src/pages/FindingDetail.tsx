// Finding detail: full evidence drill-down + supervisor review form.

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { EVIDENCE_STRENGTH_LABELS, FINDING_CATEGORY_LABELS } from '../lib/types';
import type { FindingEvidence, FindingStatus, ReviewDecision, SourceFile } from '../lib/types';
import { PERMITTED_STATUSES, recordDecision } from '../lib/review';
import { PriorityBadge, SeverityBadge, StatusBadge } from '../ui/components';
import { formatDateTime } from '../lib/util';

const STATUS_OPTIONS: FindingStatus[] = PERMITTED_STATUSES;

export default function FindingDetailPage({ findingId }: { findingId: string }) {
  const [status, setStatus] = useState<FindingStatus>('new');
  const [reviewer, setReviewer] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const data = useLiveQuery(async () => {
    const finding = await db.findings.get(findingId);
    if (!finding) return null;
    const [evidence, decisions, entity, files] = await Promise.all([
      db.findingEvidence.where('findingId').equals(findingId).toArray(),
      db.reviewDecisions.where('findingId').equals(findingId).sortBy('at'),
      db.entities.get(finding.entityId),
      db.files.toArray(),
    ]);
    return { finding, evidence, decisions, entity, files };
  }, [findingId]);

  useEffect(() => {
    if (data?.finding) {
      setStatus(data.finding.status);
      const last = localStorage.getItem('argus.lastReviewer');
      if (last) setReviewer(last);
    }
  }, [data?.finding?.id, data?.finding?.status]);

  if (!data) return <div className="muted">Loading…</div>;
  const { finding, evidence, decisions, entity, files } = data;
  if (!finding) {
    return (
      <div>
        <h1>Finding not found</h1>
        <p className="muted">It may have been superseded by a new analytics run.</p>
        <a className="btn" href="#/findings">Back to findings</a>
      </div>
    );
  }

  const fileById = new Map<string, SourceFile>(files.map((f) => [f.id, f]));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await recordDecision(finding.id, status, reviewer, notes, 'reviewer');
      localStorage.setItem('argus.lastReviewer', reviewer.trim());
      setNotes('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <a className="btn subtle small" href="#/findings">← Findings</a>
            <span className="mono tiny muted">{finding.id}</span>
          </div>
          <h1 className="mt-0" style={{ margin: 0, fontSize: '1.3rem' }}>
            <span className="mono">{finding.ruleId}</span> — {finding.ruleTitle}
          </h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <PriorityBadge label={finding.priorityLabel} score={finding.priorityScore} />
          <SeverityBadge severity={finding.severity} />
          <StatusBadge status={finding.status} />
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="panel">
          <h2 className="panel-title">Trigger explanation</h2>
          <p style={{ lineHeight: 1.6 }}>{finding.explanation}</p>

          <h2 className="panel-title" style={{ marginTop: 18 }}>Observed values</h2>
          <dl className="kv">
            {finding.observed.map((o) => (
              <div key={o.label} style={{ display: 'contents' }}>
                <dt>{o.label}</dt>
                <dd className="mono">{o.value}</dd>
              </div>
            ))}
          </dl>

          <h2 className="panel-title" style={{ marginTop: 18 }}>Review-priority breakdown</h2>
          <p className="panel-sub">
            Illustrative prototype weights (S=0.40 severity, E=0.30 evidence, C=0.20 criticality, R=0.10 recurrence).
            Unknown components are excluded and their weight redistributed — never silently treated as zero.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Component</th><th>Raw</th><th>Weight</th><th>Used</th><th>Note</th></tr></thead>
              <tbody>
                {finding.priorityComponents.map((c) => (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    <td className="mono">{c.raw ?? 'unknown'}</td>
                    <td className="mono">{c.weight?.toFixed(2) ?? '—'}</td>
                    <td>{c.used ? 'yes' : 'no'}</td>
                    <td className="small muted">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="callout info" style={{ marginTop: 14 }}>
            <strong>Limitations &amp; caveats.</strong> {finding.limitations}
          </div>
        </div>

        <div className="panel">
          <h2 className="panel-title">Context</h2>
          <dl className="kv">
            <div style={{ display: 'contents' }}><dt>Entity</dt><dd>{entity?.name ?? finding.entityId}</dd></div>
            <div style={{ display: 'contents' }}><dt>Reporting period</dt><dd className="mono">{finding.periodStart} .. {finding.periodEnd}</dd></div>
            <div style={{ display: 'contents' }}><dt>Category</dt><dd>{FINDING_CATEGORY_LABELS[finding.category]}</dd></div>
            <div style={{ display: 'contents' }}><dt>Rule / version</dt><dd className="mono">{finding.ruleId} v{finding.ruleVersion}</dd></div>
            <div style={{ display: 'contents' }}><dt>Evidence strength</dt><dd>{finding.evidenceStrength} — {EVIDENCE_STRENGTH_LABELS[finding.evidenceStrength]}</dd></div>
            <div style={{ display: 'contents' }}><dt>Analytics run</dt><dd className="mono">{finding.analyticsRunId}</dd></div>
            <div style={{ display: 'contents' }}><dt>Created</dt><dd className="mono">{formatDateTime(finding.createdAt)}</dd></div>
          </dl>

          <h2 className="panel-title" style={{ marginTop: 18 }}>Evidence ({evidence.length})</h2>
          <p className="panel-sub">Source records supporting this finding. Roles: supporting, contradicting, contextual.</p>
          {evidence.length === 0 && <p className="muted small">No evidence links recorded.</p>}
          <div className="table-wrap">
            {evidence.length > 0 && (
              <table className="data">
                <thead><tr><th>Role</th><th>Record</th><th>Location</th></tr></thead>
                <tbody>
                  {evidence.map((ev: FindingEvidence) => {
                    const file = ev.sourceFileId ? fileById.get(ev.sourceFileId) : undefined;
                    return (
                      <tr key={ev.id}>
                        <td><span className="badge sev-info">{ev.evidenceRole}</span></td>
                        <td>
                          <span className="mono small">{ev.sourceRecordType}</span>
                          <div className="mono tiny muted">{ev.sourceRecordId}</div>
                          {ev.note && <div className="tiny muted">{ev.note}</div>}
                        </td>
                        <td className="tiny">
                          {file ? <div className="mono">{file.filename}</div> : null}
                          {ev.sourceRowRef && <div className="mono muted">{ev.sourceRowRef}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <h2 className="panel-title" style={{ marginTop: 18 }}>Suggested review questions</h2>
          <ul className="small" style={{ lineHeight: 1.6 }}>
            {finding.suggestedQuestions.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2 className="panel-title">Reviewer decision</h2>
        <p className="panel-sub">
          Decisions are append-only: every change is recorded with reviewer, timestamp, and prior status. Dismissed
          findings are never deleted from the audit history.
        </p>
        <div className="grid-2">
          <div>
            <div className="field">
              <label className="label">Decision</label>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value as FindingStatus)}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Reviewer identifier</label>
              <input className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. supervisor.k" />
            </div>
          </div>
          <div>
            <div className="field">
              <label className="label">Notes / rationale</label>
              <textarea className="textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this decision? What was verified?" />
            </div>
            <div className="row">
              <button className="btn primary" onClick={submit} disabled={busy || !reviewer.trim()}>
                {busy ? <span className="spin" /> : null} Record decision
              </button>
              {saved && <span className="small" style={{ color: '#56dc8a' }}>Decision recorded.</span>}
              {error && <span className="small" style={{ color: '#fca5a5' }}>{error}</span>}
            </div>
          </div>
        </div>

        <h3 style={{ marginTop: 18, fontSize: '0.95rem' }}>Decision history</h3>
        {decisions.length === 0 ? (
          <p className="muted small">No decisions recorded for this finding yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>When</th><th>Reviewer</th><th>Change</th><th>Notes</th></tr></thead>
              <tbody>
                {decisions.map((d: ReviewDecision) => (
                  <tr key={d.id}>
                    <td className="mono tiny">{formatDateTime(d.at)}</td>
                    <td className="small">{d.reviewer}</td>
                    <td className="small">
                      {d.previousStatus ? <StatusBadge status={d.previousStatus} /> : null}
                      {' → '}
                      <StatusBadge status={d.newStatus} />
                    </td>
                    <td className="small">{d.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
