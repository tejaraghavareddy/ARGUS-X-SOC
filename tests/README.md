# Tests

Run with:

```bash
bun run test
# or
npm run test
```

- `core.test.ts` — deterministic utilities, TF-IDF, ingest/normalize, audit/review invariants.
- `validation.test.ts` — end-to-end validation against the synthetic ground truth: precision/recall for seeded scenarios, false-positive traps, completeness handling, and priority math.

Ground truth labels live in `generated-data/ground-truth.json` and are **never** imported by the app pipeline; the validation test is the only consumer.
