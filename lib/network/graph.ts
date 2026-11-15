/**
 * The Network: every number here is a probability with a stated model.
 *
 * 1. Tie strength (investor -> contact)
 *      s = c * 2^(-m / 36)
 *    c is closeness as the investor rated it (close 0.9, good 0.65, acquaintance 0.4)
 *    and m the months since they last spoke. A tie loses half its pull every three
 *    quiet years. s reads as "chance this person picks up and talks openly".
 *
 * 2. Did two people know each other? (contact <-> anyone)
 *      P(know) = P(their stints overlapped) x P(acquainted | they overlapped)
 *    Overlap. With both sets of dates it is a fact (0 or 1) and y years long. A filing
 *    usually names a former employer without dates. Then the stint is taken to be
 *    L years long for each L in {2, 4, 6, 10}, ending when we know it ended, or else
 *    placed uniformly in a 35-year working life; P(overlap) and the overlap length
 *    follow from the geometry for each L. Everything downstream is carried as a range
 *    over L (and over q at half and one-and-a-half times its value), because the point
 *    value alone would claim knowledge the filing does not contain.
 *    Acquaintance. Each overlapping year is an independent chance q:
 *      P(acquainted | overlap) = 1 - (1 - q)^y
 *    Board seats are a different tie: a director is linked only to other directors
 *    (q = 0.85) and to the top executives who face the board (0.6), never to staff.
 *    q depends on how small the room was: organisation size (small 0.60, mid 0.25,
 *    large 0.06), tripled when both were senior (level <= 2), x1.5 when one was, and
 *    doubled when they sat in the same function, doubled again inside the same business
 *    unit and cut to 0.3 across different units; capped at 0.95.
 *    Classmates: same school, graduating within a year of each other: 0.5 for a small
 *    cohort (a business-school batch), 0.1 for a large one; a third of that within 3 years.
 *    Independent pieces of evidence combine by noisy-OR: p = 1 - prod(1 - p_i).
 *
 * 3. Reach. A two-step path investor -> contact -> target works only if both links do:
 *      reach = s * p
 *    and the best path is the one with the largest product.
 *
 * 4. Who to call about a company. Being reachable is not enough; the person must know
 *    something. For each role a contact has held,
 *      knowledge = relation * freshness * depth * seniority * fit
 *        relation   1.0 same company, 0.5 competitor / supplier / customer,
 *                   0.3 same field, 0.25 same business group
 *                   (halved for a non-executive board seat outside the company itself)
 *        freshness  1 if still there, else 2^(-years since leaving / 5)
 *        depth      1 - e^(-tenure / 2)        (two years to learn most of a place)
 *        seniority  1.0, 0.85, 0.6, 0.4 for levels 1..4
 *        fit        1 if their function suits the question (finance for results), else 0.6
 *    Roles are separate windows onto the company, so they combine by noisy-OR:
 *      knowledge = 1 - prod(1 - knowledge_role),     score = s * knowledge.
 */
import { nameMatch, orgKey } from "./names.ts";
import type { Fn, Network, Org, Person, Role, Segment } from "./types.ts";

export const CLOSENESS = { 1: 0.4, 2: 0.65, 3: 0.9 } as const;
const HALF_LIFE_MONTHS = 36;
const Q_SIZE = { small: 0.6, mid: 0.25, large: 0.06 } as const;
const LEVEL_W = { 1: 1, 2: 0.85, 3: 0.6, 4: 0.4 } as const;
const KNOWLEDGE_HALF_LIFE = 5;
const CAREER = 35;             // years of working life an undated stint could sit in
const TENURES = [2, 4, 6, 10]; // plausible lengths of a stint whose dates a filing does not give

export interface Clock { year: number; month: number } // month 1..12
export const yearFrac = (c: Clock) => c.year + (c.month - 1) / 12;

export function monthsSince(ym: string, now: Clock): number {
  const [y, m] = ym.split("-").map(Number);
  return Math.max(0, (now.year - y) * 12 + (now.month - m));
}

export function tieStrength(p: Person, now: Clock): number {
  if (!p.tie) return 0;
  return CLOSENESS[p.tie.closeness] * Math.pow(2, -monthsSince(p.tie.last, now) / HALF_LIFE_MONTHS);
}

/** Years two roles overlapped. Year y means the whole of y, so 2014-2016 is three years. */
export function overlapYears(a: Role, b: Role, now: Clock): number {
  const end = (r: Role) => (r.to === null ? yearFrac(now) : r.to + 1);
  return Math.max(0, Math.min(end(a), end(b)) - Math.max(a.from, b.from));
}

export class Graph {
  readonly orgs = new Map<string, Org>();
  private orgByKey = new Map<string, string>();
  private schoolByKey = new Map<string, string>();
  readonly net: Network;
  readonly now: Clock;

  /** `hierarchy`: parent ticker -> names of its subsidiaries, associates and joint ventures (from annual reports). */
  constructor(net: Network, now: Clock, hierarchy: Record<string, string[]> = {}) {
    this.net = net;
    this.now = now;
    for (const o of net.orgs) {
      this.orgs.set(o.id, o);
      for (const n of [o.name, ...(o.aliases ?? []), o.ticker ?? ""]) if (n) this.orgByKey.set(orgKey(n), o.id);
    }
    // a subsidiary's name resolves to its parent, unless the subsidiary is a node of its own
    for (const [ticker, names] of Object.entries(hierarchy)) {
      const parent = this.orgByKey.get(orgKey(ticker));
      if (parent) for (const n of names) { const k = orgKey(n); if (k && !this.orgByKey.has(k)) this.orgByKey.set(k, parent); }
    }
    for (const s of net.schools) for (const n of [s.name, ...(s.aliases ?? [])]) this.schoolByKey.set(orgKey(n), s.id);
  }

  /** Resolve a free-text organisation name to a known org id, or null. */
  orgId(name: string | null | undefined): string | null {
    if (!name) return null;
    if (this.orgs.has(name)) return name;
    const k = orgKey(name);
    if (!k) return null;
    const hit = this.orgByKey.get(k);
    if (hit) return hit;
    // "Hindustan Unilever Ltd, Mumbai" still contains a known key as whole words
    for (const [key, id] of this.orgByKey) {
      if (key.length >= 5 && (` ${k} `.includes(` ${key} `))) return id;
    }
    return null;
  }

  schoolId(name: string): string {
    return this.schoolByKey.get(orgKey(name)) ?? orgKey(name);
  }

  orgName(id: string): string {
    return this.orgs.get(id)?.name ?? id;
  }

  /** How org `a` relates to org `b`, from b's point of view of interest. */
  relation(a: string, b: string): { w: number; label: string } | null {
    if (a === b) return { w: 1, label: "inside" };
    const A = this.orgs.get(a), B = this.orgs.get(b);
    if (!A || !B) return null;
    if (A.parent === b) return { w: 0.8, label: "inside" };
    if (B.competitors?.includes(a) || A.competitors?.includes(b)) return { w: 0.5, label: "competitor" };
    if (B.suppliers?.includes(a)) return { w: 0.5, label: "supplier" };
    if (B.customers?.includes(a)) return { w: 0.5, label: "customer" };
    if (A.suppliers?.includes(b)) return { w: 0.5, label: "customer" };
    if (A.customers?.includes(b)) return { w: 0.5, label: "supplier" };
    const shared = A.themes.filter((t) => B.themes.includes(t));
    if (shared.length) return { w: 0.3, label: `same field (${this.themeLabel(shared[0])})` };
    if (A.group && A.group === B.group) return { w: 0.25, label: `same group (${A.group})` };
    return null;
  }

  themeLabel(id: string): string {
    return this.net.themes.find((t) => t.id === id)?.label ?? id;
  }

  /** Probability that a and b know each other, with the evidence. */
  knows(a: Person, b: Person): Link {
    const parts: { p: number; lo: number; hi: number; why: string }[] = [];
    const W1 = yearFrac(this.now), W0 = W1 - CAREER;
    const end = (r: Role) => (r.to === null ? W1 : r.to + 1);
    for (const ra of a.roles) {
      for (const rb of b.roles) {
        if (ra.org !== rb.org) continue;
        // A board seat is a different kind of tie: a director meets the other directors and the
        // people who present to the board, not the organisation.
        const boardA = ra.fn === "board", boardB = rb.fn === "board";
        if ((boardA && !(boardB || rb.level === 1)) || (boardB && !(boardA || ra.level === 1))) continue;
        const org = this.orgs.get(ra.org);
        let q: number;
        if (boardA || boardB) q = boardA && boardB ? 0.85 : 0.6;
        else {
          q = Q_SIZE[org?.size ?? "large"];
          const senior = (ra.level <= 2 ? 1 : 0) + (rb.level <= 2 ? 1 : 0);
          q *= senior === 2 ? 3 : senior === 1 ? 1.5 : 1;
          if (ra.fn === rb.fn) q *= 2;
          // the room is the business unit when we know it: same unit doubles the chance, different units cut it
          if (ra.seg && rb.seg) q *= ra.seg === rb.seg ? 2 : 0.3;
        }
        const qs = [Math.min(0.95, q * 0.5), Math.min(0.95, q), Math.min(0.95, q * 1.5)];
        // P(tenures overlap) and the overlap length, for each plausible tenure of an undated role
        const kA = ra.from > 0, kB = rb.from > 0;
        const cases = (kA && kB ? [0] : TENURES).map((L) => {
          if (kA && kB) { const y = overlapYears(ra, rb, this.now); return { po: y > 0 ? 1 : 0, y }; }
          if (kA !== kB) {
            const D = kA ? ra : rb, U = kA ? rb : ra, x = D.from, yEnd = end(D);
            if (U.to !== 0) { // we know when it ended (or that it is current), not when it began
              const uEnd = end(U), y = Math.max(0, Math.min(yEnd, uEnd) - Math.max(x, uEnd - L));
              return { po: y > 0 ? 1 : 0, y };
            }
            // nothing known: an L-year stint somewhere in a working life that ended by now
            const span = Math.max(1e-9, W1 - L - W0);
            const po = Math.max(0, Math.min(yEnd, W1 - L) - Math.max(x - L, W0)) / span;
            return { po: Math.min(1, po), y: Math.min(L, yEnd - x) / 2 };
          }
          const f = Math.max(0, (CAREER - 2 * L) / (CAREER - L)); // two undated stints of length L in the same working life
          return { po: 1 - f * f, y: L / 3 };
        });
        const at = (qi: number) => cases.map((c) => c.po * (1 - Math.pow(1 - qs[qi], c.y)));
        const mid = at(1), p = mid.reduce((x, y) => x + y, 0) / mid.length;
        if (p <= 0) continue;
        const lo = Math.min(...at(0)), hi = Math.max(...at(2));
        const po = cases.map((c) => c.po);
        const dated = kA && kB;
        const span = dated ? `${Math.max(ra.from, rb.from)}\u2013${Math.min(ra.to ?? this.now.year, rb.to ?? this.now.year)}`
          : `dates not stated; ${pctRange(Math.min(...po), Math.max(...po))} likely the stints overlapped at all`;
        const kind = boardA || boardB ? (boardA && boardB ? "on the board together" : "board and top management") : "";
        parts.push({ p, lo, hi, why: `Both at ${this.orgName(ra.org)} (${span})${kind ? `, ${kind}` : ""}: ${a.name.split(" ")[0]} as ${ra.title}, ${b.name.split(" ")[0]} as ${rb.title}` });
      }
    }
    for (const ea of a.education) {
      for (const eb of b.education) {
        if (this.schoolId(ea.school) !== this.schoolId(eb.school) || !ea.to || !eb.to) continue;
        const gap = Math.abs(ea.to - eb.to);
        const cohort = this.net.schools.find((s) => s.id === this.schoolId(ea.school))?.cohort ?? "large";
        const base = cohort === "small" ? 0.5 : 0.1;
        const p = gap <= 1 ? base : gap <= 3 ? base / 3 : 0;
        if (p > 0) parts.push({ p, lo: p / 2, hi: Math.min(0.95, p * 1.5), why: `Both at ${ea.school}, classes of ${ea.to} and ${eb.to}` });
      }
    }
    parts.sort((x, y) => y.p - x.p);
    const or = (k: "p" | "lo" | "hi") => 1 - parts.reduce((acc, x) => acc * (1 - x[k]), 1);
    return { p: or("p"), lo: or("lo"), hi: or("hi"), why: parts.map((x) => x.why) };
  }

  /** Best routes from the investor to `target` (someone they may not know). */
  reach(target: Person): Reach[] {
    const out: Reach[] = [];
    const direct = this.knows(this.net.me, target);
    if (direct.hi >= 0.05) out.push({ via: null, strength: direct.p, lo: direct.lo, hi: direct.hi, tie: 1, link: direct.p, linkLo: direct.lo, linkHi: direct.hi, why: direct.why, hops: 1 });
    for (const c of this.net.contacts) {
      if (nameMatch(c.name, target.name) === 2) {
        const t = tieStrength(c, this.now);
        out.push({ via: c, strength: t, lo: t, hi: t, tie: t, link: 1, linkLo: 1, linkHi: 1, why: ["Already in your network"], hops: 1 });
        continue;
      }
      const k = this.knows(c, target);
      if (k.hi < 0.05) continue;
      const tie = tieStrength(c, this.now);
      out.push({ via: c, strength: tie * k.p, lo: tie * k.lo, hi: tie * k.hi, tie, link: k.p, linkLo: k.lo, linkHi: k.hi, why: k.why, hops: 2 });
    }
    return out.sort((a, b) => b.strength - a.strength);
  }

  /** Who is best placed to explain something about `orgId`? */
  whoToCall(orgId: string, fit: Fn[] = [], limit = 4): Lead[] {
    const leads: Lead[] = [];
    for (const c of this.net.contacts) {
      let best: Lead | null = null;
      let miss = 1;
      for (const r of c.roles) {
        const rel = this.relation(r.org, orgId);
        if (!rel) continue;
        const left = r.to === null ? 0 : Math.max(0, yearFrac(this.now) - (r.to + 1));
        const fresh = Math.pow(2, -left / KNOWLEDGE_HALF_LIFE);
        const tenure = (r.to === null ? yearFrac(this.now) : r.to + 1) - r.from;
        const depth = 1 - Math.exp(-tenure / 2);
        const fitW = fit.length === 0 || fit.includes(r.fn) || r.fn === "general" ? 1 : 0.6;
        const board = r.fn === "board" && r.org !== orgId ? 0.5 : 1;
        const knowledge = rel.w * board * fresh * depth * LEVEL_W[r.level] * fitW;
        miss *= 1 - knowledge;
        const tie = tieStrength(c, this.now);
        const lead: Lead = {
          person: c, role: r, relation: rel.label, knowledge, tie, score: tie * knowledge,
          insider: r.org === orgId && r.to === null,
          factors: { relation: rel.w, freshness: fresh, depth, seniority: LEVEL_W[r.level], fit: fitW },
          why: this.leadReason(c, r, rel.label, orgId),
        };
        // describe the lead by first-hand experience when it is at least half as strong as the best role
        const rank = (l: Lead) => l.knowledge * (l.relation === "inside" ? 2 : 1);
        if (!best || rank(lead) > rank(best)) best = lead;
      }
      if (!best) continue;
      // the lead is described by its strongest role, scored on all of them together
      best.knowledge = 1 - miss;
      best.score = best.tie * best.knowledge;
      best.insider = c.roles.some((r) => (r.org === orgId || this.orgs.get(r.org)?.parent === orgId) && r.to === null);
      best.target = orgId;
      if (best.score >= 0.03) leads.push(best);
    }
    return leads.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private leadReason(c: Person, r: Role, relation: string, target: string): string {
    const when = r.to === null ? `since ${r.from}` : `${r.from}–${r.to}`;
    const at = `${r.title}, ${this.orgName(r.org)} (${when})`;
    if (relation === "inside") return r.to === null ? `Works there now: ${at}` : `Worked there: ${at}`;
    if (relation === "competitor") return `Knows the industry from a competitor: ${at}`;
    if (relation === "supplier") return `Sold to them: ${at}, a supplier to ${this.orgName(target)}`;
    if (relation === "customer") return `Bought from them: ${at}, a customer of ${this.orgName(target)}`;
    return `${at}; ${relation}`;
  }

  /** Go-to people for a theme. expertise = 1 - e^(-E/6), E = sum(years * seniority * freshness). */
  expertise(theme: string, limit = 6): Expert[] {
    const out: Expert[] = [];
    for (const c of this.net.contacts) {
      let e = 0;
      const roles: Role[] = [];
      for (const r of c.roles) {
        if (!this.orgs.get(r.org)?.themes.includes(theme)) continue;
        const end = r.to === null ? yearFrac(this.now) : r.to + 1;
        const left = r.to === null ? 0 : Math.max(0, yearFrac(this.now) - end);
        e += (end - r.from) * LEVEL_W[r.level] * Math.pow(2, -left / KNOWLEDGE_HALF_LIFE);
        roles.push(r);
      }
      if (e > 0) out.push({ person: c, expertise: 1 - Math.exp(-e / 6), years: roles.reduce((s, r) => s + ((r.to ?? this.now.year) + 1 - r.from), 0), roles, tie: tieStrength(c, this.now) });
    }
    return out.sort((a, b) => b.expertise * (0.5 + 0.5 * b.tie) - a.expertise * (0.5 + 0.5 * a.tie)).slice(0, limit);
  }

  /** Find a named person among contacts. Corroborated by a shared org when one is given. */
  findContact(name: string, orgHint?: string | null): { person: Person; confidence: "confirmed" | "possible" } | null {
    let best: { person: Person; m: number; corroborated: boolean } | null = null;
    for (const c of this.net.contacts) {
      const m = nameMatch(c.name, name);
      if (!m) continue;
      const corroborated = !!orgHint && c.roles.some((r) => r.org === orgHint);
      if (!best || Number(corroborated) * 10 + m > Number(best.corroborated) * 10 + best.m) best = { person: c, m, corroborated };
    }
    if (!best) return null;
    return { person: best.person, confidence: best.corroborated || best.m === 2 ? "confirmed" : "possible" };
  }

  /**
   * Coverage of a company, business by business.
   *
   * A contact covers a segment through a role that sat inside it (the role's own segment,
   * or a role at the segment's unlisted unit), or through a role at another organisation
   * working in the segment's field (a competitor, supplier or customer of that business).
   * A role at the company with no segment attached (group finance, strategy, the board)
   * is "group level": useful, and counted separately, because it is not knowledge of any
   * one business. Each lead is scored exactly as in whoToCall, with the relation weight
   * 1 inside the segment and 0.5 across the table.
   */
  coverage(orgId: string, perSegment = 2): { segments: { segment: Segment; leads: Lead[] }[]; group: Lead[]; covered: number } {
    const org = this.orgs.get(orgId);
    const segs: Segment[] = org?.segments?.length ? org.segments : [{ id: "all", label: org?.name ?? orgId, themes: org?.themes ?? [] }];
    const single = segs.length === 1;
    const now = yearFrac(this.now);
    const score = (c: Person, r: Role, w: number, label: string): Lead => {
      const end = r.to === null ? now : r.to + 1, fresh = Math.pow(2, -Math.max(0, now - end) / KNOWLEDGE_HALF_LIFE), depth = 1 - Math.exp(-(end - r.from) / 2);
      const knowledge = w * fresh * depth * LEVEL_W[r.level], tie = tieStrength(c, this.now);
      return { person: c, role: r, relation: label, knowledge, tie, score: tie * knowledge, target: orgId, insider: (r.org === orgId || this.orgs.get(r.org)?.parent === orgId) && r.to === null,
        factors: { relation: w, freshness: fresh, depth, seniority: LEVEL_W[r.level], fit: 1 }, why: this.leadReason(c, r, label, orgId) };
    };
    const best = (leads: Lead[]) => {
      const by = new Map<string, Lead>();
      for (const l of leads) if (l.knowledge >= 0.15 && l.score >= 0.05 && (!by.has(l.person.id) || by.get(l.person.id)!.score < l.score)) by.set(l.person.id, l);
      return [...by.values()].sort((a, b) => b.score - a.score);
    };
    const group: Lead[] = [];
    const out = segs.map((segment) => {
      const leads: Lead[] = [];
      for (const c of this.net.contacts) for (const r of c.roles) {
        const o = this.orgs.get(r.org);
        if (r.org === orgId) { if (single || r.seg === segment.id) leads.push(score(c, r, 1, "inside")); continue; }
        if (segment.unit && r.org === segment.unit) { leads.push(score(c, r, 1, "inside")); continue; }
        if (o?.parent === orgId || r.fn === "board") continue;
        const rel = this.relation(r.org, segment.unit ?? orgId);
        if (o && rel && rel.w >= 0.5 && (single || o.themes.some((t) => segment.themes.includes(t)))) leads.push(score(c, r, 0.5, rel.label));
      }
      return { segment, leads: best(leads).slice(0, perSegment) };
    });
    if (!single) for (const c of this.net.contacts) for (const r of c.roles) if (r.org === orgId && !r.seg) group.push(score(c, r, 1, "inside"));
    return { segments: out, group: best(group).slice(0, 2), covered: out.filter((s) => s.leads.length).length / out.length };
  }

  /**
   * Who opens the most doors? Personalised PageRank from the investor.
   * Nodes: you, your contacts, and `others` (people named in filings). Edge weights:
   * your tie to a contact; P(two people know each other) between everyone else. A walk
   * starts at you, follows edges in proportion to weight, and returns to you with
   * probability 1 - d each step (d = 0.85). A contact's score is the share of time the
   * walk spends on them: high when they are close to you AND lead on to many others.
   */
  connectors(others: Person[] = [], limit = 4): { person: Person; score: number; doors: Person[] }[] {
    const nodes: Person[] = [this.net.me, ...this.net.contacts, ...others];
    const n = nodes.length, nc = this.net.contacts.length;
    const W = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 1; i <= nc; i++) W[0][i] = W[i][0] = tieStrength(nodes[i], this.now);
    for (let i = 1; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (i > nc && j > nc) continue; // two strangers knowing each other opens nothing for you
      const p = this.knows(nodes[i], nodes[j]).p;
      if (p >= 0.05) W[i][j] = W[j][i] = p;
    }
    const out = W.map((row) => row.reduce((a, b) => a + b, 0));
    let r = new Array<number>(n).fill(1 / n);
    const d = 0.85;
    for (let it = 0; it < 50; it++) {
      const next = new Array<number>(n).fill(0);
      let lost = 0;
      for (let i = 0; i < n; i++) {
        if (out[i] === 0) { lost += r[i]; continue; }
        for (let j = 0; j < n; j++) if (W[i][j]) next[j] += (d * r[i] * W[i][j]) / out[i];
      }
      next[0] += 1 - d + d * lost; // restart, and dead ends, go back to the investor
      r = next;
    }
    return this.net.contacts.map((person, k) => ({
      person, score: r[k + 1],
      doors: nodes.filter((_, j) => j > nc && W[k + 1][j] >= 0.2),
    })).filter((x) => x.doors.length > 0 || x.score > 0).sort((a, b) => b.doors.length - a.doors.length || b.score - a.score).slice(0, limit);
  }

  themesOf(orgId: string): string[] {
    return this.orgs.get(orgId)?.themes ?? [];
  }
}

export interface Link { p: number; lo: number; hi: number; why: string[] }
/** strength = tie x link, with the range the unknowns allow. Never read the point value without the range. */
export interface Reach { via: Person | null; strength: number; lo: number; hi: number; tie: number; link: number; linkLo: number; linkHi: number; why: string[]; hops: 1 | 2 }

/** "1–10%": a probability range as people say it. */
export function pctRange(lo: number, hi: number): string {
  const f = (x: number) => (x < 0.01 ? "<1" : x >= 0.995 ? "100" : String(Math.round(x * 100)));
  const a = f(lo), b = f(hi);
  return a === b ? `${a === "<1" ? "under 1" : a}%` : `${a}\u2013${b}%`;
}
export interface Lead {
  person: Person; role: Role; relation: string; knowledge: number; tie: number; score: number; insider: boolean; why: string;
  /** the organisation this lead is about */
  target?: string;
  factors: { relation: number; freshness: number; depth: number; seniority: number; fit: number };
}
export interface Expert { person: Person; expertise: number; years: number; roles: Role[]; tie: number }

/** Which functions are best placed to explain each kind of event. */
export const FIT: Record<string, Fn[]> = {
  results: ["finance", "sales", "general"],
  management_change: ["general", "hr", "board", "finance"],
  m_and_a: ["strategy", "finance", "general"],
  fund_raise: ["finance", "investing"],
  litigation: ["legal", "risk", "finance"],
  capex: ["operations", "technology", "strategy"],
  credit_rating: ["finance", "risk"],
  press_release: ["sales", "operations", "strategy"],
};

export function strengthWord(x: number): string {
  return x >= 0.5 ? "strong" : x >= 0.25 ? "good" : x >= 0.1 ? "thin" : "faint";
}
