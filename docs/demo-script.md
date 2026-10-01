# ARGUS SAT — Demo Script (two minutes)

All data shown is **synthetic** (seed 424242, clearly banner-labelled in the app). This
script follows the suggested timeline in the problem brief and uses the actual UI.

**Setup before recording:** `bun install`, `bun run dev` (or open the hosted preview),
then in the app: **Import & demo data → “Load demo dataset” → “Run analytics”**. Reset
the workspace first (Settings → Reset workspace) if it contains data.

| Time | On screen | What to say / show |
|---|---|---|
| 0:00–0:15 | **Overview** (`#/overview`) | “ARGUS SAT is an offline supervisory analytics tool: it reviews periodic SOC evidence *submissions* across entities — it is not a SOC, SIEM, or blocking platform. Note the persistent synthetic-data banner; every number below is computed from the loaded dataset, nothing is hardcoded.” |
| 0:15–0:30 | **Import & demo data** (`#/import`) | Click **“Load demo dataset”** (5 fictional entities × 3 periods, seeded scenarios) and **“Run analytics”**. Point at the run summary (findings per rule, duration). Optionally import a hand-made CSV to show row-level validation errors, duplicate flags, and the completeness report — invalid records are flagged, never silently dropped. |
| 0:30–0:55 | **Findings** (`#/findings`) → open an **R1** finding (filter rule = R1) | “Execution gap: critical case `case:77` closed in 85 minutes with **zero** investigation actions and no automation flag.” Show the finding detail: explanation, observed values (timestamps, elapsed, actions count), rule version, evidence links (case row reference), limitations, and suggested review questions. Mention the review-priority breakdown (S/E/C/R weights, unknown components excluded, not zeroed). |
| 0:55–1:15 | Same list → open an **R5 / NS-CAT** finding | **Negative space:** a critical asset is flagged `monitoring_expected=true` in the submitted inventory, yet has no telemetry record for the period — show the expectation, the inventory evidence reference, the number of telemetry records searched, and the caveats. For NS-CAT (ENT-02 P3): the escalations category is entirely absent while other categories imported fine. Stress: absence is a signal for human confirmation, not proof. |
| 1:15–1:35 | **Entities** (`#/entities`) | Show the per-entity comparison: normalized indicators, period, peer group, and completeness. Point out ENT-02's incomplete final submission and why the low-activity check stays silent there (completeness gate — missing data is never read as zero activity), and that healthy ENT-05 produces no execution gaps. |
| 1:35–1:50 | Open any finding → record a decision | Set status to **Confirmed**, enter reviewer id + note. Then show **Audit trail** (`#/audit`): append-only decision history plus import/analytics events, exportable as CSV. A dismissed finding is never deleted. |
| 1:50–2:00 | **Reports** (`#/reports`) | Choose scope, **Preview report**, then **Download HTML report** (or CSV). Show the synthetic-data notice, methodology, evidence references, and decision history in the report. Close with: “All ingestion, analysis, review, and reporting run locally — zero network calls; the built app ships as a self-contained static bundle for air-gapped use.” |

**One-line closing:** *Evidence-backed, explainable, auditable supervisory review of SOC
submissions — fully offline.*

## Alternate fast path (30-second smoke demo)

1. `#/import` → **Load demo dataset** → **Run analytics**.
2. `#/findings` → filter **Rule = R1** → open the first finding → show evidence + limitations.
3. `#/reports` → **Preview report** → point at the synthetic banner.

## Talking points if asked

- **Why not real data?** No authorized submissions were available; the seeded dataset
  (fixed seed, separate ground truth) makes the demo reproducible and safe. Ground truth
  never feeds detection logic — it is used only by the test suite.
- **Why are some rules silent?** By design: rules are suppressed when the submission is
  incomplete (orchestrator category gates, R7 completeness gate, R5 telemetry-coverage
  gate) so missing data is never misread as zero activity or as misconduct.
- **False-positive handling:** automated playbook closures (S9) are explicitly exempted;
  the healthy entity produces no execution-gap findings.
- **Offline proof:** browser dev-tools network tab shows only local asset loads;
  `bun run build` output has no external references.
