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
  const parts = [{ k: "market", v: market, c: "var(--d5)" }, ...(sector !== undefined ? [{ k: "sector", v: sector, c: "var(--d2)" }] : []), { k: "own", v: own, c: "var(--d1)" }];
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
      <table className="sr"><caption>What the move was made of</caption><tbody>{parts.map((p) => <tr key={p.k}><th>{p.k}</th><td>{signed(p.v)}</td></tr>)}</tbody></table>
      {labels && <div className="legend">{parts.map((p) => <span key={p.k}><i style={{ display: "inline-block", width: 9, height: 9, background: p.c, marginRight: 4 }} />{p.k} <b className={p.k === "own" ? (p.v > 0 ? "up" : p.v < 0 ? "down" : "") : ""}>{signed(p.v)}</b></span>)}</div>}
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

/* ---------------------------------------------------------------- v3: pictures first */

const ICONS: Record<string, string> = {
  results: "M4 20V10m6 10V4m6 16v-7m4 7H2", management_change: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0", m_and_a: "M4 12h7m0 0l-3-3m3 3l-3 3m12-3h-7m0 0l3-3m-3 3l3 3",
  litigation: "M12 3v18m-7 0h14M5 7h14M5 7l-3 7h6L5 7zm14 0l-3 7h6l-3-7", capex: "M3 21V9l6 4V9l6 4V5h6v16H3z", fund_raise: "M12 3v18m4-14H10a3 3 0 000 6h4a3 3 0 010 6H8",
  move: "M3 17l6-6 4 4 8-9m0 0h-5m5 0v5", person: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0", company: "M4 21V5l8-2v18m0-12l8 2v10M2 21h20", theme: "M4 6h16M4 12h10M4 18h13",
  other: "M5 4h10l4 4v12H5V4zm9 0v5h5",
};
/** A category, as a glyph. Always paired with its word for screen readers. */
export function Icon({ kind, label }: { kind: string; label?: string }) {
  return <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label ?? kind}><path d={ICONS[kind] ?? ICONS.other} /></svg>;
}

/** Counts as one segmented bar; every segment carries its number and has a key underneath. */
export function SegBar({ parts }: { parts: { label: string; n: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0) || 1;
  return (
    <div role="img" aria-label={parts.map((p) => `${p.n} ${p.label}`).join(", ")}>
      <div className="segbar">{parts.filter((p) => p.n > 0).map((p) => <span key={p.label} style={{ flex: Math.max(p.n / total, 0.08), background: p.color }}>{p.n}</span>)}</div>
      <div className="keys">{parts.map((p) => <span key={p.label}><i style={{ background: p.color }} />{p.n} {p.label}</span>)}</div>
    </div>
  );
}

/** A few signed values as bars from a shared zero. */
export function MiniBars({ rows, scale }: { rows: { label: string; v: number }[]; scale?: number }) {
  const max = scale ?? Math.max(...rows.map((r) => Math.abs(r.v)), 0.001);
  return (
    <div role="img" aria-label={rows.map((r) => `${r.label} ${signed(r.v, 2)}`).join(", ")} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "4px 10px", alignItems: "center", font: "var(--d)" }}>
      {rows.map((r) => (
        <span key={r.label} style={{ display: "contents" }}>
          <span style={{ color: "var(--ink-2)" }}>{r.label}</span>
          <svg viewBox="0 0 200 12" preserveAspectRatio="none" style={{ width: "100%", height: 12 }} aria-hidden>
            <line x1="100" x2="100" y1="0" y2="12" stroke="var(--ink-3)" /><rect x={r.v >= 0 ? 100 : 100 - (Math.abs(r.v) / max) * 98} y="2" width={Math.max(1, (Math.abs(r.v) / max) * 98)} height="8" fill={r.v >= 0 ? "var(--up)" : "var(--down)"} />
          </svg>
          <b className={r.v >= 0 ? "up" : "down"} style={{ fontFamily: "var(--mono)" }}>{r.v >= 0 ? "▲" : "▼"} {signed(r.v, 2)}</b>
        </span>))}
    </div>
  );
}

/** A value against a threshold: how close a call came. */
export function Against({ value, line, label }: { value: number; line: number; label: string }) {
  const max = Math.max(value, line) * 1.25;
  return (
    <svg viewBox="0 0 200 14" preserveAspectRatio="none" style={{ width: "100%", height: 14 }} role="img" aria-label={label}>
      <rect x="0" y="4" width="200" height="6" fill="var(--wash)" /><rect x="0" y="4" width={(value / max) * 200} height="6" fill="var(--ink-2)" />
      <line x1={(line / max) * 200} x2={(line / max) * 200} y1="0" y2="14" stroke="var(--alert)" strokeWidth="3" />
    </svg>
  );
}

/** Holdings as areas: area = weight. Colour and an arrow say whether the holding beat the NIFTY. */
export function Treemap({ items, onPick }: { items: { id: string; w: number; v: number | null }[]; onPick: (id: string) => void }) {
  // slice-and-dice on the larger side: simple, stable, and readable for twenty holdings
  const out: { id: string; v: number | null; w: number; x: number; y: number; dx: number; dy: number }[] = [];
  let x = 0, y = 0, dx = 100, dy = 100, rest = items.reduce((a, i) => a + i.w, 0);
  const list = [...items].sort((a, b) => b.w - a.w);
  for (let i = 0; i < list.length;) {
    const row = list.slice(i, i + (i < 4 ? 2 : 4)), sum = row.reduce((a, r) => a + r.w, 0), horiz = dx * 16 >= dy * 9, f = sum / rest;
    let o = 0;
    for (const r of row) { const g = r.w / sum; out.push(horiz ? { ...r, x, y: y + o * dy, dx: dx * f, dy: dy * g } : { ...r, x: x + o * dx, y, dx: dx * g, dy: dy * f }); o += g; }
    if (horiz) { x += dx * f; dx *= 1 - f; } else { y += dy * f; dy *= 1 - f; }
    rest -= sum; i += row.length;
  }
  return (
    <>
      <div className="tm" role="group" aria-label="Holdings by weight; colour shows return against the NIFTY">
        {out.map((r) => (
          <button key={r.id} onClick={() => onPick(r.id)} style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.dx}%`, height: `${r.dy}%`, background: r.v === null ? "var(--ink-3)" : r.v >= 0 ? "var(--up)" : "var(--down)", opacity: r.v === null ? 1 : 0.55 + Math.min(0.45, Math.abs(r.v) * 1.5), color: "var(--paper)" }}
            aria-label={`${r.id}, ${(r.w * 100).toFixed(1)} percent of the book, ${r.v === null ? "no benchmark" : `${signed(r.v)} against the NIFTY`}`}>
            {r.dx > 9 && r.dy > 14 ? <>{r.id}<br />{r.v === null ? "" : `${r.v >= 0 ? "▲" : "▼"} ${signed(r.v, 0)}`}</> : r.dx > 6 ? r.id.slice(0, 4) : ""}
          </button>))}
      </div>
      <div className="keys"><span><i style={{ background: "var(--up)" }} />▲ ahead of the NIFTY</span><span><i style={{ background: "var(--down)" }} />▼ behind it</span><span>area = weight; deeper = further</span></div>
      <table className="sr"><caption>Holdings by weight and return against the NIFTY</caption><tbody>{list.map((r) => <tr key={r.id}><th>{r.id}</th><td>{(r.w * 100).toFixed(1)}%</td><td>{r.v === null ? "n/a" : signed(r.v)}</td></tr>)}</tbody></table>
    </>
  );
}
