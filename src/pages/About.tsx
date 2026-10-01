// About: product definition, scope, limitations. Honest and specific.

export default function AboutPage() {
  return (
    <div>
      <h1 className="mt-0">About ARGUS SAT</h1>

      <div className="panel">
        <h2 className="panel-title">What this tool is</h2>
        <p style={{ lineHeight: 1.65 }}>
          ARGUS SAT (Supervisory Analytics Tool for SOC Assessment) is an <strong>offline, evidence-driven
          supervisory analytics prototype</strong> for reviewing periodic SOC evidence submissions across multiple
          entities. It identifies potential execution gaps, negative-space conditions, and unusual operational
          patterns; explains every finding with source evidence; supports human review; and preserves a traceable
          audit history.
        </p>
        <p style={{ lineHeight: 1.65 }}>
          It answers one question: <em>given the SOC evidence an organization submitted, what operational weaknesses
          or missing evidence deserve supervisory review, why, and which source records support that conclusion?</em>
        </p>
      </div>

      <div className="panel">
        <h2 className="panel-title">What this tool is not</h2>
        <ul style={{ lineHeight: 1.7 }}>
          <li>Not a replacement SOC, SIEM, or real-time monitoring platform.</li>
          <li>Not a centralized SOC operating on behalf of organizations.</li>
          <li>Not an incident-response or blocking system, and not a log collector.</li>
          <li>Not a verdict: a finding is a signal for human review, never proof of negligence, malice, or non-compliance.</li>
        </ul>
      </div>

      <div className="panel">
        <h2 className="panel-title">How findings are produced</h2>
        <ol style={{ lineHeight: 1.7 }}>
          <li><strong>Import &amp; validation</strong> — CSV/JSON parsed locally; invalid records are rejected with reasons, never silently dropped; provenance (file SHA-256, row references, submission ID) is preserved.</li>
          <li><strong>Normalization</strong> — records mapped to a common evidence schema with original IDs retained.</li>
          <li><strong>Deterministic rules (R1–R8)</strong> — stable, versioned, configurable checks for execution gaps, negative space, unusual patterns, and data quality.</li>
          <li><strong>Negative-space methodology</strong> — absence findings require a defined expectation (inventory flag, severity policy, completeness baseline) plus a verified import; incomplete submissions suppress absence conclusions.</li>
          <li><strong>Prioritization</strong> — a transparent review-priority indicator with documented, configurable weights; unknown components are excluded and their weight redistributed, never treated as zero.</li>
          <li><strong>Human review</strong> — permitted statuses, append-only decision history, dismissals retained.</li>
        </ol>
        <div className="callout warn">
          <strong>Synthetic data.</strong> The bundled demonstration dataset is entirely synthetic and seeded for
          reproducibility. Screenshots and results from it demonstrate software behavior only — not real-world
          effectiveness, and no performance or compliance claims are made anywhere in this application.
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Offline &amp; security posture</h2>
        <ul style={{ lineHeight: 1.7 }}>
          <li>No runtime network calls: no CDNs, no external fonts or scripts, no telemetry, no hosted AI.</li>
          <li>All processing happens locally in your browser; storage is IndexedDB on this device.</li>
          <li>Uploaded files are treated as untrusted data: parsed, validated, and never executed.</li>
          <li>Prototype authentication is deliberately out of scope; role separation and access control are documented as future work.</li>
        </ul>
      </div>

      <div className="panel">
        <h2 className="panel-title">Known limitations</h2>
        <ul style={{ lineHeight: 1.7 }}>
          <li>No authentication/authorization — suitable for a controlled demonstration only.</li>
          <li>Review-priority weights and rule thresholds are unvalidated prototype choices.</li>
          <li>Peer comparison requires compatible data definitions and comparable completeness; the prototype only normalizes by case volume.</li>
          <li>Statistical baselines are simple medians; seasonality is not modeled.</li>
          <li>Text similarity (R6) is TF-IDF/cosine only; templates can legitimately produce similar notes.</li>
          <li>Large datasets beyond the configured row limits are out of scope for the prototype.</li>
        </ul>
      </div>
    </div>
  );
}
