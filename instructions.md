# ARGUS SAT --- Coding Agent Build Instructions

## SIH 2026 Problem Statement 26157: Supervisory Analytics Tool for SOC Assessment (SAT-SA)

**Document purpose:** This file is the primary implementation brief for
a coding agent tasked with building a complete, demonstrable prototype
for SIH Problem Statement 26157.

**Working product name:** ARGUS SAT\
**Official problem reference:** SIH26157\
**Problem owner stated in secondary reproductions:** National Technical
Research Organisation (NTRO)\
**Supervisory context stated in the brief:** NCIIPC / Critical Sector
Entities\
**Product category:** Software\
**Deployment constraint:** Fully offline / air-gapped capable

> **Authority and uncertainty notice:** This specification consolidates
> the problem research available to the team and proposes a concrete
> implementation. Some public materials reviewed are secondary
> reproductions, not official SIH portal records. Before submission,
> verify the official problem statement, deadlines, evaluation weights,
> data availability, and any clarifications in the official SIH portal.
> Do not represent proposed architecture, example data, thresholds, or
> scoring weights in this document as official NTRO requirements.

------------------------------------------------------------------------

# 1. Mission and Product Goal

Build **ARGUS SAT**, an explainable, offline supervisory analytics
application that helps authorized human reviewers assess the operational
effectiveness of multiple organizations' Security Operations Centres
(SOCs) using periodic submitted evidence.

The product should not simply display alert counts or compliance claims.
It must analyze records and surface evidence-backed potential weaknesses
in how alerts and cases are detected, investigated, escalated, closed,
and monitored.

The main question the application helps answer is:

> Given the SOC evidence submitted by an organization, what operational
> weaknesses or missing evidence deserve supervisory review, why do they
> deserve review, and which source records support that conclusion?

The application is a **supervisory assessment tool**, not an operational
SOC replacement.

## 1.1 Primary outcomes

1.  Identify potential execution gaps: expected security workflows that
    appear not to have been followed effectively.
2.  Identify negative space: expected evidence, monitoring records, or
    workflow events that are absent.
3.  Detect unusual operational patterns and recurring weaknesses.
4.  Compare entities fairly using normalized metrics and suitable peer
    groups.
5.  Prioritize findings for human review without treating model scores
    as proof.
6.  Explain every finding and link it to its source evidence.
7.  Preserve data provenance, reviewer decisions, and an auditable
    history.
8.  Operate fully offline after installation, including imports,
    analysis, visualization, and report generation.
9.  Provide a polished demonstration using clearly labeled synthetic
    data when real approved data is unavailable.

## 1.2 Product principles

-   **Evidence first:** Every finding must reference the data and logic
    that produced it.
-   **Human in the loop:** The application recommends review; a human
    reviewer makes the final determination.
-   **Explainable by design:** Avoid opaque scores without reasons.
-   **Offline by default:** No runtime calls to cloud services, hosted
    AI, external APIs, telemetry, or CDNs.
-   **Conservative conclusions:** Missing or anomalous evidence is a
    signal to investigate, not automatic proof of misconduct or failure.
-   **Reproducibility:** Same input data, configuration, and software
    version should yield reproducible outputs.
-   **Privacy and security:** Treat operational SOC data as sensitive.
    Use local processing and avoid sending data externally.
-   **Useful MVP first:** Implement deterministic checks and
    traceability before adding complex ML.
-   **No invented claims:** Do not claim performance, compliance,
    accuracy, or superiority without measured evidence.

------------------------------------------------------------------------

# 2. Scope and Non-Goals

## 2.1 In scope

-   Periodic imports of SOC alert metadata, case-management exports,
    investigation workflow records, escalation records, closure records,
    and asset inventory where available.
-   CSV and JSON import in the MVP.
-   Schema mapping and validation.
-   Multi-entity and multi-period analysis.
-   Rule-based execution-gap detection.
-   Negative-space and expected-evidence checks.
-   Statistical baselines and optional unsupervised anomaly detection.
-   Repetitive investigation-text analysis where text is available.
-   Explainable findings and review prioritization.
-   Entity comparison with explicit caveats about data quality and
    comparability.
-   A supervisor review workbench.
-   Local database storage.
-   Audit trail and evidence provenance.
-   Local dashboard and exportable reports.
-   Synthetic data generation and a reproducible demonstration.
-   Automated tests, offline deployment documentation, and a short demo
    workflow.

## 2.2 Explicit non-goals

Do **not** turn the product into any of the following:

-   A replacement SOC for an organization.
-   A real-time threat monitoring or incident response platform.
-   A conventional SIEM product.
-   A centralized SOC operating on behalf of multiple organizations.
-   A continuous log or telemetry collection platform.
-   A national cyber-monitoring platform.
-   An endpoint agent, packet sensor, or live network intrusion
    detection system.
-   An automatic incident-response or blocking system.
-   A tool that declares an organization negligent, malicious, or
    non-compliant solely from an anomaly score.

The application may analyze SIEM-style exports, but its product role is
supervisory assessment of submitted evidence.

------------------------------------------------------------------------

# 3. User Roles and Main Workflow

## 3.1 Roles

For the prototype, implement simple local role separation or clearly
documented simulated roles:

-   **Supervisor/reviewer:** imports submissions, reviews findings,
    records decisions, and generates reports.
-   **Analyst/technical operator:** checks data quality, investigates
    supporting evidence, and maintains rule configuration.
-   **Administrator:** manages local settings and access controls where
    implemented.

If full authentication is beyond the MVP, do not pretend the prototype
has production-grade access control. Clearly document the limitation and
keep it suitable for a controlled demo with synthetic data.

## 3.2 Primary workflow

1.  Start the application in a local environment.
2.  Create or select a review workspace.
3.  Import a data submission for an entity and reporting period.
4.  Validate the input and display errors, warnings, and completeness
    metrics.
5.  Map source fields to the common schema if necessary.
6.  Normalize and store the records while preserving source identifiers
    and provenance.
7.  Run deterministic supervisory rules.
8.  Run optional statistical/ML analytics only when the relevant data
    volume and quality are adequate.
9.  Correlate duplicate or related findings without destroying
    individual evidence links.
10. Calculate transparent review-priority indicators.
11. Display entity-level summaries and prioritized findings.
12. Open any finding to inspect the supporting records, rule/model
    explanation, caveats, and data quality.
13. Let the reviewer mark the finding as confirmed, dismissed, needs
    more evidence, or unresolved.
14. Record the reviewer, timestamp, notes, and decision history.
15. Export a report containing methodology, findings, evidence
    references, caveats, and review status.

------------------------------------------------------------------------

# 4. Required Modules

Implement modules in the following order. The first five modules plus
evidence traceability form the core MVP.

## 4.1 Data ingestion and validation

Requirements:

-   Support CSV and JSON files in the MVP.
-   Allow the user to select the entity and reporting period.
-   Validate file type, encoding, required fields, timestamp formats,
    severity values, IDs, and references between records.
-   Detect duplicates and conflicting records.
-   Identify missing, malformed, and unexpected values.
-   Distinguish a true negative-space finding from a data submission
    that is simply incomplete.
-   Provide row-level validation messages with source file and
    row/record references.
-   Never silently discard invalid records.
-   Preserve the original file or a cryptographic hash and immutable
    import metadata where feasible.
-   Make repeated imports idempotent where possible, or clearly detect
    duplicate submissions.
-   Do not execute macros, scripts, or code embedded in input files.
-   Enforce reasonable file-size and row-count limits configurable for
    the prototype.

Output: - Import summary - Accepted/rejected record counts - Warnings
and errors - Data completeness report - Source/provenance metadata

## 4.2 Evidence normalization

Create a common schema for entities, assets, alerts, cases,
investigation actions, escalations, and source evidence.

Requirements:

-   Preserve original source IDs.
-   Preserve source file, source row/record reference, import batch ID,
    and original timestamps.
-   Keep original values when normalizing severity, status, and
    timestamps.
-   Record normalization transformations.
-   Avoid merging records solely because their text looks similar.
-   Support multiple entities and reporting periods.
-   Document any fields that are optional or unavailable.

## 4.3 Supervisory rule engine

Implement deterministic, configurable rules. Each rule must have:

-   Stable rule ID and version.
-   Human-readable title and description.
-   Required input fields.
-   Trigger conditions.
-   Severity/priority guidance.
-   Evidence references.
-   Explanation template.
-   Known limitations and false-positive scenarios.
-   Test cases.
-   Enabled/disabled configuration.

At minimum, implement the initial rules in Section 7.

## 4.4 Negative-space analysis

Check for expected but absent evidence. Examples:

-   Critical assets expected to be monitored but with no telemetry
    record in the submitted period.
-   A case requiring investigation evidence but with no investigation
    action submitted.
-   A workflow requiring escalation but with no corresponding escalation
    record.
-   Expected reporting periods or data categories missing from a
    submission.
-   Unexpectedly low activity compared with an appropriate baseline,
    after validating submission completeness.

Important: negative-space checks require a defined expectation. Do not
flag the absence of a record if the system has no basis for expecting
that record. For example, a monitoring gap requires asset inventory or
an explicit monitoring expectation.

## 4.5 Statistical and ML analytics

Build these after rule-based checks are reliable.

Potential techniques: - Median, percentile, interquartile range, and
rolling baseline comparisons. - Isolation Forest for suitable numerical
feature sets. - Clustering for identifying distinct operational
patterns. - TF-IDF and cosine similarity for repetitive investigation
notes. - Local text embeddings only if packaged and runnable without
network access.

Requirements: - Models must not be downloaded at runtime. - Make model
availability and version visible. - Do not run a model if the input data
is too small, invalid, or outside its supported schema. - Provide a
deterministic baseline/fallback if a model cannot run. - Display the
features or comparisons contributing to a flag where feasible. - Keep
model output separate from verified facts. - Do not train or evaluate on
the same examples and then present the result as independent
validation. - Record model version, parameters, input period, and run
timestamp. - Do not introduce an LLM dependency into the core MVP.

## 4.6 Correlation and prioritization

-   Group related findings when they share an entity, asset, case, time
    window, or underlying cause.
-   Keep all source findings available for drill-down.
-   Avoid counting the same underlying event multiple times in a summary
    without explaining the aggregation.
-   Calculate a transparent review-priority indicator, not a claim of
    objective organizational risk.
-   Allow the reviewer to sort/filter by severity, evidence strength,
    recurrence, entity, period, rule, and status.
-   Show the reason for priority and any uncertainty.

## 4.7 Supervisor review workbench

Each finding detail view must display:

-   Finding ID.
-   Entity and reporting period.
-   Finding category.
-   Rule/model name and version.
-   Trigger explanation.
-   Source record references.
-   Relevant timestamps and observed values.
-   Expected condition or comparison baseline.
-   Data-quality caveats.
-   Confidence/evidence-strength label with a documented meaning.
-   Suggested review questions.
-   Reviewer decision, notes, reviewer identifier, and timestamp.
-   Decision history.

Permitted review statuses: - New - In review - Confirmed - Dismissed -
Needs more evidence - Unresolved

A dismissed finding must not be deleted from the audit history.

## 4.8 Reporting and audit trail

Reports should include: - Scope, entity, period, and import batch. -
Data completeness and validation warnings. - Summary counts by finding
category and review status. - Prioritized findings. - Evidence
references and explanations. - Rule/model versions and configuration. -
Limitations and caveats. - Reviewer decisions and dates. - Export
generation timestamp.

Support CSV export and a printable HTML report in the MVP. PDF export
may be added if practical and reliably supported offline.

Audit events should include import, normalization, analytics run,
finding status changes, reviewer notes, and report export. Do not store
secrets or unnecessary personal data in logs.

------------------------------------------------------------------------

# 5. Proposed Architecture

This is a proposed implementation architecture, not an official
architecture mandated by NTRO.

``` text
Periodic SOC Data Submissions
            |
            v
Local File Import (CSV / JSON)
            |
            v
Validation + Data Quality Checks
            |
            v
Common Evidence Schema
            |
            +-------------------+--------------------+
            |                   |                    |
            v                   v                    v
   Supervisory Rules    Statistical / ML      Negative-Space
                        Analytics             Analysis
            |                   |                    |
            +-------------------+--------------------+
                                |
                                v
                   Correlation and Prioritization
                                |
                                v
                Explainable Findings + Evidence Links
                                |
                                v
                    Supervisor Review Workbench
                                |
                                v
                    Human Decisions + Audit Trail
                                |
                                v
                     Dashboard and Local Reports
```

## 5.1 Suggested technology stack

Prefer a small, reliable Python-first implementation:

-   Python 3.11 or another compatible version supported by the chosen
    dependencies.
-   pandas and NumPy for tabular processing.
-   scikit-learn for optional anomaly detection.
-   Streamlit for the first dashboard.
-   Plotly for charts, provided required assets are packaged locally and
    do not rely on a CDN.
-   SQLite for the MVP database.
-   FastAPI only if a separate API is justified; do not add unnecessary
    services.
-   pytest for tests.
-   Docker is optional; if used, images must be preloaded for offline
    deployment.
-   Local Python virtual environment and pinned dependencies are
    acceptable for the initial deployment.

Avoid unnecessary microservices, cloud dependencies, Kubernetes,
distributed queues, and complex frontend frameworks unless a concrete
requirement justifies them.

## 5.2 Suggested repository layout

``` text
argus-sat/
├── app.py
├── README.md
├── instructions.md
├── requirements.txt
├── config/
│   ├── settings.example.yaml
│   └── rules.yaml
├── ingestion/
│   ├── import_data.py
│   ├── validate_data.py
│   └── normalize.py
├── analytics/
│   ├── execution_gaps.py
│   ├── negative_space.py
│   ├── statistics.py
│   ├── anomaly_detection.py
│   ├── text_similarity.py
│   ├── correlation.py
│   └── prioritization.py
├── evidence/
│   ├── provenance.py
│   └── audit.py
├── database/
│   ├── schema.py
│   └── repository.py
├── review/
│   ├── workflow.py
│   └── reports.py
├── synthetic_data/
│   ├── generate.py
│   └── schemas/
├── tests/
│   ├── test_ingestion.py
│   ├── test_rules.py
│   ├── test_negative_space.py
│   ├── test_prioritization.py
│   ├── test_audit.py
│   └── test_offline_mode.py
└── docs/
    ├── architecture.md
    ├── data_dictionary.md
    ├── validation_plan.md
    └── demo_script.md
```

Adapt the layout if the project remains smaller, but maintain separation
between ingestion, analytics, persistence, UI, and testing.

------------------------------------------------------------------------

# 6. Data Model

Use a relational schema for the MVP. Proposed tables/entities:

## 6.1 Organization / Entity

Fields: - `entity_id` (stable primary key) - `entity_name` (fictional in
demo data) - `sector` (optional) - `peer_group` (optional) -
`reporting_period_start` - `reporting_period_end` - `submission_id` -
`created_at`

## 6.2 Asset

Fields: - `asset_id` - `entity_id` - `asset_criticality` -
`monitoring_expected` (nullable/unknown allowed) - `asset_type`
(optional) - `source_record_id` - `submission_id`

## 6.3 Alert

Fields: - `alert_id` - `entity_id` - `asset_id` (nullable) -
`severity` - `opened_at` - `closed_at` (nullable) - `status` -
`disposition` - `source_record_id` - `submission_id`

## 6.4 Case

Fields: - `case_id` - `entity_id` - `severity` - `status` -
`opened_at` - `closed_at` (nullable) - `linked_alert_ids` or a
relationship table - `source_record_id` - `submission_id`

## 6.5 Investigation action

Fields: - `action_id` - `case_id` - `action_type` - `action_at` -
`action_description` (optional) - `investigator_reference` (synthetic or
pseudonymous) - `source_record_id` - `submission_id`

## 6.6 Escalation

Fields: - `escalation_id` - `case_id` - `destination` (optional) -
`escalated_at` - `status` - `source_record_id` - `submission_id`

## 6.7 Finding

Fields: - `finding_id` - `entity_id` - `period_start` - `period_end` -
`category` - `rule_id` or `model_id` - `rule_version` - `severity` -
`priority_score` (nullable) - `evidence_strength` - `explanation` -
`limitations` - `status` - `created_at` - `analytics_run_id`

## 6.8 Finding evidence

Fields: - `finding_id` - `source_record_type` - `source_record_id` -
`source_file_id` - `source_row_or_json_pointer` - `evidence_role`
(supporting, contradicting, contextual)

## 6.9 Review and audit events

Store reviewer decisions and audit events as append-only records where
practical. At minimum, retain: - event ID - actor/reviewer ID or local
role - event type - target type and ID - timestamp - previous status and
new status when applicable - notes/reason - analytics run or submission
ID when applicable

Do not overwrite the only copy of a prior reviewer decision.

------------------------------------------------------------------------

# 7. Initial Rule Catalogue

Implement each rule with unit tests and a human-readable explanation.
Thresholds must be configurable and clearly identified as prototype
defaults.

## R1 --- Critical case closed unusually quickly

Potential trigger: - Case severity is critical. - Closure time is below
a configurable threshold or a valid peer/historical baseline. -
Supporting investigation evidence is absent or unusually sparse.

Evidence: - Case ID, severity, open/close timestamps, elapsed time,
investigation actions, and applicable rule configuration.

Caveat: - Fast closure alone is not proof of improper handling.
Automated resolution or an earlier linked investigation may explain it.

## R2 --- Required escalation missing

Potential trigger: - A defined policy or configured workflow says a
particular class of case requires escalation. - No matching escalation
record exists in the submitted evidence.

Evidence: - Case ID, severity/category, applicable policy rule,
escalation records searched, and submission completeness.

Caveat: - The record may be absent from the export rather than absent
from the actual process.

## R3 --- Investigation evidence missing

Potential trigger: - A case is in a status or category for which
investigation evidence is expected. - No required investigation action
or evidence record is present.

Evidence: - Case ID, expected evidence type, actual linked actions, and
source records.

Caveat: - Ensure the expected workflow is configured for that case type.

## R4 --- Recurring alerts without documented remediation

Potential trigger: - Repeated alerts affect the same asset or alert
family within a configurable time window. - No corresponding remediation
or root-cause evidence is found.

Evidence: - Alert IDs, asset ID, recurrence count, time range, linked
cases, and remediation search result.

Caveat: - Recurrence may be expected for a known noisy alert;
distinguish legitimate repeat activity from an unresolved issue.

## R5 --- Expected telemetry or monitoring record missing

Potential trigger: - An asset is explicitly marked as requiring
monitoring during the period. - No relevant telemetry or monitoring
evidence is present in the submitted data.

Evidence: - Asset ID, criticality, expected monitoring flag, reporting
period, and available last-seen records.

Caveat: - Only run if inventory and monitoring expectations are
sufficiently complete.

## R6 --- Repetitive investigation patterns

Potential trigger: - Investigation descriptions across different cases
are unusually similar, especially where cases appear unrelated.

Method: - Begin with TF-IDF/cosine similarity if there is enough text. -
Keep similarity thresholds configurable. - Avoid comparing records that
are expected to share a template.

Evidence: - Case IDs, text fields used, similarity measure, and matching
snippets or terms where safe to display.

Caveat: - Templates and standard operating procedures naturally produce
similar wording.

## R7 --- Unusually low or absent activity

Potential trigger: - Activity is materially below a suitable historical
baseline or peer comparison. - Data completeness checks do not indicate
that the submission itself is missing.

Evidence: - Baseline period, observed count/rate, expected range,
reporting completeness, and comparison group.

Caveat: - Low activity can reflect a quieter period, system migration,
or reporting changes. Never label it a security failure without review.

## R8 --- Data quality or submission inconsistency

Potential trigger: - Invalid timestamps, duplicate IDs, impossible event
ordering, unresolved references, or conflicting status values.

Evidence: - Source file and row/record references, failed validation
rule, and impact on downstream analytics.

Caveat: - Data-quality findings must be distinguished from operational
SOC weaknesses.

------------------------------------------------------------------------

# 8. Negative-Space Methodology

Negative space is a core differentiator. Implement it explicitly rather
than treating it as a generic anomaly score.

For each negative-space check:

1.  Define what evidence is expected.
2.  Define why it is expected (policy, inventory flag, configured
    workflow, known reporting requirement, or validated baseline).
3.  Define the entity and time window in which it should appear.
4.  Search the relevant records.
5.  Check data completeness and import errors.
6.  If expected evidence is absent, create a finding that states the
    expectation and the absence.
7.  Attach evidence for the expectation and the search scope.
8.  Explain uncertainty and alternative causes.
9.  Ask a human reviewer to confirm whether the absence is meaningful.

Do not infer a missing event from an incomplete dataset without clearly
flagging that uncertainty.

------------------------------------------------------------------------

# 9. Peer Benchmarking and Comparability

Peer benchmarking must avoid misleading comparisons.

-   Compare entities only when their data definitions, time windows, and
    completeness are sufficiently compatible.
-   Prefer normalized rates over raw counts, such as incidents per asset
    or percentage of eligible cases with documented escalation.
-   Display denominator, reporting period, peer-group definition, and
    completeness.
-   Avoid comparing unlike sectors or substantially different asset
    populations without an explicit rationale.
-   Suppress or caveat comparisons with too few records.
-   Make missing values distinct from zero.
-   Never convert a missing submission into a score of zero.
-   Do not claim that an entity is objectively better or worse based
    only on an unvalidated synthetic score.

------------------------------------------------------------------------

# 10. Transparent Review-Priority Indicator

An illustrative prototype score may be calculated as:

`P = 0.40*S + 0.30*E + 0.20*C + 0.10*R`

Where all inputs are normalized to 0--100: - `S`: potential issue
severity. - `E`: strength of supporting evidence. - `C`: criticality of
affected asset/process. - `R`: recurrence or persistence.

**These weights are illustrative only and are not official SIH or NTRO
weights.**

Implementation requirements: - Keep weights in configuration. - Explain
every component on the finding detail page. - Permit `unknown` or
`not applicable` values; do not silently treat them as zero. - Document
how missing components affect the score. - Do not display excessive
precision that suggests false certainty. - Use labels such as "review
priority" rather than "confirmed risk". - Validate usefulness with
expert review before treating it as operationally meaningful. - Preserve
the raw evidence and rule outputs separately from the aggregate score.

A simpler rule-based priority category is acceptable for the MVP if it
is more transparent and robust.

------------------------------------------------------------------------

# 11. Dashboard and UX Requirements

Create a clean, professional, responsive dashboard appropriate for a
cybersecurity supervisory audience. Prefer clarity and evidence access
over decorative charts.

## 11.1 Overview page

Show: - Selected reporting period and entity scope. - Number of entities
analyzed. - Number of submissions and data completeness warnings. -
Findings requiring review, grouped by category and status. - Potential
execution gaps. - Potential missing evidence. - Trends over time when
multiple periods exist. - A prominent indicator when all data is
synthetic.

All KPI values must be derived from the loaded dataset. Do not hardcode
example numbers in the live dashboard.

## 11.2 Entity comparison page

Show: - Entity table with normalized indicators. - Reporting period and
denominator. - Peer group and completeness. - Finding categories and
trend. - Filters by sector, period, rule, severity, and review status. -
Caveats where the comparison is unreliable.

Do not show a ranking as a final judgment of institutional quality. Use
review-oriented labels and explain the underlying measures.

## 11.3 Findings page

Allow: - Search and filtering. - Sorting by review priority, severity,
recurrence, date, and status. - Opening a detailed evidence view. -
Linking to source records. - Reviewing supporting and contradictory
evidence. - Recording decisions and comments. - Viewing the full
decision history.

## 11.4 Data quality page

Show: - Import batches and source filenames. - Accepted/rejected record
counts. - Missing fields. - Invalid timestamps. - Duplicate IDs. -
Orphaned references. - Reporting gaps. - Warnings that affect analytical
validity.

## 11.5 Reports page

Allow: - Selection of entity and period. - Preview before export. -
Export to CSV and printable HTML. - Include methodology, source
references, limitations, and review status. - Mark reports generated
from synthetic data.

## 11.6 Accessibility and UX

-   Use readable labels and sufficient contrast.
-   Do not rely on color alone to communicate severity.
-   Provide empty states and actionable validation messages.
-   Keep important caveats visible.
-   Make the synthetic-data mode unmistakable.
-   Use stable IDs and timestamps consistently.
-   Ensure a reviewer can reach the source evidence in as few steps as
    practical.

------------------------------------------------------------------------

# 12. Synthetic Dataset and Demo Requirements

If authorized real data is unavailable, generate a reproducible
synthetic dataset.

Suggested initial size (not an official requirement): - 5 fictional
entities. - 200--1,000 alerts. - 50--200 cases. - Multiple assets and
criticality levels. - Several reporting periods if practical. - Normal
records plus deliberately seeded edge cases and anomalies.

Seed examples: - Critical case closed rapidly with no recorded
investigation actions. - Case that should have been escalated but lacks
an escalation record. - Repeated alerts without recorded remediation. -
Critical asset with monitoring expected but no telemetry record. -
Repetitive investigation notes. - Low activity caused by a deliberately
incomplete submission. - Duplicate alert IDs and invalid timestamps. - A
legitimate automated resolution to test false-positive handling. - A
complete and healthy entity to avoid an unrealistic all-bad dataset.

Requirements: - Use a fixed random seed for reproducibility. - Store
synthetic ground-truth labels separately from analytics inputs. - Do not
leak ground-truth labels into features used by the detection logic. -
Clearly label all records and screenshots as synthetic. - Include a
script that regenerates the dataset. - Include expected findings for
regression tests. - Ensure the dashboard values are calculated from the
dataset.

------------------------------------------------------------------------

# 13. Validation and Evaluation Plan

The system must be tested against known examples and, if authorized
expert-reviewed records become available, against those records as well.

## 13.1 Metrics

-   Precision, recall, and F1 for labeled execution-gap scenarios.
-   Detection rate for seeded negative-space scenarios.
-   False-positive rate and false-negative examples.
-   Evidence traceability coverage: percentage of findings with valid
    source references.
-   Explanation completeness.
-   Review time compared with a documented manual process.
-   Runtime and memory as dataset size increases.
-   Stability under missing or malformed input.
-   Successful operation with network access disabled.

## 13.2 Testing protocol

1.  Generate synthetic records and separate development/test sets.
2.  Define rules and thresholds before evaluating the held-out test set.
3.  Run unit tests for every rule and data-quality check.
4.  Measure true positives, false positives, true negatives, and false
    negatives where ground truth exists.
5.  Review edge cases and legitimate alternative explanations.
6.  Confirm each finding can be traced to its evidence.
7.  Compare review time with a clearly documented manual baseline.
8.  Test larger input sizes and missing fields.
9.  Disconnect networking and test the complete application.
10. Document limitations and avoid claims unsupported by results.

Synthetic tests demonstrate software behavior, not real-world
effectiveness. Any claim of superiority to manual review requires a
fair, measured comparison.

------------------------------------------------------------------------

# 14. Security, Privacy, and Offline Deployment

The deployment environment is intended to be isolated. Treat offline
operation as a functional requirement, not a cosmetic feature.

## 14.1 Offline requirements

-   No cloud database or hosted inference service.
-   No runtime web API calls.
-   No external font, JavaScript, CSS, chart, or image CDN dependency.
-   No model downloads during execution.
-   No telemetry or analytics sent to third parties.
-   All required Python packages, assets, and model files must be
    preinstalled or transferred through an approved offline process.
-   Provide a documented offline installation procedure.
-   Provide a startup health check that does not require Internet
    access.
-   Include an offline verification test.

## 14.2 Security requirements

-   Validate all uploaded files and input fields.
-   Treat uploaded data as untrusted.
-   Prevent path traversal and arbitrary file writes.
-   Avoid dynamic code execution and unsafe deserialization.
-   Do not evaluate imported content as code.
-   Keep secrets out of source control.
-   Restrict file access to configured workspace directories.
-   Do not expose the local application beyond the intended interface
    without explicit configuration.
-   Record relevant audit events.
-   Document authentication and authorization limitations if the
    prototype does not implement them.
-   Keep synthetic demonstration data separate from any future sensitive
    data.

## 14.3 Integrity and provenance

Where feasible: - Calculate a cryptographic hash for each original input
file. - Record import time, software version, submission ID, and file
hash. - Preserve source record identifiers and transformations. -
Associate each finding with source evidence. - Record rule/model version
and parameters. - Record reviewer actions as a history rather than
overwriting prior decisions. - Make report generation reproducible for a
fixed dataset and configuration.

Do not claim that these measures provide a certified tamper-proof system
unless a suitable design and validation support that claim.

------------------------------------------------------------------------

# 15. Performance and Reliability

The prototype should handle the agreed demonstration dataset without
excessive delay or memory use. Set explicit performance targets only
after measuring the chosen environment.

Requirements: - Use vectorized operations where appropriate. - Avoid
repeatedly loading the entire dataset for every UI interaction. - Cache
safe intermediate results where helpful, while invalidating caches when
inputs/configuration change. - Provide progress and error states for
long-running imports or analytics. - Handle empty datasets and partial
submissions gracefully. - Make analytics runs identifiable and
reproducible. - Log actionable errors without leaking sensitive record
content. - Fail safely if an optional ML dependency or model is
unavailable. - Prefer deterministic rules over fragile heuristics for
requirements with clear definitions.

------------------------------------------------------------------------

# 16. Implementation Milestones

A suggested 14-day student-prototype plan; adjust to actual time and
team capacity.

## Phase 1 --- Requirements and data (Days 1--2)

-   Review this document and confirm scope.
-   Define the common schema.
-   Generate synthetic data.
-   Write a data dictionary.

## Phase 2 --- Ingestion and validation (Days 3--4)

-   Implement CSV/JSON import.
-   Validate fields and timestamps.
-   Preserve source references.
-   Build a data quality summary.

## Phase 3 --- Core analytics (Days 5--7)

-   Implement R1--R5 first.
-   Add negative-space expectation checks.
-   Add unit tests and evidence linking.
-   Implement a simple review-priority method.

## Phase 4 --- Dashboard and review workflow (Days 8--10)

-   Build overview, entity comparison, findings, and data-quality pages.
-   Add finding detail views.
-   Add reviewer decisions and audit events.
-   Add local report export.

## Phase 5 --- Evaluation (Days 11--12)

-   Test synthetic ground truth.
-   Measure precision/recall and false positives.
-   Test malformed data and incomplete submissions.
-   Measure runtime.

## Phase 6 --- Offline packaging and presentation (Days 13--14)

-   Test with networking disabled.
-   Pin dependencies and document setup.
-   Prepare architecture, validation plan, and demo.
-   Capture truthful screenshots and results.

Do not add ML sophistication at the cost of a working end-to-end MVP.
After the core is stable, add Isolation Forest or text similarity if it
demonstrably improves the prototype.

------------------------------------------------------------------------

# 17. SIH Deliverables to Prepare

Secondary reproductions of the SIH26157 brief list the following
deliverables. Verify current official instructions before submission.

1.  **Source code link:** GitHub or Drive repository with code, tests,
    and supporting files.
2.  **README:** installation, dependencies, run instructions, data
    generation, testing, and offline setup.
3.  **Architecture document:** maximum 2 pages according to the
    reproduced brief; explain components, data flow, deployment,
    security boundaries, and analytics.
4.  **Demo video:** maximum 2 minutes according to the reproduced brief;
    show import, execution-gap detection, negative-space detection,
    evidence drill-down, review, and report.
5.  **Technical presentation:** maximum 5 slides according to the
    reproduced brief; cover problem, solution, architecture, validation
    results, and deployment feasibility.
6.  **Functional design and methodology:** document data requirements,
    rules, analytical methods, infrastructure, validation, and estimated
    deployment/operational requirements.

Do not invent measured results for the presentation. Clearly label
synthetic demonstration results.

------------------------------------------------------------------------

# 18. Two-Minute Demo Script

Suggested sequence:

-   **0:00--0:15:** Introduce the supervisory problem and show the local
    application with a clear synthetic-data banner.
-   **0:15--0:30:** Import a synthetic submission and show data-quality
    checks.
-   **0:30--0:55:** Open an execution-gap finding and show the case,
    timestamps, missing investigation evidence, and applicable rule.
-   **0:55--1:15:** Open a negative-space finding and show the expected
    monitoring condition, asset inventory reference, and absent record.
-   **1:15--1:35:** Show entity-level analysis and explain normalized
    comparison and data-completeness caveats.
-   **1:35--1:50:** Record a reviewer decision and show the audit
    history.
-   **1:50--2:00:** Export the report and state that analysis runs
    locally/offline.

Keep the demo focused on evidence-backed insight, not a long tour of
every page.

------------------------------------------------------------------------

# 19. Acceptance Criteria

The coding agent must not declare the project complete until the
following are true.

## Functional

-   [ ] CSV import works.
-   [ ] JSON import works.
-   [ ] Validation errors and warnings are displayed.
-   [ ] Source provenance is retained.
-   [ ] Multiple entities and periods can be represented.
-   [ ] At least R1--R5 are implemented and tested.
-   [ ] Negative-space rules have explicit expectations and completeness
    checks.
-   [ ] Findings include human-readable explanations.
-   [ ] Findings link to valid source evidence.
-   [ ] Findings can be filtered and opened in detail.
-   [ ] Review decisions and history are retained.
-   [ ] A report can be exported locally.
-   [ ] Synthetic data can be regenerated reproducibly.

## Analytical

-   [ ] Known seeded anomalies are detected by the intended checks.
-   [ ] Legitimate edge cases are included in tests.
-   [ ] False-positive and false-negative examples are documented.
-   [ ] Missing data is not silently treated as zero.
-   [ ] Scores and thresholds are documented as configurable prototype
    choices.
-   [ ] No finding is presented as proof solely because an anomaly was
    detected.

## Offline and security

-   [ ] The complete application starts and runs with networking
    disabled.
-   [ ] No runtime external API or cloud inference call is required.
-   [ ] No runtime model download is required.
-   [ ] Input validation and safe file handling are tested.
-   [ ] Sensitive data is not sent externally.
-   [ ] Limitations of prototype authentication/security are documented.

## Delivery

-   [ ] README contains exact commands for setup, run, tests, and
    synthetic data generation.
-   [ ] Dependencies are pinned or otherwise reproducibly specified.
-   [ ] Tests run successfully in the documented environment.
-   [ ] Architecture and data dictionary are included.
-   [ ] Demo script is included.
-   [ ] Screenshots and example results are labeled synthetic where
    applicable.
-   [ ] No unsupported claims or fabricated performance figures appear
    in the UI or documents.

------------------------------------------------------------------------

# 20. Instructions to the Coding Agent

Follow these rules throughout implementation.

1.  **Inspect the repository first.** If code already exists, understand
    and preserve useful work before restructuring it.
2.  **Create a short implementation plan** and then proceed through the
    milestones in order.
3.  **Build a runnable end-to-end MVP first.** Do not start with
    advanced ML, complex microservices, or cosmetic polish.
4.  **Use synthetic data by default.** Do not require confidential SOC
    data to start the app.
5.  **Keep interfaces simple and explicit.** Define clear function
    inputs/outputs and avoid unnecessary abstractions.
6.  **Write tests with each module.** Do not postpone all testing until
    the end.
7.  **Never fabricate data, test results, citations, compliance claims,
    or performance claims.**
8.  **Make uncertainty visible.** Missing evidence and unusual behavior
    must be phrased as potential findings requiring review.
9.  **Keep all runtime functionality local.** Audit dependencies and
    frontend assets for external calls.
10. **Do not overbuild.** If a feature is not necessary for the core
    problem, document it as a future enhancement.
11. **Do not stop at a static mockup.** The dashboard must be backed by
    working import, analytics, evidence, and review logic.
12. **Handle errors clearly.** Invalid input should produce an
    actionable message, not a crash or silent data loss.
13. **Document every configurable threshold and score.** Mark defaults
    as prototype settings, not official values.
14. **Provide exact run and test commands.** Ensure the README matches
    the actual repository.
15. **Report completion honestly.** Summarize implemented features,
    tests run and results, known limitations, and the exact command to
    launch the application.
16. **If a requirement is ambiguous, choose the safest minimal
    implementation**, document the assumption, and keep it configurable.
    Ask the user only when the ambiguity blocks a material design
    decision.
17. **Do not change the core product scope:** ARGUS SAT assesses
    submitted SOC evidence for supervisory review; it is not a live SOC,
    SIEM, or threat-blocking platform.

## Required final response from the coding agent

When finished, report: - What was implemented. - Repository/file
structure. - Exact installation and launch commands. - Exact test
command and actual results. - How to generate and load synthetic data. -
How to demonstrate execution-gap detection and negative-space
detection. - How offline operation was verified. - Remaining limitations
and recommended next steps.

------------------------------------------------------------------------

# 21. Research References and Verification Notes

The original research used secondary reproductions of SIH26157
materials:

-   SIH26157 problem statement viewer:
    https://sih2026-ps-viewer.vercel.app/ps/SIH26157
-   SIH 2026 problem statement compendium (reproduced document):
    https://www.scribd.com/document/1077490794/Sih2026-Problem-Statements
-   Extracted GitHub index of SIH 2026 problem statements:
    https://github.com/harshgounder/sih-2026/blob/main/data/SIH_2026_Problem_Statements.md

Use these as navigation aids, not as a replacement for official SIH
instructions. Verify the official statement and current deadline in the
official portal. The secondary sources reviewed had a discrepancy in the
displayed deadline, so this document intentionally does not establish a
definitive submission deadline.

------------------------------------------------------------------------

# Final Product Definition

**ARGUS SAT is an offline, evidence-driven supervisory analytics
prototype for reviewing periodic SOC submissions across multiple
entities. It identifies potential execution gaps, negative-space
conditions, and unusual operational patterns; explains every finding
with source evidence; supports human review; and preserves a traceable
audit history.**

Build the simplest complete implementation that demonstrates this
workflow reliably. Expand only when tests show that the additional
complexity improves the result.
