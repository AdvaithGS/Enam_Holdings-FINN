"use client";
import { useState } from "react";
import { signed } from "@/lib/client/format";
import { pctRange, type Reach } from "@/lib/network/graph.ts";
import type { Person } from "@/lib/network/types.ts";
import { useOpenPerson } from "./Shell";

/**
 * A number that can be opened. With `href` it goes to the filing; with `how` a tap shows the
 * formula or the window behind it, in place.
 */
export function N({ children, href, how, className }: { children: React.ReactNode; href?: string | null; how?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  if (href) return <a className={`n ${className ?? ""}`} href={href} target="_blank" rel="noreferrer" title={how ?? "Open the source"}>{children}</a>;
  if (!how) return <b className={`num ${className ?? ""}`}>{children}</b>;
  return <><button className={`n ${className ?? ""}`} onClick={(e) => { e.stopPropagation(); setOpen(!open); }} aria-expanded={open}>{children}</button>{open && <span className="srcnote" style={{ display: "block" }}>{how}</span>}</>;
}

/**
 * A move, taken apart. One bar diverging from zero: the market's share, the sector's, and
 * what is left, the stock's own, which is the only part drawn in ink.
 */
export function Decomp({ market, sector, own, scale, labels = true }: { market: number; sector?: number; own: number; scale?: number; labels?: boolean }) {
  const parts = [{ k: "market", v: market, c: "var(--rule)" }, ...(sector !== undefined ? [{ k: "sector", v: sector, c: "var(--ink-3)" }] : []), { k: "own", v: own, c: "var(--ink)" }];
  const W = 320, H = 14, mid = W / 2;
  const pos = parts.filter((p) => p.v > 0).reduce((a, p) => a + p.v, 0), neg = parts.filter((p) => p.v < 0).reduce((a, p) => a - p.v, 0);
  const max = scale ?? Math.max(pos, neg, 0.01), px = (mid - 4) / max;
  let r = mid, l = mid;
  return (
    <div>
      <svg className="viz" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={parts.map((p) => `${p.k} ${signed(p.v)}`).join(", ")} style={{ height: H }}>
        {parts.map((p) => {
          const w = Math.min(Math.abs(p.v) * px, mid - 4);
          const x = p.v >= 0 ? r : l - w;
          if (p.v >= 0) r += w; else l -= w;
          return <rect key={p.k} x={x} y={p.k === "own" ? 1 : 3} width={Math.max(w, p.v === 0 ? 0 : 1)} height={p.k === "own" ? 12 : 8} fill={p.c} />;
        })}
        <line x1={mid} x2={mid} y1="0" y2={H} stroke="var(--ink-2)" strokeWidth="1" />
      </svg>
      {labels && <div className="legend">{parts.map((p) => <span key={p.k}>{p.k} <b className={p.k === "own" ? (p.v > 0 ? "up" : p.v < 0 ? "down" : "") : ""}>{signed(p.v)}</b></span>)}</div>}
    </div>
  );
}

/** How rare, on a log scale from 1 in 10 to 1 in 1,000. The tick is this session. */
export function Rarity({ p, width = 132 }: { p: number; width?: number }) {
  const n = 1 / p, f = Math.max(0, Math.min(1, (Math.log10(n) - 1) / 2)), W = width, x = 4 + f * (W - 8);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }} title="Share of this stock's last 500 sessions with a market-adjusted, volatility-scaled move or relative volume at least this large">
      <svg viewBox={`0 0 ${W} 14`} width={W} height={14} role="img" aria-label={`1 in ${Math.round(n)} sessions`}>
        <line x1="4" x2={W - 4} y1="9" y2="9" stroke="var(--rule)" strokeWidth="2" />
        {[0, 0.5, 1].map((t) => <line key={t} x1={4 + t * (W - 8)} x2={4 + t * (W - 8)} y1="6" y2="12" stroke="var(--ink-3)" strokeWidth="1" />)}
        <line x1={x} x2={x} y1="1" y2="13" stroke={n >= 100 ? "var(--alert)" : "var(--ink)"} strokeWidth="3" />
      </svg>
      <b className="num" style={{ font: "var(--d)", fontWeight: 600 }}>1 in {Math.round(n).toLocaleString("en-IN")}</b>
    </span>
  );
}

/** A probability as the range the unknowns allow, not a point. */
export function RangeBar({ lo, hi, width = 120 }: { lo: number; hi: number; width?: number }) {
  const W = width;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg viewBox={`0 0 ${W} 10`} width={W} height={10} role="img" aria-label={pctRange(lo, hi)}>
        <rect x="0" y="4" width={W} height="2" fill="var(--rule)" />
        <rect x={lo * W} y="2" width={Math.max(3, (hi - lo) * W)} height="6" fill="var(--people)" />
      </svg>
      <b className="num" style={{ font: "var(--d)", fontWeight: 600 }}>{pctRange(lo, hi)}</b>
    </span>
  );
}

/** You → contact → target, with the fact that links each pair written under the arrow. */
export function Route({ reach, target }: { reach: Reach; target: Person }) {
  const open = useOpenPerson();
  const two = reach.via && reach.hops === 2;
  return (
    <div className="route">
      <div>You</div>
      {reach.via && <>
        <div className="hop"><span className="ar">↓</span><span className="fact">{reach.via.tie ? `${reach.via.tie.how}; last spoke ${reach.via.tie.last.split("-").reverse().join("/")}` : "you know them"}</span></div>
        <div><button className="pname" onClick={() => open(reach.via!.id)}>{reach.via.name}</button></div>
      </>}
      {(two || !reach.via) && <>
        <div className="hop"><span className="ar">↓</span><span className="fact">{reach.why[0]}</span></div>
        <div>{target.name}</div>
      </>}
      <div className="legend" style={{ marginTop: 4 }}><span>Chance the route works</span> <RangeBar lo={reach.lo} hi={reach.hi} />
        {two && <span>(they know each other: {pctRange(reach.linkLo, reach.linkHi)})</span>}</div>
    </div>
  );
}

/** Guidance as a band, the result as a dot. A pending promise is drawn in grey. */
export function Guidance({ low, high, actual, verdict }: { low: number; high: number; actual?: number | null; verdict: string }) {
  const W = 220, span = Math.max(high - low, Math.abs(high) * 0.15, 1), a = Math.min(low, actual ?? low) - span * 0.8, b = Math.max(high, actual ?? high) + span * 0.8;
  const x = (v: number) => ((v - a) / (b - a)) * W;
  const tone = verdict === "met" ? "var(--up)" : verdict === "missed" ? "var(--down)" : "var(--ink-3)";
  return (
    <svg className="viz" viewBox={`0 0 ${W} 26`} style={{ width: W, height: 26, marginTop: 4 }} role="img" aria-label={`guided ${low} to ${high}${actual != null ? `, delivered ${actual}` : ""}`}>
      <rect x={x(low)} y="6" width={Math.max(3, x(high) - x(low))} height="8" fill={verdict === "pending" ? "var(--rule)" : "var(--ink-3)"} opacity={verdict === "pending" ? 1 : 0.45} />
      <text x={x(low)} y="25" textAnchor="middle">{low}</text>{high !== low && <text x={x(high)} y="25" textAnchor="middle">{high}</text>}
      {actual != null && <><circle cx={x(actual)} cy="10" r="5" fill={tone} /><text className="strong" x={x(actual)} y="25" textAnchor="middle">{actual.toFixed(1)}</text></>}
    </svg>
  );
}

/** Money against risk: a dot for the holding's weight, a dot for its share of risk, a line between. */
export function Dumbbell({ weight, risk, max }: { weight: number; risk: number; max: number }) {
  const W = 120, x = (v: number) => 4 + (Math.min(v, max) / max) * (W - 8), over = risk > weight * 1.02;
  return (
    <svg viewBox={`0 0 ${W} 12`} width={W} height={12} role="img" aria-label={`${(weight * 100).toFixed(1)}% of the money, ${(risk * 100).toFixed(1)}% of the risk`}>
      <line x1={x(weight)} x2={x(risk)} y1="6" y2="6" stroke={over ? "var(--alert)" : "var(--ink-3)"} strokeWidth="2" />
      <circle cx={x(weight)} cy="6" r="3.5" fill="var(--card)" stroke="var(--ink-3)" strokeWidth="1.5" />
      <circle cx={x(risk)} cy="6" r="4" fill={over ? "var(--alert)" : "var(--ink)"} />
    </svg>
  );
}
