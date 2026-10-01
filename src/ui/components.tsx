// Small shared UI primitives.

import type { ReactNode } from 'react';
import type { FindingStatus, Severity } from '../lib/types';

export function SeverityBadge({ severity }: { severity: Severity | string }) {
  return (
    <span className={`badge sev-${severity}`}>
      <span className="dot" aria-hidden="true" />
      {severity}
    </span>
  );
}

export function StatusBadge({ status }: { status: FindingStatus | string }) {
  return <span className={`badge status-${status}`}>{String(status).replace(/_/g, ' ')}</span>;
}

export function PriorityBadge({ label, score }: { label: string; score: number | null }) {
  return (
    <span className={`badge prio-${label}`} title="Review priority — an ordering aid, not a confirmed risk score">
      {score != null ? `${label} · ${score}` : 'unknown'}
    </span>
  );
}

export function Kpi({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="big">{title}</div>
      <div>{children}</div>
    </div>
  );
}

export function download(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, data: unknown): void {
  download(filename, JSON.stringify(data, null, 2), 'application/json');
}
