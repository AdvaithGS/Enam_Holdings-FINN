"use client";
import { useEffect, useMemo, useState } from "react";
import { day, oneIn, pct, tone } from "@/lib/client/format";
import { useStore } from "@/lib/client/store";
import type { Digest, FinnEvent, Market } from "@/lib/types";
import { Sheet } from "./Shell";

export interface Move { symbol: string; date: string; change: number; vol: number | null; p: number | null; abnormal: number | null; spark: number[]; event?: FinnEvent }

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
        out.push({ symbol, date: s.dates[i], change: ch, vol: v, abnormal: s.abnormal[i], p: ps.length ? Math.min(...ps) : null,
          spark: s.close.slice(Math.max(0, i - 29), i + 1), event: evs.find((e) => e.tier === "act") ?? evs.find((e) => e.tier === "glance") });
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

export function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return null;
  const lo = Math.min(...data), hi = Math.max(...data), w = 86, h = 26;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4)}`).join(" ");
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden><polyline points={pts} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.5" strokeLinejoin="round" /></svg>;
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
          {moves.slice(0, more ? 40 : 4).map((m) => (
            <a className="move" key={m.symbol + m.date} href={m.event ? `#${m.event.id}` : undefined}>
              <Spark data={m.spark} up={m.change >= 0} />
              <span>
                <span className="row between"><b><span className="tick">{m.symbol}</span> <span className={`num ${tone(m.change)}`}>{pct(m.change, 1)}</span></b><span className="tiny faint">{day(m.date)}</span></span>
                <span className="small muted" style={{ display: "block", marginTop: 3 }}>
                  {m.vol !== null ? `${m.vol.toFixed(1)}× volume` : ""}{m.p !== null ? ` · this unusual ${oneIn(m.p)} days for this stock` : ""}
                  {m.event ? <> · <span style={{ color: "var(--ink)" }}>{m.event.label.toLowerCase()} that day</span></> : m.p !== null && m.p <= 0.05 ? " · no filing explains it" : ""}
                </span>
              </span>
            </a>
          ))}
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
