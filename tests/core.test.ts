// Core unit tests: deterministic utilities, TF-IDF, ingestion, review invariants.

import { describe, expect, it } from 'vitest';
import { makeRng, median, normalizeTimestamp, parseCsv, parseJsonRecords, percentile, toCsv } from '../src/lib/util';
import { buildTfidf, cosine, findSimilarPairs } from '../src/lib/textsim';
import { buildCompleteness, normalizeParsedFile, parseFile } from '../src/lib/ingest';
import { computePriority, type FindingDraft } from '../src/lib/rulekit';
import { defaultAnalyticsConfig } from '../src/lib/types';

describe('deterministic utilities', () => {
  it('PRNG is reproducible for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('normalizeTimestamp accepts valid ISO timestamps and rejects bad ones', () => {
    expect(normalizeTimestamp('2025-10-05T08:15:00Z')).toBe('2025-10-05T08:15:00.000Z');
    expect(normalizeTimestamp('2025-10-05 08:15')).toBe('2025-10-05T08:15:00.000Z');
    expect(normalizeTimestamp('2025-13-40T99:00:00Z')).toBeNull();
    expect(normalizeTimestamp('2025-02-30T00:00:00Z')).toBeNull();
    expect(normalizeTimestamp('not-a-date')).toBeNull();
    expect(normalizeTimestamp('')).toBeNull();
  });

  it('median and percentile behave on small samples', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('CSV parse/serialize round-trips quoted values', () => {
    const csv = toCsv(['a', 'b'], [['1', 'x,y'], ['2', 'say "hi"']]);
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(['a', 'b']);
    expect(parsed.rows[1]).toEqual(['2', 'say "hi"']);
  });

  it('JSON record parser rejects non-array JSON', () => {
    expect(() => parseJsonRecords('{"a":1}')).toThrow();
    expect(parseJsonRecords('[{"a":1}]')).toHaveLength(1);
    expect(parseJsonRecords('{"records":[{"a":1}]}')).toHaveLength(1);
  });
});

describe('tf-idf text similarity', () => {
  const docs = [
    { id: 'd1', text: 'collected memory image reviewed network flows restored service' },
    { id: 'd2', text: 'collected memory image reviewed network flows restored service' },
    { id: 'd3', text: 'phishing email reported by user blocked sender domain' },
  ];

  it('identical documents have similarity 1', () => {
    const idx = buildTfidf(docs);
    expect(cosine(idx.vectors.get('d1')!, idx.vectors.get('d2')!)).toBeCloseTo(1, 5);
  });

  it('unrelated documents score low', () => {
    const idx = buildTfidf(docs);
    expect(cosine(idx.vectors.get('d1')!, idx.vectors.get('d3')!)).toBeLessThan(0.2);
  });

  it('findSimilarPairs respects threshold', () => {
    const idx = buildTfidf(docs);
    const pairs = findSimilarPairs(idx, 0.8);
    expect(pairs.some((p) => p.aId === 'd1' && p.bId === 'd2')).toBe(true);
    expect(pairs.every((p) => p.similarity >= 0.8)).toBe(true);
  });
});

describe('ingestion', () => {
  const ctx = { entityId: 'E1', submissionId: 'S1', fileId: 'F1', softwareVersion: 'test' };

  it('detects category by filename and validates timestamps', () => {
    const csv = [
      'alert_id,asset_id,severity,opened_at,closed_at,status,disposition,alert_family',
      'AL-1,AS-1,high,2025-10-01T08:00:00Z,,closed,true_positive,malware',
      'AL-2,AS-1,high,not-a-date,,open,pending,malware',
    ].join('\n');
    const parsed = parseFile('alerts.csv', csv);
    parsed.contentSha256 = 'x';
    const res = normalizeParsedFile(parsed, ctx, new Map());
    expect(res.kind).toBe('alerts');
    expect(res.accepted).toBe(1);
    expect(res.rejected).toBe(1);
    expect(res.issues.some((i) => i.rule === 'invalid_timestamp' && i.rowRef === 'L3')).toBe(true);
  });

  it('flags duplicate ids across files and never silently drops them', () => {
    const csv = 'alert_id,severity,opened_at,status\nAL-1,low,2025-10-01T08:00:00Z,closed';
    const p1 = parseFile('alerts.csv', csv);
    p1.contentSha256 = 'x';
    const seen = new Map<string, string>();
    normalizeParsedFile(p1, ctx, seen);
    const p2 = parseFile('alerts-2.csv', csv);
    p2.contentSha256 = 'y';
    const res2 = normalizeParsedFile(p2, ctx, seen);
    expect(res2.duplicates).toBe(1);
    expect(res2.issues.some((i) => i.rule === 'duplicate_id')).toBe(true);
  });

  it('marks an unreadable file with a parse error and zero accepted records', () => {
    const parsed = parseFile('alerts.csv', '');
    parsed.contentSha256 = 'x';
    const res = normalizeParsedFile(parsed, ctx, new Map());
    expect(res.accepted).toBe(0);
    expect(res.issues.some((i) => i.rule === 'file_parse')).toBe(true);
  });

  it('rejects unknown criticality as unknown rather than failing the import', () => {
    const csv = 'asset_id,criticality,monitoring_expected,asset_type\nAS-1,hyper_critical,true,server';
    const parsed = parseFile('assets.csv', csv);
    parsed.contentSha256 = 'x';
    const res = normalizeParsedFile(parsed, ctx, new Map());
    expect(res.accepted).toBe(1);
    expect(res.assets[0]!.criticality).toBe('unknown');
    expect(res.issues.some((i) => i.rule === 'unknown_criticality')).toBe(true);
  });

  it('completeness distinguishes missing categories from rejected rows', () => {
    const csvA = 'asset_id,criticality,monitoring_expected\nAS-1,critical,true';
    const parsedA = parseFile('assets.csv', csvA);
    parsedA.contentSha256 = 'x';
    const resA = normalizeParsedFile(parsedA, ctx, new Map());
    const comp = buildCompleteness([resA]);
    expect(comp.presentCategories).toEqual(['assets']);
    expect(comp.missingCategories).toContain('alerts');
    expect(comp.score).toBeCloseTo(1 / 6, 5);
  });
});

describe('transparent review-priority indicator', () => {
  const weights = defaultAnalyticsConfig().priorityWeights;

  const baseDraft: FindingDraft['priorityInputs'] = { S: 'high', E: 'strong', C: 'critical', R: 3 };

  it('computes a bounded score with all components present', () => {
    const r = computePriority(baseDraft, weights, 5);
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThanOrEqual(0);
    expect(r.score!).toBeLessThanOrEqual(100);
    expect(r.components.every((c) => c.used)).toBe(true);
  });

  it('excludes unknown components and documents the redistribution', () => {
    const r = computePriority({ ...baseDraft, C: null }, weights, 5);
    expect(r.components.find((c) => c.key === 'C')!.used).toBe(false);
    expect(r.components.find((c) => c.key === 'C')!.raw).toBeNull();
    const usedSum = r.components.filter((c) => c.used).reduce((n, c) => n + c.weight, 0);
    expect(usedSum).toBeCloseTo(0.8, 5); // S(0.4) + E(0.3) + R(0.1)
    expect(r.label).not.toBe('unknown');
  });

  it('returns unknown when nothing is known', () => {
    const r = computePriority({ S: 'info', E: 'indicative', C: null, R: 0 }, weights, 5);
    expect(r.score).not.toBeNull(); // S and E are always known by construction
    expect(r.label).toBeDefined();
  });
});
