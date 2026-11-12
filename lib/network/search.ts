/**
 * Ask: from a sentence to people, on the device.
 *
 * A query is read in three passes, none of which needs the network to leave the phone.
 *
 * 1. Words, forgivingly. Tokens match when their Damerau-Levenshtein distance d is small
 *    for their length (a swapped pair only at 4 letters, <=1 under 8, <=2 beyond), or one
 *    is a prefix of the other. Similarity is 1 - d / max(len), so "Reha Kapadia" finds Rhea Kapadia and
 *    "semiconducter" finds semiconductors.
 *
 * 2. Meaning. Concepts carry the words people type ("battery", "cathode", "mfi") and
 *    point at the fields that practise them. A concept also lists its inputs, so supply
 *    chains are edges, not strings:
 *        "suppliers / raw materials / upstream of X"  -> the inputs of X
 *        "customers / buyers / downstream of X"       -> the concepts X is an input to
 *        "X supply chain"                             -> X and its inputs
 *    Each step along an edge multiplies the weight by STEP.
 *
 * 3. People. Every role a person has held is scored against the weighted fields,
 *    organisations and leftover words of the query; a role contributes
 *        match x years x seniority x freshness
 *    and a person's relevance is 1 - e^(-sum/6): the same saturating form as the
 *    expertise map, so the two can never disagree. Rank = relevance x (0.5 + 0.5 tie).
 *
 * The plan (what FINN understood) is returned with the results and shown to the user.
 * An optional server-side model may add fields to the plan for unusual phrasing; it is
 * sent the question with every network name masked, and returns ids from a fixed list.
 */
import { type Graph, tieStrength, yearFrac } from "./graph.ts";
import { nameTokens } from "./names.ts";
import type { Person, Role } from "./types.ts";

const STEP = 0.7;
const LEVEL_W = { 1: 1, 2: 0.85, 3: 0.6, 4: 0.4 } as const;
const STOP = new Set("a an the of for to in on at by with and or do does did i me my we who whom what which that this is are was were be know knows known understand understands about can could would should anyone someone somebody people person tell show find get give any some have has had from into it its their them they there how well best good really actually please".split(" "));
const UP = /\b(suppl\w*|vendors?|raw materials?|upstream|inputs?|sourc\w+|feedstock)\b/;
const DOWN = /\b(customers?|buyers?|downstream|clients?|sells? to|end users?)\b/;
const CHAIN = /\b(supply chain|value chain|ecosystem)\b/;
const RIVAL = /\b(competitors?|rivals?|peers?|competition)\b/;

export function osa(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
const stem = (t: string) => (t.length > 4 && t.endsWith("ies") ? t.slice(0, -3) + "y" : t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
export const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter(Boolean).map(stem);

/** Similarity of two tokens in [0, 1]; 0 when they are not the same word. */
export function alike(q: string, t: string): number {
  if (q === t) return 1;
  const len = Math.max(q.length, t.length);
  if (Math.min(q.length, t.length) < 4) return 0;
  if (t.startsWith(q) || q.startsWith(t)) return Math.min(q.length, t.length) / len;
  const d = osa(q, t);
  // short words are dense with neighbours (bank/tank): accept only a swap of adjacent letters
  if (len < 5) return d === 1 && [...q].sort().join("") === [...t].sort().join("") ? 0.75 : 0;
  return d <= (len < 8 ? 1 : 2) ? 1 - d / len : 0;
}
/** How well a (possibly multi-word) term is present in the query tokens. */
function present(term: string[], q: string[]): { w: number; used: number[] } {
  let w = 1;
  const used: number[] = [];
  for (const t of term) {
    let best = 0, at = -1;
    q.forEach((x, i) => { const s = alike(x, t); if (s > best) { best = s; at = i; } });
    if (best === 0) return { w: 0, used: [] };
    w = Math.min(w, best);
    used.push(at);
  }
  return { w, used };
}

export interface Plan {
  direction: "self" | "inputs" | "customers" | "chain" | "rivals";
  concepts: { id: string; label: string; w: number; via?: string }[];
  themes: Map<string, number>;
  orgs: Map<string, number>;
  people: { person: Person; w: number }[];
  leftover: string[];
  wantsPeople: boolean;
}
export interface Hit { person: Person; relevance: number; tie: number; score: number; roles: Role[]; why: string }

export function plan(g: Graph, query: string, everyone: Person[], extraThemes: string[] = []): Plan {
  const text = query.toLowerCase();
  const q = words(query).filter((t) => !STOP.has(t));
  const used = new Set<number>();
  const direction: Plan["direction"] = CHAIN.test(text) ? "chain" : UP.test(text) ? "inputs" : DOWN.test(text) ? "customers" : RIVAL.test(text) ? "rivals" : "self";
  q.forEach((t, i) => { if (/^(suppl|vendor|raw|material|upstream|input|sourc|feedstock|customer|buyer|downstream|client|chain|value|ecosystem|competitor|rival|peer|manufactur|maker|produc|compan|industr|sector|business|space|expert)/.test(t)) used.add(i); });

  const all = g.net.concepts ?? [];
  const matched = new Map<string, number>();
  for (const c of all) {
    for (const term of [c.label, ...c.terms]) {
      const p = present(words(term), q);
      if (p.w >= 0.7 && p.w > (matched.get(c.id) ?? 0)) { matched.set(c.id, p.w); p.used.forEach((i) => used.add(i)); }
    }
  }
  const concepts: Plan["concepts"] = [];
  const add = (id: string, w: number, via?: string) => {
    const c = all.find((x) => x.id === id);
    const old = concepts.find((x) => x.id === id);
    if (c && (!old || old.w < w)) { if (old) concepts.splice(concepts.indexOf(old), 1); concepts.push({ id, label: c.label, w, via }); }
  };
  for (const [id, w] of matched) {
    const c = all.find((x) => x.id === id)!;
    if (direction === "inputs") {
      c.inputs.forEach((i) => add(i, w, c.label));
      if (c.inputs.length === 0) add(id, w * STEP);
    } else if (direction === "customers") {
      all.filter((x) => x.inputs.includes(id)).forEach((x) => add(x.id, w, c.label));
    } else {
      add(id, w);
      // a chain is everything that feeds X, two links deep, fading by STEP per link
      if (direction === "chain") for (const i of c.inputs) {
        add(i, w * STEP, c.label);
        for (const j of all.find((x) => x.id === i)?.inputs ?? []) add(j, w * STEP * STEP, c.label);
      }
    }
  }
  const themes = new Map<string, number>();
  for (const c of concepts) for (const t of all.find((x) => x.id === c.id)!.themes) themes.set(t, Math.max(themes.get(t) ?? 0, c.w));
  for (const t of extraThemes) if (g.net.themes.some((x) => x.id === t)) themes.set(t, Math.max(themes.get(t) ?? 0, 0.8));

  // organisations named in the question, then stepped along the relation asked for
  const orgs = new Map<string, number>();
  for (const o of g.net.orgs) {
    for (const name of [o.name, ...(o.aliases ?? []), o.ticker ?? ""]) {
      const term = words(name).filter((t) => !/^(limited|ltd|india|industr|compan|technolog|bank|finance)/.test(t));
      if (!term.length) continue;
      const p = present(term, q);
      if (p.w < 0.8) continue;
      p.used.forEach((i) => used.add(i));
      const step = direction === "inputs" ? o.suppliers : direction === "customers" ? o.customers : direction === "rivals" ? o.competitors : null;
      if (step?.length) step.forEach((s) => orgs.set(s, Math.max(orgs.get(s) ?? 0, p.w)));
      else orgs.set(o.id, Math.max(orgs.get(o.id) ?? 0, p.w));
      if (direction === "chain") [...(o.suppliers ?? []), ...(o.customers ?? [])].forEach((s) => orgs.set(s, Math.max(orgs.get(s) ?? 0, p.w * STEP)));
    }
  }
  // people named in the question: surname or first name close enough, both if two words given
  const people: Plan["people"] = [];
  for (const person of everyone) {
    const nt = nameTokens(person.name).filter((t) => t.length > 1);
    const sims = nt.map((t) => Math.max(0, ...q.map((x) => (x.length >= 3 && t.length >= 3 ? alike(x, t) : 0))));
    const hits = sims.filter((s) => s >= 0.74).length;
    if (hits === 0) continue;
    const w = sims.reduce((a, b) => a + b, 0) / nt.length;
    if (w >= 0.45) { people.push({ person, w }); q.forEach((x, i) => { if (nt.some((t) => alike(x, t) >= 0.74)) used.add(i); }); }
  }
  people.sort((a, b) => b.w - a.w);
  const leftover = q.filter((_, i) => !used.has(i));
  return { direction, concepts: concepts.sort((a, b) => b.w - a.w), themes, orgs, people: people.slice(0, 5), leftover,
    wantsPeople: /\bwho\b|\bwhom\b|anyone|someone|people|contacts?\b|expert/.test(text) || themes.size > 0 };
}

export function findPeople(g: Graph, p: Plan, limit = 6): Hit[] {
  const now = yearFrac(g.now);
  const out: Hit[] = [];
  for (const c of g.net.contacts) {
    let sum = 0;
    const scored: { r: Role; s: number; how: string }[] = [];
    const note = words(`${c.headline} ${c.tie?.note ?? ""}`);
    for (const r of c.roles) {
      const org = g.orgs.get(r.org);
      let m = 0, how = "";
      for (const t of org?.themes ?? []) { const w = p.themes.get(t) ?? 0; if (w > m) { m = w; how = g.themeLabel(t); } }
      const ow = p.orgs.get(r.org) ?? 0;
      if (ow > m) { m = ow; how = g.orgName(r.org); }
      if (p.leftover.length) {
        const text = [...words(r.title), ...words(org?.name ?? ""), ...note];
        const lw = p.leftover.reduce((a, t) => a + Math.max(0, ...text.map((x) => alike(t, x))), 0) / p.leftover.length;
        // leftover words refine a match; alone they are weaker evidence than a field
        m = m > 0 ? m * (0.6 + 0.4 * lw) : lw >= 0.5 ? 0.5 * lw : 0;
        if (!how && m > 0) how = p.leftover.join(" ");
      }
      if (m <= 0) continue;
      const end = r.to === null ? now : r.to + 1;
      const s = m * (end - r.from) * LEVEL_W[r.level] * Math.pow(2, -Math.max(0, now - end) / 5);
      sum += s;
      scored.push({ r, s, how });
    }
    if (sum <= 0) continue;
    scored.sort((a, b) => b.s - a.s);
    const top = scored[0];
    const relevance = 1 - Math.exp(-sum / 6);
    const tie = tieStrength(c, g.now);
    const when = top.r.to === null ? `since ${top.r.from}` : `${top.r.from}–${top.r.to}`;
    out.push({ person: c, relevance, tie, score: relevance * (0.5 + 0.5 * tie), roles: scored.map((x) => x.r),
      why: `${top.r.title}, ${g.orgName(top.r.org)} (${when}) · ${top.how}` });
  }
  return out.filter((h) => h.relevance >= 0.08).sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The question with every name from the network removed, safe to send to a model. */
export function masked(query: string, everyone: Person[]): string {
  const names = new Set(everyone.flatMap((p) => nameTokens(p.name)).filter((t) => t.length > 2));
  return query.split(/(\s+)/).map((w) => {
    const t = w.toLowerCase().replace(/[^a-z]/g, "");
    return t.length > 2 && [...names].some((n) => alike(t, n) >= 0.74) ? "[person]" : w;
  }).join("");
}
