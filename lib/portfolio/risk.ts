/**
 * The book: what the investor holds, what it has done, and what it could lose.
 *
 * Everything is arithmetic on end-of-day closes, on the device (holdings never leave it).
 *
 *   weights      w_i = value_i / total value, today's. The risk figures ask "what would
 *                THIS book have done on each past day", so weights are held at today's.
 *   r_p,t        = sum_i w_i r_i,t           r_i,t = daily return of stock i (adjusted)
 *   VaR 95%      = -(5th percentile of r_p) over the last 250 sessions. Historical: the
 *                loss exceeded on 1 day in 20, no distribution assumed.
 *   shortfall    = -(mean of the worst 5% of days): how bad a bad day is
 *   beta         = cov(r_p, r_m) / var(r_m)                 m = NIFTY 50
 *   alpha        = (mean(r_p) - beta * mean(r_m)) * 252     return not explained by the market
 *   tracking err = sd(r_p - r_m) * sqrt(252);   information ratio = mean(r_p - r_m) * 252 / TE
 *   alpha decay  the same alpha on a rolling 60-session window; "fading" when the latest
 *                window is below the one before it
 *   benchmark    for each position, what the same rupees would be worth had they gone
 *                into the NIFTY on the entry date
 *   expectation  with an expected return of E a year, a position bought for C rupees and
 *                held d days should be worth C (1+E)^(d/365). The book is ahead or behind
 *                by the sum of (value - that). No annualising of short holdings needed.
 */
import type { Market } from "../types.ts";

export interface Holding { symbol: string; qty: number; entry: number; date: string; target?: number | null }
export interface Position extends Holding {
  last: number; value: number; cost: number; pnl: number; ret: number; weight: number; days: number;
  bench: number | null; expected: number; gap: number; progress: number | null;
}
export interface Risk {
  sessions: number; var95: number; shortfall: number; vol: number; beta: number; alpha: number; te: number; ir: number;
  dates: string[]; rolling: (number | null)[]; alphaNow: number | null; alphaBefore: number | null;
  curve: number[]; benchCurve: number[];
}

const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1)); };
export function beta(rp: number[], rm: number[]): number {
  const mp = mean(rp), mm = mean(rm);
  let c = 0, v = 0;
  for (let i = 0; i < rp.length; i++) { c += (rp[i] - mp) * (rm[i] - mm); v += (rm[i] - mm) ** 2; }
  return v > 0 ? c / v : 1;
}
/** Lower empirical quantile: the k-th worst of n with k = floor(q n), at least the worst. */
export function quantile(x: number[], q: number): number {
  const s = [...x].sort((a, b) => a - b);
  return s[Math.max(0, Math.floor(q * s.length) - 1)];
}
const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));

/** A demo book of `book` rupees at the given percentage weights, bought at staggered past closes. */
export function defaults(market: Market, weights: Record<string, number | null | undefined>, book = 1e8): Holding[] {
  const back = [200, 120, 60, 160, 30, 90, 240, 45];
  return Object.entries(weights).filter(([s, w]) => w && market.series[s]).map(([symbol, w], i) => {
    const s = market.series[symbol], k = Math.max(0, s.dates.length - 1 - back[i % back.length]);
    return { symbol, entry: s.close[k], date: s.dates[k], qty: Math.max(1, Math.round((book * (w as number)) / 100 / s.close[k])), target: null };
  });
}

export function positions(holdings: Holding[], market: Market, expect: number): Position[] {
  const ix = market.index;
  const out: Position[] = [];
  for (const h of holdings) {
    const s = market.series[h.symbol];
    if (!s || !(h.qty > 0) || !(h.entry > 0)) continue;
    const last = s.close[s.close.length - 1], value = h.qty * last, cost = h.qty * h.entry;
    const days = daysBetween(h.date, market.as_of);
    let bench: number | null = null;
    if (ix) { const k = ix.dates.findIndex((d) => d >= h.date); if (k >= 0 && ix.dates[k] <= market.as_of) bench = ix.close[ix.close.length - 1] / ix.close[k] - 1; }
    const expected = cost * Math.pow(1 + expect, days / 365);
    const t = h.target && h.target !== h.entry ? (last - h.entry) / (h.target - h.entry) : null;
    out.push({ ...h, last, value, cost, pnl: value - cost, ret: value / cost - 1, weight: 0, days, bench, expected, gap: value - expected, progress: t });
  }
  const total = out.reduce((a, p) => a + p.value, 0);
  for (const p of out) p.weight = total > 0 ? p.value / total : 0;
  return out.sort((a, b) => b.weight - a.weight);
}

export function risk(pos: Position[], market: Market, window = 250, roll = 60): Risk | null {
  const ix = market.index;
  if (!ix || pos.length === 0) return null;
  const at = new Map(ix.dates.map((d, i) => [d, i]));
  const ref = market.series[pos[0].symbol].dates;
  const dates: string[] = [], rp: number[] = [], rm: number[] = [];
  const idx = pos.map((p) => new Map(market.series[p.symbol].dates.map((d, i) => [d, i])));
  for (const d of ref) {
    const k = at.get(d);
    if (k === undefined || k === 0) continue;
    let r = 0, ok = true;
    pos.forEach((p, j) => { const i = idx[j].get(d), c = i === undefined ? null : market.series[p.symbol].change[i]; if (c === null || c === undefined) ok = false; else r += p.weight * c; });
    if (!ok) continue;
    dates.push(d); rp.push(r); rm.push(ix.close[k] / ix.close[k - 1] - 1);
  }
  if (rp.length < 60) return null;
  const P = rp.slice(-window), M = rm.slice(-window), D = dates.slice(-window);
  const b = beta(P, M), diff = P.map((x, i) => x - M[i]), te = sd(diff) * Math.sqrt(252);
  const cut = quantile(P, 0.05), tail = P.filter((x) => x <= cut);
  const alphaAt = (end: number) => { const p = P.slice(end - roll, end), m = M.slice(end - roll, end); return (mean(p) - beta(p, m) * mean(m)) * 252; };
  const rolling = P.map((_, i) => (i + 1 >= roll ? alphaAt(i + 1) : null));
  let c = 1, cb = 1;
  const curve = P.map((x) => (c *= 1 + x) - 1), benchCurve = M.map((x) => (cb *= 1 + x) - 1);
  return { sessions: P.length, var95: -cut, shortfall: -mean(tail), vol: sd(P) * Math.sqrt(252), beta: b, alpha: (mean(P) - b * mean(M)) * 252, te, ir: te > 0 ? (mean(diff) * 252) / te : 0,
    dates: D, rolling, alphaNow: P.length >= roll ? alphaAt(P.length) : null, alphaBefore: P.length >= 2 * roll ? alphaAt(P.length - roll) : null, curve, benchCurve };
}

/**
 * Where the risk sits. With covariance S (noise eigenvalues flattened, stats.rmt_clean)
 * and weights w, the book's variance is w'Sw and holding i contributes
 *     c_i = w_i (S w)_i / w'Sw ,      sum_i c_i = 1.
 * A holding whose c_i exceeds its weight is carrying more than its share of the risk.
 */
export function contributions(pos: Position[], market: Market): { symbol: string; weight: number; share: number }[] | null {
  const r = market.risk;
  if (!r) return null;
  const at = new Map(r.symbols.map((s, i) => [s, i]));
  const held = pos.filter((p) => at.has(p.symbol));
  const total = held.reduce((a, p) => a + p.weight, 0);
  if (held.length < 2 || total <= 0) return null;
  const w = held.map((p) => p.weight / total), k = held.map((p) => at.get(p.symbol)!);
  const Sw = k.map((i) => k.reduce((a, j, n) => a + r.cov[i][j] * w[n], 0));
  const v = w.reduce((a, x, i) => a + x * Sw[i], 0);
  return held.map((p, i) => ({ symbol: p.symbol, weight: w[i], share: (w[i] * Sw[i]) / v })).sort((a, b) => b.share - a.share);
}

/**
 * Is a whole field moving? For a set of stocks, the mean of their market-adjusted
 * returns summed over the last `span` sessions, ranked against every earlier
 * `span`-session stretch of the same stocks: p = (1 + #{as extreme}) / (1 + n).
 */
export function fieldMove(symbols: string[], market: Market, span = 5): { move: number; p: number; n: number } | null {
  const ss = symbols.map((s) => market.series[s]).filter(Boolean);
  if (ss.length < 2) return null;
  const len = Math.min(...ss.map((s) => s.abnormal.length));
  const daily: number[] = [];
  for (let k = len; k >= 1; k--) {
    const v = ss.map((s) => s.abnormal[s.abnormal.length - k]).filter((x): x is number => x !== null);
    if (v.length === ss.length) daily.push(mean(v));
  }
  if (daily.length < 60) return null;
  const sums: number[] = [];
  for (let i = span; i <= daily.length; i++) sums.push(daily.slice(i - span, i).reduce((a, b) => a + b, 0));
  const now = sums[sums.length - 1], past = sums.slice(0, -span);
  return { move: now, p: (1 + past.filter((x) => Math.abs(x) >= Math.abs(now)).length) / (1 + past.length), n: past.length };
}
