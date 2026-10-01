#!/usr/bin/env node
// Regenerate the synthetic demonstration dataset as CSV files + ground-truth.json.
// Usage: bun run generate:data [outdir] [seed]
// Output: CSVs shaped exactly like importer submissions, so they can be
// imported through the app UI (or bulk JSON) for demos and tests.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const outDir = path.resolve(args[0] ?? 'generated-data');
const seed = Number(args[1] ?? 424242);

// Build the TS source with esbuild (bundled with vite) into a temp ESM module.
const { build } = await import('esbuild');
const tmpDir = path.resolve('node_modules/.cache/argus-synthetic');
mkdirSync(tmpDir, { recursive: true });
const outfile = path.join(tmpDir, 'synthetic.mjs');
await build({
  entryPoints: [path.resolve('src/lib/synthetic.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const { generateDataset } = await import(pathToFileURL(outfile).href);
const dataset = generateDataset(seed);

mkdirSync(outDir, { recursive: true });

function csv(rows) {
  const escape = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map((v) => escape(String(v ?? ''))).join(',')).join('\r\n') + '\r\n';
}

// Per-entity-period submission files.
const bySub = new Map();
const put = (sub, kind, row) => {
  if (!bySub.has(sub)) bySub.set(sub, new Map());
  const m = bySub.get(sub);
  if (!m.has(kind)) m.set(kind, []);
  m.get(kind).push(row);
};

for (const a of dataset.assets)
  put(a.submissionId, 'assets', [a.sourceRecordId, a.criticality, String(a.monitoringExpected), a.assetType ?? '']);
for (const al of dataset.alerts)
  put(al.submissionId, 'alerts', [al.id, al.assetId ?? '', al.severity, al.openedAt ?? '', al.closedAt ?? '', al.status, al.disposition, al.alertFamily ?? '']);
for (const c of dataset.cases)
  put(c.submissionId, 'cases', [c.id, c.severity, c.status, c.openedAt ?? '', c.closedAt ?? '', c.linkedAlertIds.join('|'), c.category ?? '', String(c.automated ?? false)]);
for (const ac of dataset.actions)
  put(ac.submissionId, 'actions', [ac.id, ac.caseId, ac.actionType, ac.actionAt ?? '', ac.actionDescription ?? '', ac.investigatorReference]);
for (const es of dataset.escalations)
  put(es.submissionId, 'escalations', [es.id, es.caseId, es.destination ?? '', es.escalatedAt ?? '', es.status]);
for (const t of dataset.telemetry)
  put(t.submissionId, 'telemetry', [t.id, t.assetId ?? '', t.lastSeenAt ?? '']);

const HEADERS = {
  assets: ['asset_id', 'criticality', 'monitoring_expected', 'asset_type'],
  alerts: ['alert_id', 'asset_id', 'severity', 'opened_at', 'closed_at', 'status', 'disposition', 'alert_family'],
  cases: ['case_id', 'severity', 'status', 'opened_at', 'closed_at', 'linked_alert_ids', 'category', 'automated'],
  actions: ['action_id', 'case_id', 'action_type', 'action_at', 'action_description', 'investigator'],
  escalations: ['escalation_id', 'case_id', 'destination', 'escalated_at', 'status'],
  telemetry: ['telemetry_id', 'asset_id', 'last_seen_at'],
};

let fileCount = 0;
for (const [subId, kinds] of bySub) {
  const dir = path.join(outDir, subId);
  mkdirSync(dir, { recursive: true });
  for (const [kind, rows] of kinds) {
    const body = csv([HEADERS[kind], ...rows]);
    writeFileSync(path.join(dir, `${kind}.csv`), body, 'utf8');
    fileCount++;
  }
}

// Bulk JSON bundle (single import path in the UI).
const bundle = {
  meta: {
    seed,
    generator_version: dataset.generatorVersion,
    generated_at: dataset.generatedAt,
    is_synthetic: true,
    entities: dataset.entities.map((e) => ({ id: e.id, name: e.name, sector: e.sector, peer_group: e.peerGroup })),
    periods: dataset.periods,
  },
  assets: dataset.assets,
  alerts: dataset.alerts,
  cases: dataset.cases,
  actions: dataset.actions,
  escalations: dataset.escalations,
  telemetry: dataset.telemetry,
};
writeFileSync(path.join(outDir, 'argus-demo-bundle.json'), JSON.stringify(bundle, null, 2), 'utf8');

// Ground truth lives SEPARATELY from anything the app ingests.
const gt = {
  seed,
  note: 'Validation-only labels. Never import this file into the analytics pipeline.',
  labels: dataset.groundTruth,
  scenario_index: Object.fromEntries(dataset.scenarioIndex),
};
writeFileSync(path.join(outDir, 'ground-truth.json'), JSON.stringify(gt, null, 2), 'utf8');

writeFileSync(
  path.join(outDir, 'README.txt'),
  `ARGUS SAT synthetic dataset (seed ${seed})
Generated ${dataset.generatedAt} by generator v${dataset.generatorVersion}.

- argus-demo-bundle.json : bulk JSON import bundle for the app (Import page).
- <SUBMISSION_ID>/*.csv  : per-submission CSV files (individual file imports).
- ground-truth.json      : VALIDATION ONLY. Do not import into the pipeline.

All names, records, and events are fictional synthetic data.
`,
  'utf8'
);

console.log(`Wrote ${fileCount} CSV files, bundle JSON, and ground-truth.json to ${outDir}`);
