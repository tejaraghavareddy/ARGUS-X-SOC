# ARGUS SAT — Data Dictionary

Prototype v0.1.0. All field requirements, severity vocabularies, and the six-category
baseline are **prototype choices** (see `src/lib/types.ts` and `src/lib/ingest.ts`), not
official requirements. Optional fields may be absent or blank; missing values are never
treated as zero.

## 1. Evidence categories

A full submission is expected to contain six categories. The importer detects the
category from the filename (recommended) or from header/column heuristics:

| Category | Recommended filename | Required field (id) | Other key fields |
|---|---|---|---|
| Assets | `assets.csv` | `asset_id` | `criticality`, `monitoring_expected`, `asset_type` |
| Alerts | `alerts.csv` | `alert_id` | `asset_id`, `severity`, `opened_at`, `closed_at`, `status`, `disposition`, `alert_family` |
| Cases | `cases.csv` | `case_id` | `severity`, `status`, `opened_at`, `closed_at`, `linked_alert_ids`, `category`, `automated` |
| Investigation actions | `actions.csv` | `action_id` | `case_id`, `action_type`, `action_at`, `action_description`, `investigator` (or `investigator_reference`) |
| Escalations | `escalations.csv` | `escalation_id` | `case_id`, `destination`, `escalated_at`, `status` |
| Telemetry | `telemetry.csv` | `telemetry_id` | `asset_id`, `last_seen_at` |

Formats: CSV with a header row (quoted values supported) or JSON as an array of records
(or `{"records": [...]}`). File key = category + source id, so the same source id may
exist in different submissions/categories without collision.

## 2. Field semantics

- **Timestamps** (`opened_at`, `closed_at`, `action_at`, `escalated_at`, `last_seen_at`):
  ISO 8601 recommended; other common formats are normalized to UTC ISO. Unparseable
  timestamps on required fields **reject the record** (flagged with row reference, never
  silently dropped); on optional fields they emit a warning and the value is treated as absent.
- **Severity**: `critical | high | medium | low | info` (case-insensitive). Any other
  value → `unknown` + warning. Severity `unknown` lowers the effective severity in rules.
- **Status / disposition**: free text, lowercased; unknown values are preserved as-is.
- **`criticality`**: `critical | high | medium | low`; anything else → `unknown` + warning.
- **`monitoring_expected`**: `true/1/yes/y/required/expected` → true;
  `false/0/no/n/not_required` → false; anything else → `null` (unknown). R5 only acts on
  explicit `true`.
- **`automated`** (cases): truthy parsing as above, default `false`. Drives the documented
  R1/R2/R3 exemptions for legitimate automated playbooks.
- **`linked_alert_ids`**: `|`- or `;`-separated source alert ids; resolved to records within
  the same submission. Unresolved references are surfaced by R8 as data-quality findings.
- **`investigator`**: pseudonymous reference (synthetic data uses `INV-…`, playbooks use
  `PLAYBOOK-AUTO`); kept as submitted, used only for display.

## 3. Internal record ids and provenance

Each normalized record stores: `id` (internal `AS|AL|CS|AC|ES|TL:<submissionId>:<sourceId>`),
`sourceRecordId` (the original id, shown in the UI and findings), `fileId`, `rowRef`
(`L<n>` for CSV, `/records/<i>` for JSON), `submissionId`, `entityId`. Source files store
SHA-256, byte size, counts, import timestamp, and software version. Findings reference
evidence via `findingEvidence` rows (`sourceRecordType`, `sourceRecordId`, `sourceFileId`,
`sourceRowRef`, `evidenceRole` = supporting | contradicting | contextual).

Finding id: `FD-shortHash(entityId|periodStart|ruleId|observed-values)` — deterministic,
so decisions survive re-runs.

## 4. Completeness model

`buildCompleteness()` compares accepted records per category against the six-category
baseline and reports: `expectedCategories`, `presentCategories` (≥1 accepted record),
`missingCategories`, `acceptRate` per category (with a note when < 95 %), and `score`
(present ÷ 6). Notes explicitly distinguish *missing category* from *bad rows*, and
negative-space rules are suppressed for categories absent from an incomplete submission.

## 5. Analytics output schema (key tables)

- **Findings**: `id, entityId, submissionId, periodStart/End, category
  (execution_gap | negative_space | unusual_pattern | data_quality | statistical_anomaly),
  ruleId, ruleVersion, ruleTitle, severity, priorityScore (0–100 or null),
  priorityLabel, priorityComponents (per-component raw/weight/used/note),
  evidenceStrength (strong | moderate | weak | indicative), explanation,
  suggestedQuestions[], limitations, status (new | in_review | confirmed | dismissed |
  needs_more_evidence | unresolved), createdAt, analyticsRunId, params, observed[]`.
- **Review decisions** (append-only): `id, findingId, previousStatus, newStatus,
  reviewer, notes, at`.
- **Audit events** (append-only): `id, at, actor, eventType (import | normalization |
  analytics_run | finding_status_change | reviewer_note | report_export |
  dataset_generated | workspace_reset), targetType, targetId, previousStatus, newStatus,
  details, submissionId?`.
- **Analytics runs**: `id, startedAt, finishedAt, softwareVersion, configHash, config,
  recordCounts, findingsCreated, notes`.

## 6. Synthetic dataset

Generated with seed **424242** (`bun run generate:data` or the in-app demo loader) into
`generated-data/`: 5 fictional entities (ENT-01…ENT-05) × 3 periods (P1–P3,
2025-10-01 + 30-day periods), with assets/alerts/cases/actions/escalations/telemetry CSVs,
`argus-demo-bundle.json`, and a **separate** `ground-truth.json` consumed only by tests —
ground-truth labels never feed detection logic. Entities include one healthy (ENT-05),
one with a deliberately incomplete final submission (ENT-02), and seeded scenarios S1–S10
(mapped to rules in `docs/validation-plan.md`).

## 7. Review-priority indicator components

| Component | Meaning | Source |
|---|---|---|
| S — severity | potential issue severity (critical=100 … info=0) | rule draft |
| E — evidence | strength of supporting evidence | rule draft |
| C — criticality | affected asset/process criticality from inventory, `null` when unknown | asset lookup |
| R — recurrence | recurrence/persistence count (normalized against R4's threshold) | rule draft |

Weights (S 0.40 / E 0.30 / C 0.20 / R 0.10) are illustrative and configurable in
Settings; unknown components are excluded with weight redistribution and never zeroed.
