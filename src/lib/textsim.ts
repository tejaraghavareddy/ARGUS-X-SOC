// Minimal TF-IDF + cosine similarity for investigation-note comparison.
// Deterministic, dependency-free, no model downloads.

const STOPWORDS = new Set(
  'a an and are as at be by for from has have in is it its of on or that the to was were will with'.split(' ')
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export interface TfidfIndex {
  /** idf[term] computed over the corpus. */
  idf: Map<string, number>;
  vectors: Map<string, Map<string, number>>; // docId -> term -> tfidf weight
  docTokens: Map<string, string[]>;
}

/** Build a TF-IDF index from documents (id -> text). */
export function buildTfidf(docs: { id: string; text: string }[]): TfidfIndex {
  const docTokens = new Map<string, string[]>();
  const df = new Map<string, number>();
  for (const { id, text } of docs) {
    const tokens = tokenize(text);
    docTokens.set(id, tokens);
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log((N + 1) / (d + 0.5)));
  const vectors = new Map<string, Map<string, number>>();
  for (const [id, tokens] of docTokens) {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec = new Map<string, number>();
    for (const [t, f] of tf) vec.set(t, (f / tokens.length) * (idf.get(t) ?? 0));
    vectors.set(id, vec);
  }
  return { idf, vectors, docTokens };
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [t, v] of small) {
    const w = large.get(t);
    if (w) dot += v * w;
  }
  return dot / Math.sqrt(na * nb);
}

export interface SimilarPair {
  aId: string;
  bId: string;
  similarity: number;
  sharedTerms: string[];
}

/** All pairs with similarity >= threshold (deterministic order). */
export function findSimilarPairs(
  index: TfidfIndex,
  threshold: number,
  maxPairs = 50
): SimilarPair[] {
  const ids = [...index.vectors.keys()].sort();
  const pairs: SimilarPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] as string;
      const b = ids[j] as string;
      const sim = cosine(index.vectors.get(a) as Map<string, number>, index.vectors.get(b) as Map<string, number>);
      if (sim >= threshold) {
        const aTerms = index.docTokens.get(a) ?? [];
        const shared = [...new Set(aTerms)].filter((t) => (index.vectors.get(b) as Map<string, number>).has(t));
        shared.sort();
        pairs.push({ aId: a, bId: b, similarity: sim, sharedTerms: shared.slice(0, 8) });
        if (pairs.length >= maxPairs) return pairs.sort((x, y) => y.similarity - x.similarity);
      }
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}
