# ARGUS SAT — Architecture

**SIH 2026 PS 26157 · Supervisory Analytics Tool for SOC Assessment (prototype v0.1.0)**
All statements below describe the implemented prototype. Thresholds, weights, and the
suggested stack in the problem brief are *not* official NTRO/NCIIPC requirements.

## 1. Deployment model and stack (documented deviation)

The brief suggests a Python/pandas/Streamlit stack. ARGUS SAT is implemented as a
**fully client-side web application** that preserves every required property of that
stack — local processing, a local database, deterministic analytics, zero network
calls — while removing the need to install Python on reviewer machines:

| Brief suggestion | Implemented as | Why it satisfies the intent |
|---|---|---|
| pandas / NumPy processing | TypeScript modules in `src/lib/` (framework-free, unit-tested) | Same deterministic, in-process tabular logic |
| SQLite local DB | IndexedDB via Dexie (`src/lib/db.ts`) | Local persistence, no server |
| Streamlit dashboard | React 18 + Vite SPA (hash routing) | Local dashboard, static build |
| pytest | Vitest (`tests/`, 31 tests) | Same unit + ground-truth testing role |
| Offline packaging | `vite build` → self-contained `dist/` | Air-gapped: copy `dist/`, serve statically |

**Data flow is identical to the brief's architecture diagram**: files → validation →
common schema → rules / statistics / negative-space → prioritization → explainable
findings → review workbench → decisions + audit → reports.

## 2. Components

```text
src/
├── lib/                    Core domain logic (no UI dependencies)
│   ├── types.ts            Common evidence schema, config model, defaults
│   ├── util.ts             Seeded PRNG, SHA-256, CSV parse/serialize, ISO timestamps
│   ├── ingest.ts           CSV/JSON parsing, validation, normalization, completeness
│   ├── textsim.ts          TF-IDF + cosine similarity (R6)
│   ├── rulekit.ts          Rule context, baselines, transparent priority computation
│   ├── rules.ts            Rules R1–R8 + NS-CAT (stable ids, versions, caveats)
│   ├── pipeline.ts         Import pipeline, analytics orchestrator, demo loader
│   ├── review.ts           Append-only decisions, CSV + printable HTML reports
│   └── db.ts               Dexie schema, audit helpers, workspace reset
├── pages/                  Overview · Entities · Findings · Finding detail ·
│                           Data quality · Import & demo data · Reports ·
│                           Audit trail · Settings · About
└── ui/                     Shared badges/KPI/empty-state/download components
```

## 3. Persistence model (IndexedDB / Dexie)

Tables: `entities, submissions, files, importBatches, assets, alerts, cases, actions,
escalations, telemetry, findings, findingEvidence, reviewDecisions, auditEvents,
analyticsRuns`. Provenance is retained on every record: source file id, row/JSON-pointer
reference, submission id, and per-file SHA-256. `reviewDecisions` and `auditEvents` are
**append-only** (never updated or deleted); findings carry a status pointer plus full
decision history. Analytics runs are recorded with a config hash, making a run
reproducible for a fixed dataset + configuration.

## 4. Ingestion and normalization

`importSubmission()` validates one submission (entity + period + label; duplicate
label/period/entity is rejected — imports are idempotent). Per file: parse (CSV or JSON
array / `{"records":[…]}`), category detection (filename first, then header heuristics),
row-level validation (`missing_id`, `duplicate_id`, `invalid_timestamp`,
`impossible_ordering`, `unknown_criticality`, `unknown_severity`, `file_parse`), and
normalization into the common schema (see `docs/data-dictionary.md`). Invalid records are
**flagged, never silently dropped**. Limits: 20 MB/file, 200 000 rows/file. `buildCompleteness()`
produces the expected/present/missing category report that gates negative-space rules.

## 5. Analytics

- **Rules R1–R8 + NS-CAT** (catalogue v1.0.0, `docs/validation-plan.md` has the scenario map).
  The orchestrator enforces each rule's `requires` list against the submission's
  *present* categories, so no rule asserts an absence from an incomplete feed.
- **Negative space** follows the brief's methodology: explicit expectation → why expected
  (inventory flag, prototype completeness baseline) → search scope recorded → uncertainty
  + alternative causes in every explanation → human confirmation required.
- **Statistics**: TF-IDF/cosine for R6; median baseline (entity history + peer group,
  same period, ≥ `minPeerRecords` values) for R7 — suppressed unless the submission is
  complete, so missing data is never read as zero activity.
- **Priority indicator**: `P = 0.40·S + 0.30·E + 0.20·C + 0.10·R` (illustrative prototype
  weights, configurable in Settings). Unknown components are excluded with weight
  redistribution and shown as `not used` — never silently zeroed. Scores are labelled
  "review priority", not risk.
- **Stable finding IDs**: `FD-shortHash(entityId|periodStart|ruleId|observed)` so
  re-runs refresh content while reviewer decisions stay attached.

## 6. Security boundaries

- **Trust boundary = the file input.** Uploaded content is treated as untrusted: parsed,
  validated, and normalized only; never executed, deserialized into code, or rendered as
  HTML unescaped. No filesystem writes; reports are generated client-side and downloaded.
- **No network boundary to defend**: zero runtime requests (no CDNs, fonts, telemetry,
  hosted AI, model downloads). Verifiable in the browser network tab.
- **No authentication/authorization in the prototype** — roles (supervisor / analyst /
  admin) are simulated by a reviewer-identifier field. Documented limitation; suitable
  only for a controlled demonstration. Real SOC data must not be loaded without
  authorization; use Settings → Reset workspace between demos.
- **Audit trail** covers import, normalization, analytics runs, status changes, notes,
  and report exports; exportable as CSV. No secrets or unnecessary personal data are logged.

## 7. Deployment

Development: `bun install && bun run dev` (localhost only). Offline deployment:
`bun run build` produces `dist/`; transfer it to the isolated host and serve it over
`http://localhost` with any static file server (e.g. `python3 -m http.server 8000 --directory dist`).
It must be served rather than opened via `file://`, because provenance hashing uses `crypto.subtle`,
which browsers expose only in a secure context. See README § "Offline / air-gapped deployment".
A startup health check is trivial: the SPA renders an empty
workspace state without any network. Synthetic data is generated in-browser from the
seeded generator or via `bun run generate:data` (CSVs + bundle + `ground-truth.json`,
which only the test suite consumes — labels never reach detection logic).
