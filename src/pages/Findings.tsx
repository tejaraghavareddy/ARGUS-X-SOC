// Findings workbench: search, filter, sort, and open findings.

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { FINDING_CATEGORY_LABELS, FINDING_STATUS_LABELS } from '../lib/types';
import type { Finding } from '../lib/types';
import { EmptyState, PriorityBadge, SeverityBadge, StatusBadge } from '../ui/components';

type SortKey = 'priority' | 'severity' | 'recurrence' | 'date' | 'status';

export default function FindingsPage() {
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('all');
  const [rule, setRule] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('priority');

  const data = useLiveQuery(async () => {
    const [findings, entities] = await Promise.all([db.findings.toArray(), db.entities.toArray()]);
    return { findings, entities };
  }, []);

  const sevOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

  const filtered = useMemo<Finding[]>(() => {
    if (!data) return [];
    let rows = data.findings;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((f) =>
        JSON.stringify(f).toLowerCase().includes(needle)
      );
    }
    if (entity !== 'all') rows = rows.filter((f) => f.entityId === entity);
    if (rule !== 'all') rows = rows.filter((f) => f.ruleId === rule);
    if (severity !== 'all') rows = rows.filter((f) => f.severity === severity);
    if (status !== 'all') rows = rows.filter((f) => f.status === status);
    if (category !== 'all') rows = rows.filter((f) => f.category === category);
    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'priority': return (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
        case 'severity': return (sevOrder[b.severity] ?? 0) - (sevOrder[a.severity] ?? 0);
        case 'recurrence': {
          const rec = (f: Finding) => {
            const r = f.observed.find((o) => o.label.toLowerCase().includes('recurrence'));
            return r ? Number(r.value) || 0 : 0;
          };
          return rec(b) - rec(a);
        }
        case 'date': return b.createdAt.localeCompare(a.createdAt);
        case 'status': return a.status.localeCompare(b.status);
      }
    });
    return sorted;
  }, [data, q, entity, rule, severity, status, category, sortKey]);

  if (!data) return <div className="muted">Loading…</div>;

  const rules = [...new Set(data.findings.map((f) => f.ruleId))].sort();

  return (
    <div>
      <h1 className="mt-0">Findings</h1>
      <p className="muted small" style={{ marginTop: -8 }}>
        Every finding is a signal for human review — not a conclusion. Sort by review priority to plan the work.
      </p>

      {data.findings.length === 0 ? (
        <EmptyState title="No findings yet">
          Run analytics from the <a href="#/import">Import &amp; demo data</a> page after loading a submission.
        </EmptyState>
      ) : (
        <>
          <div className="panel" style={{ padding: 14 }}>
            <div className="row" style={{ gap: 10 }}>
              <input
                className="input" placeholder="Search findings…" value={q}
                onChange={(e) => setQ(e.target.value)} style={{ flex: '2 1 220px' }}
              />
              <select className="select" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ flex: '1 1 150px' }}>
                <option value="all">All entities</option>
                {data.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <select className="select" value={rule} onChange={(e) => setRule(e.target.value)} style={{ flex: '1 1 110px' }}>
                <option value="all">All rules</option>
                {rules.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)} style={{ flex: '1 1 110px' }}>
                <option value="all">All severities</option>
                {['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} style={{ flex: '1 1 130px' }}>
                <option value="all">All statuses</option>
                {Object.entries(FINDING_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} style={{ flex: '1 1 130px' }}>
                <option value="all">All categories</option>
                {Object.entries(FINDING_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="select" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={{ flex: '1 1 140px' }}>
                <option value="priority">Sort: priority</option>
                <option value="severity">Sort: severity</option>
                <option value="recurrence">Sort: recurrence</option>
                <option value="date">Sort: date</option>
                <option value="status">Sort: status</option>
              </select>
            </div>
          </div>

          <div className="panel">
            <div className="row between" style={{ marginBottom: 8 }}>
              <span className="muted small">{filtered.length} of {data.findings.length} findings</span>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Priority</th><th>Severity</th><th>Rule</th><th>Category</th>
                    <th>Entity</th><th>Period</th><th>Status</th><th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <tr
                      key={f.id}
                      className="clickable"
                      onClick={() => { window.location.hash = `#/findings/${encodeURIComponent(f.id)}`; }}
                    >
                      <td><PriorityBadge label={f.priorityLabel} score={f.priorityScore} /></td>
                      <td><SeverityBadge severity={f.severity} /></td>
                      <td className="mono">{f.ruleId}</td>
                      <td className="small">{FINDING_CATEGORY_LABELS[f.category]}</td>
                      <td className="small">{data.entities.find((e) => e.id === f.entityId)?.name ?? f.entityId}</td>
                      <td className="mono tiny">{f.periodStart}…{f.periodEnd.slice(5)}</td>
                      <td><StatusBadge status={f.status} /></td>
                      <td className="small" style={{ maxWidth: 360 }}>
                        {f.explanation.length > 150 ? f.explanation.slice(0, 150) + '…' : f.explanation}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="muted">No findings match the current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
