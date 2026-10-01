// Audit trail: append-only event history.

import { useLiveQuery } from 'dexie-react-hooks';
import { db, exportAuditCsv } from '../lib/db';
import { download } from '../ui/components';
import { formatDateTime } from '../lib/util';

const EVENT_LABELS: Record<string, string> = {
  import: 'Import',
  normalization: 'Normalization',
  analytics_run: 'Analytics run',
  finding_status_change: 'Finding status change',
  reviewer_note: 'Reviewer note',
  report_export: 'Report export',
  dataset_generated: 'Dataset generated',
  workspace_reset: 'Workspace reset',
};

export default function AuditPage() {
  const events = useLiveQuery(() => db.auditEvents.orderBy('at').reverse().limit(500).toArray(), []);

  const doExport = async () => {
    const csv = await exportAuditCsv();
    download(`argus-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
  };

  return (
    <div>
      <div className="row between" style={{ marginBottom: 6 }}>
        <h1 className="mt-0" style={{ margin: 0 }}>Audit trail</h1>
        <button className="btn subtle small" onClick={doExport}>Export CSV</button>
      </div>
      <p className="muted small" style={{ marginTop: -6 }}>
        Append-only record of imports, normalization, analytics runs, review decisions, and exports. Events are never
        edited or deleted (the only exception is the explicit workspace reset, which is itself recorded before data
        removal). Secrets and record contents are not logged.
      </p>

      <div className="panel">
        {!events || events.length === 0 ? (
          <p className="muted">No audit events yet. They appear as you import, analyze, review, and export.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Timestamp</th><th>Actor</th><th>Event</th><th>Target</th><th>Change</th><th>Details</th></tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="mono tiny">{formatDateTime(e.at)}</td>
                    <td className="small">{e.actor}</td>
                    <td><span className="badge sev-info">{EVENT_LABELS[e.eventType] ?? e.eventType}</span></td>
                    <td className="mono tiny">{e.targetType}:{e.targetId}</td>
                    <td className="tiny">
                      {e.previousStatus || e.newStatus ? `${e.previousStatus ?? '—'} → ${e.newStatus ?? '—'}` : ''}
                    </td>
                    <td className="small muted">{e.details}</td>
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
