// Entity comparison: normalized indicators with explicit denominators and
// completeness caveats. Review-oriented labels only — no ranking verdicts.

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { EmptyState } from '../ui/components';

export default function EntitiesPage() {
  const [sector, setSector] = useState('all');
  const [peerGroup, setPeerGroup] = useState('all');

  const data = useLiveQuery(async () => {
    const [entities, submissions, batches, alerts, cases, findings] = await Promise.all([
      db.entities.toArray(),
      db.submissions.toArray(),
      db.importBatches.toArray(),
      db.alerts.toArray(),
      db.cases.toArray(),
      db.findings.toArray(),
    ]);
    return { entities, submissions, batches, alerts, cases, findings };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.entities
      .filter((e) => sector === 'all' || e.sector === sector)
      .filter((e) => peerGroup === 'all' || e.peerGroup === peerGroup)
      .map((e) => {
        const subs = data.submissions.filter((s) => s.entityId === e.id);
        const subIds = new Set(subs.map((s) => s.id));
        const alertCount = data.alerts.filter((a) => subIds.has(a.submissionId)).length;
        const caseCount = data.cases.filter((c) => subIds.has(c.submissionId)).length;
        const assetIds = new Set(data.entities.length ? [] : []); // placeholder, assets joined below
        void assetIds;
        const batches = data.batches.filter((b) => subIds.has(b.submissionId));
        const avgCompleteness =
          batches.length > 0
            ? batches.reduce((n, b) => n + b.completeness.score, 0) / batches.length
            : null;
        const entityFindings = data.findings.filter((f) => f.entityId === e.id);
        const gaps = entityFindings.filter((f) => f.category === 'execution_gap').length;
        const neg = entityFindings.filter((f) => f.category === 'negative_space').length;
        const openReviews = entityFindings.filter((f) => f.status === 'new' || f.status === 'in_review').length;
        return {
          entity: e,
          submissions: subs.length,
          alertCount,
          caseCount,
          avgCompleteness,
          findings: entityFindings.length,
          gaps,
          neg,
          openReviews,
        };
      });
  }, [data, sector, peerGroup]);

  if (!data) return <div className="muted">Loading…</div>;

  const sectors = [...new Set(data.entities.map((e) => e.sector).filter(Boolean))] as string[];
  const peerGroups = [...new Set(data.entities.map((e) => e.peerGroup).filter(Boolean))] as string[];

  return (
    <div>
      <h1 className="mt-0">Entity comparison</h1>
      <p className="muted small" style={{ marginTop: -8 }}>
        Normalized indicators per entity with explicit denominators and completeness. Entities are shown for review
        planning — this table is <strong>not</strong> a ranking of institutional quality, and low numbers are not
        interpreted as better performance without completeness context.
      </p>

      {data.entities.length === 0 ? (
        <EmptyState title="No entities loaded">
          Load the synthetic demo dataset or import a submission first.
        </EmptyState>
      ) : (
        <>
          <div className="panel" style={{ padding: 14 }}>
            <div className="row" style={{ gap: 10 }}>
              <select className="select" value={sector} onChange={(e) => setSector(e.target.value)} style={{ flex: '1 1 180px' }}>
                <option value="all">All sectors</option>
                {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="select" value={peerGroup} onChange={(e) => setPeerGroup(e.target.value)} style={{ flex: '1 1 180px' }}>
                <option value="all">All peer groups</option>
                {peerGroups.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="panel">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Entity</th><th>Sector</th><th>Peer group</th><th>Submissions</th>
                    <th>Alerts</th><th>Cases</th><th>Alerts / case</th>
                    <th>Avg completeness</th><th>Findings (gaps / negative)</th><th>Open reviews</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.entity.id}>
                      <td><strong>{r.entity.name}</strong></td>
                      <td className="small">{r.entity.sector ?? '—'}</td>
                      <td className="small">{r.entity.peerGroup ?? '—'}</td>
                      <td>{r.submissions}</td>
                      <td>{r.alertCount}</td>
                      <td>{r.caseCount}</td>
                      <td className="mono">{r.caseCount > 0 ? (r.alertCount / r.caseCount).toFixed(1) : 'n/a'}</td>
                      <td>
                        {r.avgCompleteness == null ? (
                          <span className="muted small">no data</span>
                        ) : (
                          <span className={r.avgCompleteness < 0.99 ? 'small' : 'small'} style={{ color: r.avgCompleteness < 0.99 ? '#fde68a' : '#a5f3d0' }}>
                            {(r.avgCompleteness * 100).toFixed(0)}%
                          </span>
                        )}
                      </td>
                      <td className="small">
                        {r.findings} <span className="muted">({r.gaps} / {r.neg})</span>
                      </td>
                      <td>{r.openReviews}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="callout info" style={{ marginTop: 12 }}>
              <strong>Comparability caveats.</strong> “Alerts / case” normalizes by submitted case volume and inherits
              each submission's completeness. Submissions with missing categories are not penalized to zero — they are
              flagged as incomplete instead. Peer groups in the demo data are fictional.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
