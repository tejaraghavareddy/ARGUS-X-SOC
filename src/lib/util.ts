// Deterministic, dependency-free utilities: PRNG, hashing, CSV, time helpers.

/** Mulberry32 PRNG - deterministic across platforms. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next(): number;
  int(minInclusive: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  gauss(mean: number, std: number): number;
}

export function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int(minInclusive, maxInclusive) {
      return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)] as T;
    },
    chance(p: number): boolean {
      return next() < p;
    },
    gauss(mean, std) {
      // Box-Muller, deterministic given the seeded stream.
      const u1 = Math.max(next(), 1e-12);
      const u2 = next();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return mean + std * z;
    },
  };
}

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] as number;
}

/** SHA-256 hex digest of a string (Web Crypto; works offline). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Simple deterministic non-cryptographic id from a string. */
export function shortHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

let idCounter = 0;
export function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${shortHash(
    `${prefix}${idCounter}${Math.floor(performance.now() * 1000)}`
  ).slice(0, 6)}`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Parse a CSV string with quote handling and CRLF support. Never evaluates content. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cur.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cur.push(field);
      field = '';
      if (cur.length > 1 || cur[0] !== '') rows.push(cur);
      cur = [];
    } else {
      field += ch;
    }
  }
  cur.push(field);
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map((v) => csvEscape(v == null ? '' : String(v))).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Parse a JSON array file; throws with a clear message when not an array of objects. */
export function parseJsonRecords(text: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { records?: unknown }).records)
      ? (parsed as { records: unknown[] }).records
      : null;
  if (!records) throw new Error('JSON must be an array of records or an object with a "records" array.');
  return records.filter(
    (r): r is Record<string, unknown> => r !== null && typeof r === 'object' && !Array.isArray(r)
  );
}

// ---------------------------------------------------------------------------
// Time helpers (ISO 8601, UTC)
// ---------------------------------------------------------------------------

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})([T ](\d{2}):(\d{2})(:(\d{2}))?)?/;

/** Validate and normalize an ISO-ish timestamp to ISO UTC; returns null when invalid. */
export function normalizeTimestamp(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = ISO_RE.exec(trimmed);
  if (!m) return null;
  const [, y, mo, d, , hh, mm, , ss] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(hh ?? '0');
  const minute = Number(mm ?? '0');
  const second = Number(ss ?? '0');
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 60) return null;
  const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(dt.getTime())) return null;
  // Reject rollover (e.g. Feb 30).
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day)
    return null;
  return dt.toISOString();
}

export function isoDate(ts: string | null): string {
  return ts ? ts.slice(0, 10) : '';
}

export function hoursBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 3_600_000;
}

export function addDays(isoDateStr: string, days: number): string {
  const d = new Date(isoDateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '-';
  return ts.replace('T', ' ').replace('Z', ' UTC').slice(0, 25);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] as number + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp((p / 100) * (sorted.length - 1), 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] as number;
  return (sorted[lo] as number) * (hi - idx) + (sorted[hi] as number) * (idx - lo);
}

export function iqr(values: number[]): { q1: number; q3: number } {
  return { q1: percentile(values, 25), q3: percentile(values, 75) };
}
