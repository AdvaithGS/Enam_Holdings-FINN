"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chart, Seg } from "@/components/Chart";
import { Spark } from "@/components/Moves";
import { initials } from "@/components/People";
import { Sheet, useOpenPerson } from "@/components/Shell";
import { crore, num, oneIn, pct, tone } from "@/lib/client/format";
import { useHoldings } from "@/lib/client/holdings";
import { useStore } from "@/lib/client/store";
import { contributions, type Holding, positions, risk } from "@/lib/portfolio/risk.ts";

const P1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const cr = (rupees: number) => `₹${crore(rupees / 1e7)}`;

export default function Book() {
  const { holdings, save, custom, expect, setExpect, market, digest } = useHoldings();
  const { graph } = useStore();
  const openPerson = useOpenPerson();
  const [edit, setEdit] = useState<Holding | null>(null);
  const [view, setView] = useState<"value" | "alpha">("value");
  const [settings, setSettings] = useState(false);
  const [openCov, setOpenCov] = useState<string | null>(null);

  const pos = useMemo(() => (holdings && market ? positions(holdings, market, expect) : []), [holdings, market, expect]);
  const r = useMemo(() => (market && pos.length ? risk(pos, market) : null), [pos, market]);
  const contrib = useMemo(() => (market && pos.length ? contributions(pos, market) : null), [pos, market]);
  // coverage, business by business: a company is covered only as far as its businesses are
  const cover = useMemo(() => new Map(pos.map((p) => {
    const org = graph?.orgId(p.symbol);
    return [p.symbol, org && graph ? graph.coverage(org) : null] as const;
  })), [pos, graph]);

  if (!digest || !market || !holdings) return <div className="top"><div className="brand">Book<i>.</i></div><div style={{ marginTop: 24 }}><div className="skel" /><div className="skel" /></div></div>;
  const value = pos.reduce((a, p) => a + p.value, 0), cost = pos.reduce((a, p) => a + p.cost, 0), gap = pos.reduce((a, p) => a + p.gap, 0);
  const benchValue = pos.reduce((a, p) => a + p.cost * (1 + (p.bench ?? 0)), 0);
  const covered = pos.reduce((a, p) => a + p.weight * (cover.get(p.symbol)?.covered ?? 0), 0);
  const blind = pos.map((p) => ({ p, miss: (cover.get(p.symbol)?.segments ?? []).filter((x) => !x.leads.length) })).filter((x) => x.miss.length)
    .sort((a, b) => b.p.weight * b.miss.length / Math.max(1, cover.get(b.p.symbol)!.segments.length) - a.p.weight * a.miss.length / Math.max(1, cover.get(a.p.symbol)!.segments.length));
  const fading = r && r.alphaNow !== null && r.alphaBefore !== null ? r.alphaNow < r.alphaBefore : null;

  return (
    <>
      <header className="top">
        <div className="row between"><div className="brand">Book<i style={{ color: "var(--blue)" }}>.</i></div>
          <button className="tiny link" onClick={() => setSettings(true)}>{custom ? "your holdings" : "demo holdings"} · on this device</button></div>
        <p className="lede">
          <b>{cr(value)}</b> in {pos.length} companies, <b className={tone(value - cost)}>{pct(value / cost - 1, 1)}</b> on cost.
          The same rupees in the NIFTY: <b className={tone(benchValue - cost)}>{pct(benchValue / cost - 1, 1)}</b>.
        </p>
      </header>

      <section className="section" style={{ marginTop: 14 }}>
        <div className="card" style={{ borderLeft: `4px solid ${gap >= 0 ? "var(--up)" : "var(--matter)"}` }}>
          <div className="row between"><span className="caps">Against what you expected</span>
            <button className="small link" onClick={() => setSettings(true)}>{(expect * 100).toFixed(0)}% a year</button></div>
          <p style={{ marginTop: 8 }}>At {(expect * 100).toFixed(0)}% a year from each purchase date, this book should be worth {cr(value - gap)}. It is{" "}
            <b className={tone(gap)}>{cr(Math.abs(gap))} {gap >= 0 ? "ahead" : "behind"}</b>; {pos.filter((p) => p.gap >= 0).length} of {pos.length} positions are ahead of that pace.</p>
          <div className="gauge" title="Share of the book's value in positions ahead of pace">
            <i style={{ left: 0, width: `${pos.filter((p) => p.gap >= 0).reduce((a, p) => a + p.weight, 0) * 100}%`, background: "var(--up)" }} /></div>
          <p className="tiny faint" style={{ marginTop: 6 }}>Green: share of the book, by value, in positions ahead of pace.</p>
        </div>
      </section>

      {r && (
        <section className="section">
          <div className="head"><span className="caps">Risk · last {r.sessions} sessions, today’s weights</span></div>
          <div className="tiles" style={{ marginTop: 0 }}>
            <div className="tile"><span className="caps">Bad day, 1 in 20</span><b className="down">−{P1(r.var95)}</b><span className="tiny faint">{cr(value * r.var95)} · 95% VaR</span></div>
            <div className="tile"><span className="caps">When it is worse</span><b className="down">−{P1(r.shortfall)}</b><span className="tiny faint">mean of the worst 5%</span></div>
            <div className="tile"><span className="caps">Volatility</span><b>{P1(r.vol)}</b><span className="tiny faint">a year · beta {r.beta.toFixed(2)}</span></div>
            <div className="tile"><span className="caps">Alpha</span><b className={tone(r.alpha)}>{pct(r.alpha, 1)}</b><span className="tiny faint">a year, after beta</span></div>
            <div className="tile"><span className="caps">Tracking error</span><b>{P1(r.te)}</b><span className="tiny faint">info ratio {r.ir.toFixed(2)}</span></div>
            <div className="tile"><span className="caps">Is the edge fading?</span><b className={fading === null ? "" : fading ? "down" : "up"}>{fading === null ? "–" : fading ? "Yes" : "No"}</b>
              <span className="tiny faint">{r.alphaNow !== null && r.alphaBefore !== null ? `${pct(r.alphaBefore, 0)} → ${pct(r.alphaNow, 0)}` : "needs 120 sessions"}</span></div>
          </div>
          <div className="card" style={{ marginTop: 10 }}>
            <Seg value={view} onChange={setView} options={[["value", "Book vs NIFTY"], ["alpha", "Rolling alpha"]]} />
            {view === "value"
              ? <Chart key="v" labels={r.dates} height={140} series={[{ name: "Book", color: "var(--blue)", values: r.curve, kind: "area", fmt: (v) => pct(v, 1) }, { name: "NIFTY", color: "var(--ink-3)", values: r.benchCurve, kind: "line", fmt: (v) => pct(v, 1) }]} />
              : <Chart key="a" labels={r.dates} height={140} series={[{ name: "Alpha, trailing 60 sessions", color: "var(--violet)", values: r.rolling, kind: "area", fmt: (v) => pct(v, 0) }]} />}
            <p className="tiny faint" style={{ marginTop: 6 }}>{view === "value" ? "What today’s book would have returned, held at today’s weights. Drag to read a date." : "Annualised return beyond market exposure over each trailing 60 sessions. A falling line is an edge decaying."}</p>
          </div>
        </section>
      )}

      {contrib && (
        <section className="section">
          <div className="head"><span className="caps">Where the risk sits</span><span className="tiny faint">share of risk vs share of money</span></div>
          <div className="card">
            {contrib.slice(0, 6).map((c) => (
              <div key={c.symbol} style={{ marginTop: 8 }}>
                <div className="row between small"><span><b>{c.symbol}</b> <span className="muted">{(c.weight * 100).toFixed(1)}% of the money</span></span>
                  <b className={c.share > c.weight * 1.25 ? "down" : ""}>{(c.share * 100).toFixed(1)}% of the risk</b></div>
                <div className="gauge" style={{ height: 6, marginTop: 4 }}><i style={{ left: 0, width: `${Math.min(100, c.share * 100 * 4)}%`, background: "var(--rose)" }} /><i style={{ left: `${Math.min(100, c.weight * 100 * 4)}%`, width: 2, background: "var(--ink)" }} /></div>
              </div>))}
            <p className="tiny faint" style={{ marginTop: 10 }}>The bar is the holding’s share of the book’s variance; the tick is its weight. Covariance over {market.risk?.sessions} sessions with noise eigenvalues flattened (Marchenko-Pastur); {market.risk?.modes} real mode{market.risk?.modes === 1 ? "" : "s"} kept.</p>
          </div>
        </section>
      )}

      <section className="section">
        <div className="head"><span className="caps" style={{ color: "var(--people)" }}>Coverage · {P1(covered)} of the book, business by business</span></div>
        {blind.length > 0 && <p className="small" style={{ marginBottom: 10 }}>
          <b style={{ color: "var(--matter)" }}>Largest blind spots:</b> {blind.slice(0, 4).map(({ p, miss }) => `${p.symbol} (${(p.weight * 100).toFixed(0)}% of the book): ${miss.map((m) => m.segment.label.toLowerCase()).slice(0, 3).join(", ")}`).join(" · ")}.</p>}
        <div className="card" style={{ padding: "2px 14px" }}>
          {pos.map((p) => {
            const cv = cover.get(p.symbol), isOpen = openCov === p.symbol;
            const have = cv?.segments.filter((x) => x.leads.length).length ?? 0;
            return (
              <div className="hold" key={p.symbol}>
                <div style={{ minWidth: 0 }}>
                  <Link href={`/research/${p.symbol}`} className="tick">{p.symbol}</Link> <span className="small muted">{(p.weight * 100).toFixed(1)}% · {num(p.qty)} @ ₹{num(p.entry, p.entry < 1000 ? 1 : 0)}</span>
                  <div className="wbar"><i style={{ width: `${Math.min(100, p.weight * 100 * 8)}%` }} /></div>
                  {cv && <button className="segs" onClick={() => setOpenCov(isOpen ? null : p.symbol)} aria-expanded={isOpen}>
                    {cv.segments.map((x) => <span key={x.segment.id} className={`segp ${x.leads.length ? "on" : ""}`} title={x.segment.label}>{x.leads.length ? initials(x.leads[0].person.name) : "–"}</span>)}
                    <span className={`cover ${have === 0 ? "none" : ""}`} style={{ marginTop: 0 }}>{cv.segments.length === 1 ? (have ? cv.segments[0].leads[0].person.name : "No one covers this")
                      : `${have} of ${cv.segments.length} businesses covered`}</span>
                  </button>}
                  {cv && isOpen && <div style={{ marginTop: 6 }}>
                    {cv.segments.map((x) => (
                      <div key={x.segment.id} className="segrow">
                        <span className={x.leads.length ? "" : "cover none"} style={{ marginTop: 0 }}>{x.segment.label}</span>
                        <span>{x.leads.length ? x.leads.map((l) => (
                          <button key={l.person.id} className="cover" style={{ display: "block", marginTop: 0, textAlign: "right" }} onClick={() => openPerson(l.person.id)}>
                            <b>{l.person.name}</b> · {l.relation === "inside" ? (l.insider ? "there now" : `was there to ${l.role.to}`) : l.relation.split(" (")[0]}</button>)) : <span className="cover none" style={{ marginTop: 0 }}>no one</span>}</span>
                      </div>))}
                    {cv.group.length > 0 && <div className="segrow"><span className="muted">Group level</span><span>{cv.group.map((l) => <button key={l.person.id} className="cover" style={{ display: "block", marginTop: 0 }} onClick={() => openPerson(l.person.id)}><b>{l.person.name}</b></button>)}</span></div>}
                  </div>}
                </div>
                <button style={{ textAlign: "right" }} onClick={() => setEdit(p)} aria-label={`Edit ${p.symbol}`}>
                  <span style={{ display: "block", width: 72, marginLeft: "auto" }}><Spark data={market.series[p.symbol].close.slice(-60)} up={p.ret >= 0} /></span>
                  <b className={`num ${tone(p.ret)}`}>{pct(p.ret, 1)}</b>
                  <span className="tiny faint" style={{ display: "block" }}>NIFTY {p.bench === null ? "–" : pct(p.bench, 1)}</span>
                  <span className={`tiny ${p.gap >= 0 ? "up" : "down"}`} style={{ display: "block" }}>{p.gap >= 0 ? "ahead" : "behind"} {cr(Math.abs(p.gap))}</span>
                  {p.progress !== null && <span className="tiny faint" style={{ display: "block" }}>{(Math.max(0, p.progress) * 100).toFixed(0)}% to target</span>}
                </button>
              </div>
            );
          })}
        </div>
        <p className="tiny faint" style={{ marginTop: 8 }}>Tap the figures on the right to change quantity, entry price, date or target. Prices are the close of {market.as_of}.</p>
      </section>

      {edit && <Editor h={edit} onClose={() => setEdit(null)} onSave={(h) => { save(holdings.map((x) => (x.symbol === h.symbol ? h : x)).filter((x) => x.qty > 0)); setEdit(null); }} />}
      {settings && (
        <Sheet onClose={() => setSettings(false)}>
          <h2 style={{ font: "600 21px/1.2 var(--serif)" }}>Your book stays with you</h2>
          <p className="muted small" style={{ marginTop: 6 }}>Holdings are stored in this browser only. Every figure on this page is computed here from public closing prices. {custom ? "" : "You are looking at a demo book of ₹10 crore."}</p>
          <div className="row between" style={{ marginTop: 20 }}><span className="caps">Return you expect</span><span className="big num">{(expect * 100).toFixed(0)}%</span></div>
          <input className="slider" type="range" min={5} max={30} step={1} value={expect * 100} onChange={(e) => setExpect(Number(e.target.value) / 100)} aria-label="Expected annual return" />
          <p className="tiny faint">A year, compounded from each purchase date. FINN holds every position to it.</p>
          {custom && <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => { save(null); setSettings(false); }}>Erase my changes, back to the demo book</button>}
        </Sheet>
      )}
    </>
  );
}

function Editor({ h, onClose, onSave }: { h: Holding; onClose: () => void; onSave: (h: Holding) => void }) {
  const [d, setD] = useState({ qty: String(h.qty), entry: String(h.entry), date: h.date, target: h.target ? String(h.target) : "" });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  const ok = Number(d.qty) >= 0 && Number(d.entry) > 0 && /^\d{4}-\d\d-\d\d$/.test(d.date);
  return (
    <Sheet onClose={onClose}>
      <h2 style={{ font: "600 21px/1.2 var(--serif)" }}>{h.symbol}</h2>
      <div className="field">
        <label>Shares<input inputMode="numeric" value={d.qty} onChange={set("qty")} /></label>
        <label>Entry price, ₹<input inputMode="decimal" value={d.entry} onChange={set("entry")} /></label>
        <label>Bought on<input type="date" value={d.date} onChange={set("date")} /></label>
        <label>Target price, ₹ (optional)<input inputMode="decimal" value={d.target} onChange={set("target")} /></label>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={!ok} onClick={() => onSave({ symbol: h.symbol, qty: Number(d.qty), entry: Number(d.entry), date: d.date, target: d.target ? Number(d.target) : null })}>Save</button>
        <button className="btn ghost" onClick={() => onSave({ ...h, qty: 0 })}>Remove from book</button>
      </div>
      <p className="tiny faint" style={{ marginTop: 12 }}>Set shares to 0 to remove. {oneIn(0.05)} days is how often the book loses more than its VaR.</p>
    </Sheet>
  );
}
