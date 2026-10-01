// Overview dashboard. Every number is derived from the loaded dataset —
// nothing is hardcoded. Shows a prominent synthetic-data indicator.

import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from '../ui/Link';
import { db } from '../lib/db';
import { FINDING_CATEGORY_LABELS } from '../lib/types';
import type { Finding } from '../lib/types';
import { EmptyState, Kpi, SeverityBadge } from '../ui/components';

export default function OverviewPage() {
  const data = useLiveQuery(async () => {
    const [entities, submissions, batches, findings, runs] = await Promise.all([
      db.entities.toArray(),
      db.submissions.toArray(),
      db.importBatches.toArray(),
      db.findings.toArray(),
      db.analyticsRuns.toArray(),
    ]);
    return { entities, submissions, batches, findings, runs };
  }, []);

  if (!data) return <div className="muted">Loading…</div>;

  if (data.submissions.length === 0) {
    return (
      <div>
        <h1 className="mt-0">Overview</h1>
        <EmptyState title="No data loaded yet">
          <p>
            Import a submission on the <Link href="#/import">Import &amp; demo data</Link> page, or load the
            synthetic demonstration dataset to explore ARGUS SAT end-to-end.
          </p>
          <p className="tiny">
            ARGUS SAT assesses submitted SOC evidence for supervisory review; it is not a live SOC, SIEM, or
            threat-blocking platform.
          </p>
        </EmptyState>
      </div>
    );
  }

  const findings = data.findings;
  const needingReview = findings.filter((f) => f.status === 'new' || f.status === 'in_review');
  const gaps = findings.filter((f) => f.category === 'execution_gap');
  const negative = findings.filter((f) => f.category === 'negative_space');
  const dataQuality = findings.filter((f) => f.category === 'data_quality');
  const incompleteBatches = data.batches.filter((b) => b.completeness.missingCategories.length > 0);
  const lastRun = [...data.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

  const byCategory = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const f of findings) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
    byStatus.set(f.status, (byStatus.get(f.status) ?? 0) + 1);
  }

  // Trend: findings and alerts per period (when multiple periods exist).
  const periods = [...new Set(data.submissions.map((s) => s.periodStart))].sort();
  const perPeriod = periods.map((start) => {
    const subs = data.submissions.filter((s) => s.periodStart === start);
    const subIds = new Set(subs.map((s) => s.id));
    const periodFindings = findings.filter((f) => subIds.has(f.submissionId ?? ''));
    return {
      label: start,
      submissions: subs.length,
      findings: periodFindings.length,
      executionGaps: periodFindings.filter((f) => f.category === 'execution_gap').length,
    };
  });
  const maxFindings = Math.max(1, ...perPeriod.map((p) => p.findings));

  const topFindings = [...needingReview]
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
    .slice(0, 8);

  return (
    <div>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h1 className="mt-0" style={{ margin: 0 }}>Overview</h1>
        <span className="muted small">
          {lastRun
            ? `Last analytics run ${lastRun.finishedAt.replace('T', ' ').slice(0, 19)} UTC · run ${lastRun.id}`
            : 'Analytics not yet run'}
        </span>
      </div>
      <div className="callout warn" style={{ marginBottom: 20 }}>
        <strong>Synthetic demonstration data.</strong> All entities, records, alerts, cases, and findings in this
        workspace are synthetic (generated with a fixed seed for reproducibility). Nothing here reflects real
        organizations or real SOC performance.
      </div>

      <div className="kpi-grid">
        <Kpi label="Entities analyzed" value={data.entities.length} note="fictional organizations" />
        <Kpi label="Submissions" value={data.submissions.length} note={`${incompleteBatches.length} with completeness warnings`} />
        <Kpi label="Findings requiring review" value={needingReview.length} note={`${findings.length} total`} />
        <Kpi label="Potential execution gaps" value={gaps.length} note="workflow evidence missing or inconsistent" />
        <Kpi label="Potential missing evidence" value={negative.length} note="negative-space signals" />
        <Kpi label="Data-quality findings" value={dataQuality.length} note="distinct from operational weaknesses" />
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2 className="panel-title">Findings by category</h2>
          <p className="panel-sub">Grouped counts across the current dataset. Open Findings to filter and drill down.</p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Category</th><th>Count</th><th>Share</th></tr>
              </thead>
              <tbody>
                {byCategory.size === 0 && (
                  <tr><td colSpan={3} className="muted">No findings yet — run analytics after importing data.</td></tr>
                )}
                {[...byCategory.entries()].map(([cat, n]) => (
                  <tr key={cat}>
                    <td>{FINDING_CATEGORY_LABELS[cat as keyof typeof FINDING_CATEGORY_LABELS] ?? cat}</td>
                    <td>{n}</td>
                    <td style={{ minWidth: 140 }}>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(n / findings.length) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h2 className="panel-title">Review status</h2>
          <p className="panel-sub">Human decisions are append-only; dismissed findings remain in the audit history.</p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Status</th><th>Count</th></tr></thead>
              <tbody>
                {[...byStatus.entries()].map(([st, n]) => (
                  <tr key={st}><td><span className={`badge status-${st}`}>{st.replace(/_/g, ' ')}</span></td><td>{n}</td></tr>
                ))}
                {byStatus.size === 0 && <tr><td colSpan={2} className="muted">No findings yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Activity across reporting periods</h2>
        <p className="panel-sub">
          Findings per period with relative volume. Comparisons across periods are indicative only — data
          completeness differs per submission.
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Period starting</th><th>Submissions</th><th>Findings</th><th>Execution gaps</th><th>Relative volume</th></tr>
            </thead>
            <tbody>
              {perPeriod.map((p) => (
                <tr key={p.label}>
                  <td className="mono">{p.label}</td>
                  <td>{p.submissions}</td>
                  <td>{p.findings}</td>
                  <td>{p.executionGaps}</td>
                  <td style={{ minWidth: 160 }}>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(p.findings / maxFindings) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="row between">
          <div>
            <h2 className="panel-title">Prioritized for review</h2>
            <p className="panel-sub">
              Highest review-priority findings still open. Priority is an ordering aid — not a confirmed risk score.
            </p>
          </div>
          <Link className="btn subtle small" href="#/findings">All findings →</Link>
        </div>
        {topFindings.length === 0 ? (
          <EmptyState title="Nothing waiting for review">
            Either no findings exist yet, or reviewers have dispositioned everything so far.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Priority</th><th>Severity</th><th>Rule</th><th>Entity</th><th>Summary</th></tr>
              </thead>
              <tbody>
                {topFindings.map((f: Finding) => (
                  <tr key={f.id} className="clickable" onClick={() => { window.location.hash = `#/findings/${encodeURIComponent(f.id)}`; }}>
                    <td><span className={`badge prio-${f.priorityLabel}`}>{f.priorityScore ?? '?'} · {f.priorityLabel}</span></td>
                    <td><SeverityBadge severity={f.severity} /></td>
                    <td className="mono">{f.ruleId}</td>
                    <td>{data.entities.find((e) => e.id === f.entityId)?.name ?? f.entityId}</td>
                    <td>{f.explanation.slice(0, 120)}…</td>
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
