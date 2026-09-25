export interface NormalisedQuery {
  cacheKey: string;
  attempts: string[];
}

const LOCATIVE_PREFIX =
  /^(?:the\s+)?(?:lay-?by|car\s*park|field|footpath|path|track|hill|beach|meadow|common|park|viewpoint|picnic\s+area|pub|church|bridge|cliff|summit|woods?)\s+(?:below|beneath|near|next\s+to|by|at|beside|behind|opposite|under|above|outside|off|overlooking|on)\s+(?:the\s+)?/i;

const TRAILING_COUNTRY = /,?\s*(?:uk|united kingdom|england|scotland|wales|northern ireland|great britain|gb)\s*$/i;

/**
 * Produces an ordered list of query strings to try. The first is the cleaned
 * input; later ones progressively strip informal locative phrasing such as
 * "the layby below Tyndale Monument" -> "Tyndale Monument".
 */
export function normaliseQuery(raw: string): NormalisedQuery {
  const cleaned = raw.replace(/\s+/g, ' ').trim().replace(TRAILING_COUNTRY, '').trim();
  const attempts: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t.length > 0 && !attempts.some((a) => a.toLowerCase() === t.toLowerCase())) attempts.push(t);
  };
  push(cleaned);
  const stripped = cleaned.replace(LOCATIVE_PREFIX, '');
  if (stripped !== cleaned) push(stripped);
  const parts = cleaned.split(/\s+(?:near|by|at|in|next to|beside|behind|below|above|outside)\s+/i);
  if (parts.length > 1) push(parts[parts.length - 1]);
  const noArticle = (attempts[attempts.length - 1] ?? cleaned).replace(/^the\s+/i, '');
  push(noArticle);
  return { cacheKey: cleaned.toLowerCase(), attempts: attempts.slice(0, 4) };
}
