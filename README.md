# ARGUS SAT

**Supervisory Analytics Tool for SOC Assessment (SAT-SA)** — SIH 2026 Problem Statement 26157 prototype.

ARGUS SAT is an **offline, evidence-driven supervisory analytics application** for reviewing periodic SOC
evidence submissions across multiple organizations. It identifies potential execution gaps, negative-space
conditions, and unusual operational patterns; explains every finding with source evidence; supports human
review; and preserves a traceable audit history.

> ARGUS SAT assesses *submitted* SOC evidence for supervisory review. It is **not** a live SOC, SIEM,
> threat-monitoring, or incident-response platform, and no finding constitutes proof of non-compliance.

---

## Quick start

Requires Node.js 18+ (or Bun 1.1+). All commands run from the repository root.

```bash
# 1. Install dependencies (pinned in package.json + lockfile)
bun install            # or: npm install

# 2. Start the app locally (http://localhost:3000)
bun run dev            # or: npm run dev

# 3. Generate the synthetic demonstration dataset (writes ./generated-data/)
bun run generate:data  # or: npm run generate:data
#    optional: bun run generate:data <outdir> <seed>

# 4. Run the test suite
bun run test           # or: npm run test

# 5. Typecheck
bun run typecheck      # or: npm run typecheck

# 6. Production build (static, offline-capable, outputs dist/)
bun run build          # or: npm run build
```

On first launch the app shows an empty workspace. Click
**Import & demo data → “Load demo dataset”** to populate it with the reproducible synthetic dataset, then
**“Run analytics”**. Every value in the dashboard is computed from the loaded data — nothing is hardcoded.

To deploy to an air-gapped host, see **[Offline / air-gapped deployment](#offline--air-gapped-deployment)**.

## Offline / air-gapped deployment

ARGUS SAT runs **fully offline**: no internet, no server, no runtime API calls. All ingestion, validation,
rule execution, statistics, storage, and report generation happen inside the browser tab. `src/` contains no
`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, or external URL — there is no code path that can reach
the network.

### Step 1 — Build on a connected machine (once)

```bash
bun install
bun run build          # emits dist/
```

### Step 2 — Transfer

Copy the **`dist/` directory** to the air-gapped host (USB, CD, approved transfer). It is ~384 KB in four
files and is the complete deployment artifact — no source code or `node_modules` needed.

```text
dist/
├── index.html
└── assets/
    ├── index-*.js       main application bundle
    ├── index-*.css      styles
    └── synthetic-*.js   seeded dataset generator
```

### Step 3 — Serve on the isolated host

```bash
python3 -m http.server 8000 --directory dist   # python (usually preinstalled)
npx serve dist                                  # node
php -S localhost:8000 -t dist                   # php
```

Then open **http://localhost:8000**.

> **Serve it — do not double-click `index.html`.** The app hashes uploaded files with the Web Crypto API
> (`crypto.subtle`), which browsers only expose in a *secure context*: `https://`, `http://localhost`, or
> `http://127.0.0.1`. Opening the file via `file://` leaves `crypto.subtle` undefined and imports fail.
> Serving over `localhost` (the one-line commands above) is a secure context and costs nothing.

### Step 4 — Use it

Click **Import & demo data → "Load demo dataset"**, then **"Run analytics"**. Everything works with the
network disconnected.

### Verifying the offline claim

1. Serve `dist/` as above.
2. Open browser dev-tools → **Network** → enable **Offline**.
3. Hard-refresh, then run: load demo dataset → run analytics → open a finding → export a report.

Only requests for your own local files appear. Any external request would fail loudly, which is the point of
the check. The test suite (`bun run test`) also runs without network access.

### System requirements

| Requirement | Detail |
|---|---|
| Internet at runtime | **Not required**, ever |
| Installation | **None** — copy the folder and serve it |
| Operating system | Windows, macOS, or Linux — nothing OS-specific |
| Browser | A **2021-or-newer** browser (Chrome, Edge, Firefox, Safari). The bundle uses modern JS (`??`, async/await, classes); IE11 and pre-2019 builds are not supported |
| Static file server | Recommended (see the `crypto.subtle` note above) |
| Disk / memory | ~384 KB on disk; runs in a browser tab |

### Notes

- **Data is local to the browser.** Findings, decisions, and the audit trail persist in IndexedDB per browser
  profile. Clearing site data clears the workspace — use **Settings → Reset workspace** between demonstrations,
  and use a dedicated browser profile for real reviews.
- **The dev server also runs offline** (`bun run dev` is a local-only process), but the **hosted preview URL
  requires connectivity** — that is infrastructure around the application, not a dependency of it. For an
  air-gapped demonstration, use the `dist/` build above.
- **Provenance stays verifiable offline.** File SHA-256 hashing uses the browser's native Web Crypto API and
  `crypto.getRandomValues`; no crypto library is bundled and no hashing service is contacted.
- **If the AI-assist feature is enabled** in a future iteration (a `VITE_`-prefixed model key), the
  application would no longer be strictly offline. That trade-off must be labelled explicitly and is not
  enabled by default; the core analytics path has no network dependency.

## What's inside

```text
├── src/
│   ├── lib/                  # Core domain logic (framework-free, fully unit-tested)
│   │   ├── types.ts          #   Common evidence schema + rule config model
│   │   ├── util.ts           #   Deterministic PRNG, SHA-256, CSV, ISO timestamps
│   │   ├── synthetic.ts      #   Seeded synthetic dataset generator (S1–S10 scenarios)
│   │   ├── ingest.ts         #   CSV/JSON parsing, validation, normalization, completeness
│   │   ├── textsim.ts        #   TF-IDF + cosine similarity (R6)
│   │   ├── rulekit.ts        #   Rule context + transparent priority computation
│   │   ├── rules.ts          #   Supervisory rules R1–R8 + negative-space checks
│   │   ├── pipeline.ts       #   Import pipeline + analytics run orchestrator
│   │   ├── review.ts         #   Append-only review workflow + report generation
│   │   └── db.ts             #   IndexedDB persistence (Dexie), audit helpers
│   ├── pages/                #   Overview, Entities, Findings, Finding detail,
│   │                         #   Data quality, Import, Reports, Audit, Settings, About
│   └── ui/                   #   Shared components
├── tests/                    # Vitest suites (unit + ground-truth validation)
├── scripts/
│   └── generate-synthetic.mjs# Dataset regeneration (CSVs + bundle + ground truth)
├── docs/
│   ├── architecture.md       # Components, data flow, deployment, security boundaries
│   ├── data-dictionary.md    # Common evidence schema and import formats
│   ├── validation-plan.md    # Metrics, protocol, and measured prototype results
│   └── demo-script.md        # Two-minute demonstration walkthrough
└── generated-data/           # Output of generate:data (CSVs, bundle, ground-truth.json)
```

## Supervisory rule catalogue (v1.0.0)

| ID | Title | Category |
|----|-------|----------|
| R1 | Critical case closed unusually quickly without investigation evidence | Execution gap |
| R2 | Required escalation record missing | Execution gap |
| R3 | Investigation evidence missing for a case expected to be investigated | Execution gap |
| R4 | Recurring alerts on the same asset without documented remediation | Unusual pattern |
| R5 | Expected monitoring/telemetry record missing for an asset | Negative space |
| R6 | Repetitive investigation narratives across cases (TF-IDF/cosine) | Unusual pattern |
| R7 | Unusually low activity vs baseline (completeness-gated) | Statistical anomaly |
| R8 | Data quality or submission inconsistency | Data quality |
| NS-CAT | Expected evidence category absent from a submission | Negative space |

All thresholds live in **Settings** (recorded in the audit trail) and are documented **prototype defaults**,
not official requirements. The review-priority indicator uses illustrative weights `P = 0.40·S + 0.30·E +
0.20·C + 0.10·R`; unknown components are excluded with weight redistribution, never silently zeroed.

## Review workflow

Permitted finding statuses: `New`, `In review`, `Confirmed`, `Dismissed`, `Needs more evidence`,
`Unresolved`. Decisions are **append-only**: reviewer, timestamp, prior status, and notes are retained;
dismissed findings are never deleted. Every import, analytics run, decision, and export is written to the
audit trail (exportable as CSV).

## Reports

- **Findings CSV** — spreadsheet-ready export with explanations and limitations.
- **Printable HTML report** — standalone document (scope, completeness, prioritized findings with evidence
  references, methodology, rule versions, limitations, decision history). Print to PDF locally; suitable for
  air-gapped use. Reports generated from synthetic data carry an explicit synthetic-data notice.

## Validation summary (synthetic ground truth)

Measured on the seeded dataset (`bun run test`, see `docs/validation-plan.md` for protocol):

- **10/10** non-benign seeded scenarios detected by their intended checks (S1–S6, S10; S8 via import
  validation).
- **0/2** benign traps fired (S7 low-activity-incomplete and S9 automated fast closure are correctly *not*
  flagged) — prototype precision **1.0**, recall **1.0** on the seeded set.
- **100%** of findings link to at least one source-evidence record with file + row/JSON-pointer references.
- Dataset regeneration and rule runs are byte-identical across executions (fixed seed, deterministic code).

These numbers demonstrate software behavior on synthetic data only; they make no claim about real-world
effectiveness.

## Known limitations

- **No authentication/authorization** — role separation is simulated; suitable for a controlled demonstration.
- Rule thresholds and priority weights are unvalidated prototype choices.
- Peer comparison normalizes by case volume only; seasonality is not modeled.
- Text similarity uses TF-IDF/cosine; templated notes can legitimately score high (caveats shown in-app).
- Row-count and file-size limits are configurable prototype caps (20 MB / 200k rows).

## License / data notice

Prototype produced for SIH 2026 Problem Statement 26157. All bundled demonstration data is synthetic and
fictional; do not load real operational data without appropriate authorization. Keep real submissions
separate from the synthetic workspace (use **Settings → Reset workspace** between demos).
