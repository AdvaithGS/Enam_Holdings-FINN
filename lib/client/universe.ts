/**
 * Theme search over what companies actually do.
 *
 * Each NIFTY 500 company carries its reported segments with revenue shares (results XBRL),
 * its description, and its industry label (finn/universe.py). A query is matched, word by
 * word and typo-tolerantly, against each field:
 *
 *   industry  score = 2                the company's classified industry IS the theme: all of it
 *   segment   score = 1 + share        a reported business; ranked by how much of the company it is
 *   about     score = 1.9 (1 - pos)^2  the description says it; pos = how far into the text
 *                                      (a description that opens with the theme describes a
 *                                      pure play; a passing mention near the end scores little)
 *
 * A field matches when every query word is found in it. If no company matches every word,
 * companies matching at least half of them are returned, scaled down by the share matched.
 * So "adhesives" returns the company whose description opens with adhesives ahead of one
 * with a 30% "Paints and Adhesives" segment, and "retail" ranks retailers above banks that
 * report a "Retail Banking" segment.
 */
import { alike, words } from "../network/search.ts";

export interface UCo { s: string; n: string; i: string; a: string; p: string[]; g: [string, number][] }
export interface ThemeHit { co: UCo; score: number; how: string }

const STOP = new Set("who whom what which that this know knows about the and for with from into company companies business businesses maker makers manufacturer manufacturers sector industry stock stocks india indian".split(" "));

/** [share of query words found, position of the first one in the text (0 = at the start)] */
function hit(q: string[], text: string): [number, number] {
  const t = words(text);
  if (!t.length) return [0, 1];
  let first = t.length, found = 0;
  for (const x of q) {
    const i = t.findIndex((y) => alike(x, y) >= 0.85);
    if (i >= 0) { found++; first = Math.min(first, i); }
  }
  return [found / q.length, first / t.length];
}

export function themeCompanies(query: string, uni: UCo[], limit = 6): ThemeHit[] {
  const q = words(query).filter((w) => w.length > 2 && !STOP.has(w));
  if (!q.length) return [];
  const out: ThemeHit[] = [];
  for (const co of uni) {
    let best: ThemeHit | null = null;
    const offer = (frac: number, score: number, how: string) => {
      if (frac >= 0.5 && (!best || frac * score > best.score)) best = { co, score: frac * score, how, full: frac === 1 } as ThemeHit & { full: boolean };
    };
    for (const ind of [...co.p, co.i]) offer(hit(q, ind)[0], 2, ind);
    for (const [name, share] of co.g) offer(hit(q, name)[0], 1 + share, `${name}: ${(share * 100).toFixed(0)}% of revenue`);
    const [frac, pos] = hit(q, co.a);
    offer(frac, 1.9 * (1 - pos) * (1 - pos), co.a.length > 110 ? co.a.slice(0, 110).replace(/\s+\S*$/, "") + "\u2026" : co.a);
    if (best) out.push(best);
  }
  const full = out.filter((h) => (h as ThemeHit & { full: boolean }).full);
  // below 0.15 a hit is a passing mention deep in a description: not worth a row
  return (full.length ? full : out).filter((h) => h.score >= 0.15).sort((a, b) => b.score - a.score).slice(0, limit);
}
