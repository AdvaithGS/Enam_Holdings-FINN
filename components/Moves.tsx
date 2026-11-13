"use client";
import { useEffect, useMemo, useState } from "react";
import { day, oneIn, pct, tone } from "@/lib/client/format";
import { useStore } from "@/lib/client/store";
import { FIT } from "@/lib/network/graph.ts";
import type { Digest, FinnEvent, Market, MoveNote } from "@/lib/types";
import { LeadLine } from "./People";
import { Sheet } from "./Shell";

export interface Move { symbol: string; date: string; change: number; vol: number | null; volMkt: number | null; p: number | null; abnormal: number | null;
  px: number[]; vols: (number | null)[]; event?: FinnEvent; note?: MoveNote }

export function findMoves(market: Market, digest: Digest, start: Date, movePct: number, volX: number): Move[] {
  const out: Move[] = [];
  const from = start.toISOString().slice(0, 10);
  for (const [symbol, s] of Object.entries(market.series)) {
    for (let i = s.dates.length - 1; i >= 0 && s.dates[i] >= from; i--) {
      const ch = s.change[i], v = s.vol_ratio[i];
      if (ch === null) continue;
      if (Math.abs(ch) * 100 >= movePct || (v !== null && v >= volX)) {
        const ps = [s.p_ret[i], s.p_vol[i]].filter((x): x is number => x !== null);
        const evs = digest.events.filter((e) => e.symbol === symbol && e.session === s.dates[i]);
        out.push({ symbol, date: s.dates[i], change: ch, vol: v, volMkt: s.vol_mkt?.[i] ?? null, abnormal: s.abnormal[i], p: ps.length ? Math.min(...ps) : null,
          px: s.close.slice(Math.max(0, i - 30), i + 1), vols: s.vol_ratio.slice(Math.max(0, i - 29), i + 1), note: digest.moves?.[symbol]?.[s.dates[i]], event: evs.find((e) => e.tier === "act") ?? evs.find((e) => e.tier === "glance") });
      }
    }
  }
  return out.sort((a, b) => (a.p ?? 1) - (b.p ?? 1));
}

/** How often would these thresholds have fired over the history we hold? */
export function fireCount(market: Market, movePct: number, volX: number): { fires: number; sessions: number } {
  let fires = 0, sessions = 0;
  for (const s of Object.values(market.series)) {
    sessions = Math.max(sessions, s.dates.length);
    for (let i = 0; i < s.dates.length; i++) {
      const ch = s.change[i], v = s.vol_ratio[i];
      if (ch !== null && (Math.abs(ch) * 100 >= movePct || (v !== null && v >= volX))) fires++;
    }
  }
  return { fires, sessions };
}

/**
 * A move in context, small enough for a list row.
 * Top: 30 sessions of price as % change from the first, on a labelled scale, with the
 * dashed line at 0% (the starting level) and the flagged session marked.
 * Bottom: each session's volume as a multiple of its own 20-day average; the line is 1x.
 */
export function MoveChart({ px, vols, up }: { px: number[]; vols: (number | null)[]; up: boolean }) {
  if (px.length < 3) return null;
  const W = 300, H = 74, PH = 46, VH = 20, R = 34;
  const r = px.slice(1).map((v) => v / px[0] - 1), lo = Math.min(0, ...r), hi = Math.max(0, ...r), n = r.length;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * (W - R - 4) + 2), y = (v: number) => 9 + (1 - (v - lo) / (hi - lo || 1)) * (PH - 12);
  const vmax = Math.max(2, ...vols.map((v) => v ?? 0)), bw = (W - R - 4) / n;
  const col = up ? "var(--up)" : "var(--down)";
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`30 sessions: price ${(r[n - 1] * 100).toFixed(1)}% from start, range ${(lo * 100).toFixed(0)}% to ${(hi * 100).toFixed(0)}%`} style={{ marginTop: 8 }}>
      <line x1="0" x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--ink-3)" strokeWidth="0.7" strokeDasharray="2 3" />
      <polyline points={r.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke="var(--ink-2)" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx={x(n - 1)} cy={y(r[n - 1])} r="3" fill={col} />
      <text x={W - R + 4} y={y(hi) + 3} fontSize="9" fill="var(--ink-3)">{hi > 0 ? "+" : ""}{(hi * 100).toFixed(0)}%</text>
      {lo < 0 && y(lo) - y(hi) > 12 && <text x={W - R + 4} y={y(lo) + 3} fontSize="9" fill="var(--ink-3)">{(lo * 100).toFixed(0)}%</text>}
      {Math.abs(y(0) - y(hi)) > 10 && Math.abs(y(0) - y(lo)) > 10 && <text x={W - R + 4} y={y(0) + 3} fontSize="9" fill="var(--ink-3)">0</text>}
      {vols.slice(-n).map((v, i) => v === null ? null : <rect key={i} x={x(i) - bw * 0.35} width={Math.max(1.5, bw * 0.7)} y={H - (v / vmax) * VH} height={(v / vmax) * VH} fill={i === n - 1 ? col : "var(--rule)"} />)}
      <line x1="0" x2={W - R} y1={H - VH / vmax} y2={H - VH / vmax} stroke="var(--ink-3)" strokeWidth="0.6" />
      <text x={W - R + 4} y={H - VH / vmax + 3} fontSize="9" fill="var(--ink-3)">1× vol</text>
    </svg>
  );
}

export function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return null;
  const lo = Math.min(...data), hi = Math.max(...data), w = 86, h = 26;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)}`).join(" ");
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden><polyline points={pts} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

function MoveRow({ m }: { m: Move }) {
  const { graph } = useStore();
  const [open, setOpen] = useState(false);
  const why = m.note?.why ?? [];
  // an unexplained move ends with a person: that is what the network is for
  const lead = useMemo(() => {
    if (!graph || m.event || m.note?.found !== false) return null;
    const org = graph.orgId(m.symbol);
    return org ? graph.whoToCall(org, FIT.press_release, 1).find((l) => l.knowledge >= 0.3) ?? null : null;
  }, [graph, m]);
  const sys = m.note?.parts && Math.abs(m.change) >= 0.01 && m.note.parts.market * m.change > 0 ? Math.min(1, Math.abs(m.note.parts.market / m.change)) : 0;
  return (
    <div className="move" style={{ display: "block" }}>
      <div className="row between"><b><span className="tick">{m.symbol}</span> <span className={`num ${tone(m.change)}`}>{pct(m.change, 1)}</span>
        {m.note?.parts && <span className="small muted" style={{ fontWeight: 400 }}> · {pct(m.note.parts.own, 1)} its own, {pct(m.note.parts.market, 1)} the market</span>}</b><span className="tiny faint">{day(m.date)}</span></div>
      <div className="small muted" style={{ marginTop: 3 }}>
        {m.vol !== null ? `${m.vol.toFixed(1)}× its usual volume${m.volMkt ? ` (your book ran at ${m.volMkt.toFixed(1)}×)` : ""}` : ""}
        {m.p !== null ? ` · for its volatility and that day’s volume, ${oneIn(m.p)} sessions` : ""}
      </div>
      <MoveChart px={m.px} vols={m.vols} up={m.change >= 0} />
      <div className="small" style={{ marginTop: 6 }}>
        {m.event ? <a href={`#${m.event.id}`}><b>Filed that session:</b> {m.event.title} <span className="faint">›</span></a>
          : why.length ? <><b>{sys >= 0.5 ? "Systematic. " : m.note?.found ? "No filing. Likely: " : ""}</b>{why[0].text}{why.length > 1 && <button className="link" style={{ marginLeft: 6 }} onClick={() => setOpen(!open)}>{open ? "less" : `+${why.length - 1} more`}</button>}</>
            : <span className="muted">No filing that session; below the line the batch job examines.</span>}
        {open && why.slice(1).map((w, i) => <p key={i} className="muted" style={{ marginTop: 5 }}>{w.text}</p>)}
      </div>
      {lead && <LeadLine lead={lead} verb="Ask" />}
    </div>
  );
}

export function Moves({ start }: { start: Date }) {
  const { market, digest, prefs, setPrefs, loadMarket } = useStore();
  const [sheet, setSheet] = useState(false);
  const [more, setMore] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission>("default");
  useEffect(() => { if (typeof Notification !== "undefined") setPerm(Notification.permission); }, []);
  useEffect(loadMarket, [loadMarket]);
  const moves = useMemo(() => (market && digest ? findMoves(market, digest, start, prefs.move, prefs.volume) : []), [market, digest, start, prefs.move, prefs.volume]);
  const hist = useMemo(() => (market ? fireCount(market, prefs.move, prefs.volume) : null), [market, prefs.move, prefs.volume]);
  if (!digest) return null;
  const n = Object.keys(digest.companies).length;
  return (
    <section className="section">
      <div className="head">
        <span className="caps">Unusual moves · {moves.length}</span>
        <button className="small link" onClick={() => setSheet(true)}>±{prefs.move}% or {prefs.volume}× volume</button>
      </div>
      {moves.length === 0 ? <p className="small muted">Nothing crossed your line in this window.</p> : (
        <div className="card" style={{ padding: "4px 14px" }}>
          {moves.slice(0, more ? 40 : 4).map((m) => <MoveRow key={m.symbol + m.date} m={m} />)}
          {moves.length > 4 && <button className="small link" style={{ padding: "9px 0" }} onClick={() => setMore(!more)}>{more ? "fewer" : `and ${moves.length - 4} more`}</button>}
        </div>
      )}
      {sheet && (
        <Sheet onClose={() => setSheet(false)}>
          <h2 style={{ font: "600 21px/1.2 var(--serif)" }}>What counts as unusual?</h2>
          <p className="muted small" style={{ marginTop: 4 }}>You draw the line. FINN shows what that line would have cost you in interruptions.</p>
          <div style={{ marginTop: 20 }}>
            <div className="row between"><span className="caps">Daily price move</span><span className="big num">±{prefs.move}%</span></div>
            <input className="slider" type="range" min={1} max={10} step={0.5} value={prefs.move} onChange={(e) => setPrefs({ move: Number(e.target.value) })} aria-label="Price move threshold" />
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="row between"><span className="caps">Volume vs 20-day average</span><span className="big num">{prefs.volume}×</span></div>
            <input className="slider" type="range" min={1.5} max={8} step={0.5} value={prefs.volume} onChange={(e) => setPrefs({ volume: Number(e.target.value) })} aria-label="Volume threshold" />
          </div>
          {hist && (
            <div className="note">
              Over the last {hist.sessions} sessions this line would have alerted you <b>{hist.fires.toLocaleString("en-IN")} times</b> across {n} stocks:
              about <b>{(hist.fires / hist.sessions * 5).toFixed(1)} a week</b>. In the window you are viewing it fires {moves.length} time{moves.length === 1 ? "" : "s"}.
            </div>
          )}
          <div className="caps" style={{ marginTop: 22 }}>Filings that may interrupt you</div>
          <p className="muted small" style={{ marginTop: 4 }}>Other kinds still appear, one line each, under “Worth a glance”.</p>
          <div className="chips" style={{ flexWrap: "wrap", margin: "10px 0 0", padding: 0 }}>
            {Object.entries(digest.labels).filter(([k]) => !["routine", "other", "investor_meetings", "shareholder_meeting", "earnings_call"].includes(k)).map(([k, label]) => {
              const on = prefs.alertOn.includes(k);
              return <button key={k} className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setPrefs({ alertOn: on ? prefs.alertOn.filter((x) => x !== k) : [...prefs.alertOn, k] })}>{label}</button>;
            })}
          </div>
          {typeof Notification !== "undefined" && (
            <div className="note row between">
              <span className="grow">{perm === "granted" ? "This device will be notified when a new filing of these kinds needs you." : perm === "denied" ? "Notifications are blocked for FINN in this browser’s settings." : "Get a notification on this device when a new filing needs you."}</span>
              {perm === "default" && <button className="btn" onClick={() => Notification.requestPermission().then(setPerm)}>Allow</button>}
            </div>
          )}
          <p className="tiny faint" style={{ marginTop: 18 }}>“This unusual 1 in N days” is the stock’s own history: the share of its last 500 sessions with a market-adjusted move, measured against its expected volatility that day, or a relative volume at least this large.</p>
        </Sheet>
      )}
    </section>
  );
}
