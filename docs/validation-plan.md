# ARGUS SAT — Validation Plan and Measured Results

Prototype v0.1.0. The brief's suggested stack is Python/pytest; this browser
implementation uses **Vitest** (`bun run test`, Vitest 2, node environment with
fake-indexeddb for the pipeline tests). Synthetic tests demonstrate **software
behavior**, not real-world effectiveness.

## 1. Test suites and actual results

Run: `bun run test` (CI-safe non-watch mode). Last full run: **31/31 tests passing**.

| Suite | Focus | Tests |
|---|---|---|
| `tests/core.test.ts` | Deterministic utilities (PRNG, timestamp normalization, CSV round-trip, JSON records), TF-IDF similarity, ingestion validation (invalid timestamps, duplicate ids, unreadable files, unknown criticality, completeness), priority-indicator invariants (bounded score, unknown-component exclusion with weight redistribution) | 15 |
| `tests/validation.test.ts` | Ground-truth scenario detection (S1–S10), benign-trap suppression (S7/S9), healthy-entity control, precision/recall metrics, reproducibility (dataset + rule runs), finding invariants (limitations + questions + observed values on every finding) | 16 |

Also verified: `bun run typecheck` (clean, strict TypeScript, no `any`), `bun run build`
(production bundle), `bun run generate:data` (89 CSV files + `argus-demo-bundle.json` +
`ground-truth.json` in `generated-data/`).

## 2. Ground-truth protocol

- The seeded generator (seed **424242**) emits `groundTruth` labels **separately** from
  analytics inputs; detection logic never reads them. Labels are used only by this test
  suite and the metrics below.
- Positives = seeded non-benign scenarios with an expected rule. Negatives/controls =
  benign traps (S7, S9) plus the healthy entity ENT-05 (must yield zero execution-gap
  findings).
- Detection assertions match on stable source references (e.g. `case:77`, `case:88`,
  `case:99`, `-S4` alert ids) rendered in each finding's observed values.

### Scenario → rule map

| Scenario | Where seeded | Expected rule | Result |
|---|---|---|---|
| S1 fast critical closure, no actions, not automated | ENT-01..04, P2 (`case:77`) | R1 | ✅ detected |
| S2 required escalation missing | non-healthy entities, P1 (`case:88`) | R2 | ✅ detected |
| S3 open case, no investigation actions | non-healthy entities, P3 (`case:99`) | R3 | ✅ detected |
| S4 recurring alerts, no remediation | ENT-01 P2 (asset `AS-ENT-01-P2-S4`, 7 alerts) | R4 | ✅ detected |
| S5 monitoring gap (critical asset, no telemetry) | ENT-03 P1 | R5 | ✅ detected |
| S6 repetitive investigation narratives | ENT-04 P2 (5 unrelated-category cases) | R6 | ✅ detected |
| S7 low activity from incomplete submission | ENT-02 P3 | none (benign trap) | ✅ **not** flagged; missing-category path instead |
| S8 duplicate id + invalid timestamp | ENT-02 P2 | import validation (+ R8 cross-refs in CSV path) | ✅ flagged |
| S9 benign automated fast closure | ENT-05 P2 (`automated=true`, playbook action) | none (benign trap) | ✅ **not** flagged (R1 exemption; R3 exempted via `PLAYBOOK-AUTO`) |
| S10 evidence category absent | ENT-02 P3 (escalations omitted) | NS-CAT | ✅ detected |

## 3. Measured metrics (synthetic set)

- **Precision = 1.0** (no benign trap fired; asserted `expect(precision).toBe(1)`).
- **Recall = 1.0** on scenarios with an expected rule (S8 is validation-only by design;
  the suite asserts recall ≥ 0.7 to encode that honestly).
- **Evidence traceability**: every emitted finding carries ≥ 1 observed value and at
  least one evidence draft with source file + row/pointer reference (test-enforced);
  explanations always include limitations + suggested review questions (test-enforced).
- **Reproducibility**: two generator invocations produce byte-identical records and
  ground truth; two rule runs produce identical rule/observed output. Finding ids are
  content-derived (`FD-shortHash(...)`), so decisions persist across re-runs.
- **False positives beyond traps**: healthy entity ENT-05 yields zero execution-gap
  findings (test-enforced).

## 4. Documented false-positive / false-negative examples

**False positives prevented by design** (tested): automated playbook closure (S9 → R1/R3
exemptions); incomplete submission misread as quiet SOC (S7 → R7 completeness gate);
missing telemetry feed suppressing R5 (feed-coverage gate `minInventoryCoverage × 0.5`);
negative-space claims from a wholly broken import (NS-CAT requires ≥ 3 categories present);
rules asserting against categories absent from the submission (orchestrator `requires` gate).

**Known false-positive risks** (caveats shown on every finding): genuinely fast manual
closures with off-system investigation records (R1); escalations performed out-of-band
(R2); templated-but-legitimate notes (R6); noisy-but-accepted alert families (R4); quieter
periods/migrations (R7).

**Known false-negative risks**: evidence existing operationally but excluded from the
export (all negative-space rules); cross-submission references not treated as orphans
(R8); R7 stays silent under `minPeerRecords` comparison values.

## 5. Offline verification

- Build a self-contained `dist/` (`bun run build`) — no external font/script/CSS/chart
  CDNs are referenced; the favicon is an inline SVG.
- Serve `dist/` statically with networking disabled; load the app, run the demo import
  and an analytics run, and export both reports. The browser network tab shows only
  local asset loads; no request leaves the machine.
- The test suite itself runs without network access.

## 6. Performance (prototype scale, not a benchmark)

The demo dataset (15 submissions; ~700 alerts, ~230 cases, ~1 100 actions) runs full
analytics in well under a second in-browser; imports enforce 20 MB / 200 000-row file
caps. No formal performance targets have been measured beyond this demonstration scale —
no unsupported performance claims are made.

## 7. Limitations of this validation

- All metrics are on synthetic data with scenarios authored alongside the rules; they
  demonstrate software behavior and guard against regressions, **not** real-world
  detection effectiveness.
- No expert-reviewed real submissions have been evaluated; precision/recall against
  operational ground truth is unknown.
- Review-time comparison against a manual process has not been measured.
- Thresholds are prototype defaults awaiting calibration per organization/data-sharing
  agreement.
