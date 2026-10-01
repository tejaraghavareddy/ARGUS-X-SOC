import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './lib/db';
import { SOFTWARE_VERSION } from './lib/types';
import OverviewPage from './pages/Overview';
import EntitiesPage from './pages/Entities';
import FindingsPage from './pages/Findings';
import DataQualityPage from './pages/DataQuality';
import ImportPage from './pages/Import';
import ReportsPage from './pages/Reports';
import AuditPage from './pages/Audit';
import SettingsPage from './pages/Settings';
import AboutPage from './pages/About';
import FindingDetailPage from './pages/FindingDetail';

const PAGES = [
  { hash: '#/overview', label: 'Overview', icon: '◱' },
  { hash: '#/entities', label: 'Entities', icon: '⛁' },
  { hash: '#/findings', label: 'Findings', icon: '⚑' },
  { hash: '#/data-quality', label: 'Data quality', icon: '✓' },
  { hash: '#/import', label: 'Import & demo data', icon: '⇪' },
  { hash: '#/reports', label: 'Reports', icon: '⎙' },
  { hash: '#/audit', label: 'Audit trail', icon: '❑' },
  { hash: '#/settings', label: 'Settings', icon: '⚙' },
  { hash: '#/about', label: 'About', icon: 'ℹ' },
] as const;

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash || '#/overview');
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash || '#/overview');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const hasData = useLiveQuery(async () => {
    const [subs, findings] = await Promise.all([db.submissions.count(), db.findings.count()]);
    return { subs, findings };
  }, []);

  const activeHash = route.split('?')[0];

  const findingMatch = activeHash.match(/^#\/findings\/(.+)$/);
  const page = (() => {
    if (findingMatch) return <FindingDetailPage findingId={decodeURIComponent(findingMatch[1])} />;
    switch (activeHash) {
      case '#/overview': return <OverviewPage />;
      case '#/entities': return <EntitiesPage />;
      case '#/findings': return <FindingsPage />;
      case '#/data-quality': return <DataQualityPage />;
      case '#/import': return <ImportPage />;
      case '#/reports': return <ReportsPage />;
      case '#/audit': return <AuditPage />;
      case '#/settings': return <SettingsPage />;
      case '#/about': return <AboutPage />;
      default:
        return <OverviewPage />;
    }
  })();

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div className="brand-name">ARGUS SAT</div>
            <div className="brand-sub">SOC Supervisory Analytics</div>
          </div>
        </div>
        {PAGES.map((p) => {
          const href = p.hash;
          const isActive = activeHash === p.hash || (p.hash === '#/findings' && findingMatch);
          return (
            <a key={p.hash} className={`nav-link${isActive ? ' active' : ''}`} href={href}>
              <span className="nav-icon" aria-hidden="true">{p.icon}</span>
              {p.label}
            </a>
          );
        })}
        <div className="sidebar-footer">
          ARGUS SAT v{SOFTWARE_VERSION}
          <br />
          Offline prototype · all processing local
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="row between" style={{ flex: 1 }}>
            <div className="row" style={{ gap: 12 }}>
              <span className="synthetic-banner" title="All demonstration data in this application is synthetic. No real SOC records are processed.">
                ⚠ SYNTHETIC DATA MODE
              </span>
              {hasData && (
                <span className="muted small">
                  {hasData.subs} submission{hasData.subs === 1 ? '' : 's'} · {hasData.findings} finding{hasData.findings === 1 ? '' : 's'} stored locally
                </span>
              )}
            </div>
            <span className="muted small">
              SIH26157 prototype · supervisory assessment, not a SOC replacement
            </span>
          </div>
        </header>
        <main className="content">{page}</main>
      </div>
    </div>
  );
}
