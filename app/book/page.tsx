"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chart, Seg } from "@/components/Chart";
import { Spark } from "@/components/Moves";
import { Detail, Sheet, State, useWide } from "@/components/Shell";
import { Dumbbell, N } from "@/components/Viz";
import { crore, day, num, signed, tone } from "@/lib/client/format";
import { useHoldings } from "@/lib/client/holdings";
import { useStore } from "@/lib/client/store";
import { contributions, type Holding, type Position, positions, risk } from "@/lib/portfolio/risk.ts";

const cr = (rupees: number) => `₹${crore(rupees / 1e7)}`;
type Key = "weight" | "ret" | "vsNifty" | "gap" | "risk" | "cover";
const COLS: { k: Key; label: string; how: string }[] = [
  { k: "weight", label: "Weight", how: "Value of the position ÷ value of the book, at the latest close." },
  { k: "ret", label: "Return", how: "Latest close ÷ your entry price − 1." },
  { k: "vsNifty", label: "vs NIFTY", how: "Return minus what the NIFTY 50 returned from your entry date to the latest close." },
  { k: "gap", label: "vs pace", how: "Value now minus cost × (1 + your expected return)^(days held ÷ 365). The baseline is your own expected return, not the index." },
  { k: "risk", label: "Risk vs money", how: "Open dot: share of the book's money. Solid dot: share of its variance (w·(Σw) ÷ w'Σw, covariance over 250 sessions with noise eigenvalues flattened). Orange when the risk share is larger." },
  { k: "cover", label: "Coverage", how: "Businesses of the company for which someone in your network can explain the public context. The matrix is on the People tab." },
];

export default function Book() {
  const { holdings, save, custom, expect, setExpect, market, digest } = useHoldings();
  const { graph, error } = useStore();
  const wide = useWide();
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: "weight", dir: -1 });
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<"value" | "alpha">("value");
  const [settings, setSettings] = useState(false);
  const [how, setHow] = useState<Key | null>(null);

  const pos = useMemo(() => (holdings && market ? positions(holdings, market, expect) : []), [holdings, market, expect]);
  const r = useMemo(() => (market && pos.length ? risk(pos, market) : null), [pos, market]);
  const contrib = useMemo(() => new Map((market && pos.length ? contributions(pos, market) ?? [] : []).map((c) => [c.symbol, c.share])), [pos, market]);
  const cover = useMemo(() => new Map(pos.map((p) => { const org = graph?.orgId(p.symbol); return [p.symbol, org && graph ? graph.coverage(org) : null] as const; })), [pos, graph]);

  if (error) return <State kind="error" title="The book could not be loaded">Prices did not arrive. Reload to try again; your holdings are safe on this device.</State>;
  if (!digest || !market || !holdings) return <State kind="loading" />;
  if (!pos.length) return <State kind="empty" title="No holdings yet"><button className="btn" onClick={() => save(null)}>Load the demo book</button></State>;

  const value = pos.reduce((a, p) => a + p.value, 0), cost = pos.reduce((a, p) => a + p.cost, 0), gap = pos.reduce((a, p) => a + p.gap, 0);
  const bench = pos.reduce((a, p) => a + p.cost * (1 + (p.bench ?? 0)), 0);
  const val = (p: Position, k: Key): number => k === "weight" ? p.weight : k === "ret" ? p.ret : k === "vsNifty" ? p.ret - (p.bench ?? 0) : k === "gap" ? p.gap
    : k === "risk" ? (contrib.get(p.symbol) ?? 0) - p.weight : cover.get(p.symbol)?.covered ?? 0;
  const rows = [...pos].sort((a, b) => (val(a, sort.k) - val(b, sort.k)) * sort.dir);
  const maxShare = Math.max(...pos.map((p) => Math.max(p.weight, contrib.get(p.symbol) ?? 0)));
  const chosen = pos.find((p) => p.symbol === sel) ?? null;
  const fading = r && r.alphaNow !== null && r.alphaBefore !== null ? r.alphaNow < r.alphaBefore : null;

  const overview = r && (
    <>
      <div className="sub" style={{ marginTop: 0 }}>Risk over the last {r.sessions} sessions, at today’s weights</div>
      <div className="kv" style={{ gridTemplateColumns: "88px 1fr" }}>
        <span className="k">−{(r.var95 * 100).toFixed(1)}%</span><span className="v">A bad day, 1 in 20 (95% historical VaR): {cr(value * r.var95)}. When it is worse, the average is −{(r.shortfall * 100).toFixed(1)}%.</span>
        <span className="k">{(r.vol * 100).toFixed(1)}%</span><span className="v">Volatility a year, at a beta of {r.beta.toFixed(2)} to the NIFTY.</span>
        <span className={`k ${tone(r.alpha)}`}>{signed(r.alpha)}</span><span className="v">Alpha a year after beta; tracking error {(r.te * 100).toFixed(1)}%, information ratio {r.ir.toFixed(2)}.</span>
        <span className="k">{fading === null ? "–" : fading ? "Fading" : "Holding"}</span><span className="v">The edge: alpha over the latest 60 sessions {r.alphaNow !== null ? signed(r.alphaNow, 0) : "–"}, the 60 before {r.alphaBefore !== null ? signed(r.alphaBefore, 0) : "–"}.</span>
      </div>
      <div style={{ marginTop: 16 }}><Seg value={view} onChange={setView} options={[["value", "Book vs NIFTY"], ["alpha", "Rolling alpha"]]} /></div>
      {view === "value"
        ? <Chart key="v" labels={r.dates} height={150} series={[{ name: "Book", color: "var(--ink)", values: r.curve, kind: "line", fmt: (v) => signed(v) }, { name: "NIFTY", color: "var(--ink-3)", values: r.benchCurve, kind: "line", fmt: (v) => signed(v) }]} />
        : <Chart key="a" labels={r.dates} height={150} series={[{ name: "Alpha, trailing 60 sessions", color: "var(--ink)", values: r.rolling, kind: "line", fmt: (v) => signed(v, 0) }]} />}
      <p className="tiny" style={{ marginTop: 6 }}>{view === "value" ? "What today’s book would have returned at today’s weights. Drag to read a date." : "Annualised return beyond market exposure over each trailing 60 sessions. A falling line is an edge decaying."}</p>
    </>
  );

  return (
    <>
      <header className="top">
        <h1 className="lede">{cr(value)} in {pos.length} holdings, <span className={tone(value - cost)}>{signed(value / cost - 1)}</span> on cost</h1>
        <p className="counts">
          The same rupees in the NIFTY: <b className={tone(bench - cost)}>{signed(bench / cost - 1)}</b>. Against your pace of{" "}
          <button className="n" onClick={() => setSettings(true)}>{(expect * 100).toFixed(0)}% a year</button>: <b className={tone(gap)}>{cr(Math.abs(gap))} {gap >= 0 ? "ahead" : "behind"}</b>,{" "}
          with {pos.filter((p) => p.gap >= 0).length} of {pos.length} positions ahead.
        </p>
        <p className="tiny" style={{ marginTop: 2 }}>{custom ? "Your holdings" : "Demo holdings"}, kept on this device · closes of {day(market.as_of)} · <button className="link" onClick={() => setSettings(true)}>settings</button></p>
      </header>

      <section className="section">
        <div className="tblwrap tblwide">
          <table className="tbl">
            <thead><tr>
              <th>Holding</th>
              {COLS.map((c) => (
                <th key={c.k} className="sort" aria-sort={sort.k === c.k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  <button onClick={() => setSort({ k: c.k, dir: sort.k === c.k ? (sort.dir === 1 ? -1 : 1) : -1 })} style={{ font: "inherit", color: "inherit", minHeight: 44 }}>{c.label}{sort.k === c.k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button>
                </th>
              ))}
              <th>60 sessions</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => {
                const cv = cover.get(p.symbol), have = cv?.segments.filter((x) => x.leads.length).length ?? 0, share = contrib.get(p.symbol);
                return (
                  <tr key={p.symbol} aria-current={sel === p.symbol} onClick={() => setSel(sel === p.symbol ? null : p.symbol)} style={{ cursor: "pointer" }}>
                    <td><button style={{ font: "inherit", fontWeight: 600, minHeight: 24 }} aria-expanded={sel === p.symbol}>{p.symbol}</button></td>
                    <td>{(p.weight * 100).toFixed(1)}%</td>
                    <td className={tone(p.ret)}>{signed(p.ret)}</td>
                    <td className={tone(p.ret - (p.bench ?? 0))}>{p.bench === null ? "–" : signed(p.ret - p.bench)}</td>
                    <td className={tone(p.gap)}>{p.gap >= 0 ? "+" : "−"}{cr(Math.abs(p.gap))}</td>
                    <td>{share !== undefined ? <Dumbbell weight={p.weight} risk={share} max={maxShare} /> : "–"}</td>
                    <td className={cv && have === 0 ? "" : "dim"} style={cv && have === 0 ? { color: "var(--alert)" } : undefined}>{cv ? `${have} of ${cv.segments.length}` : "–"}</td>
                    <td style={{ width: 84 }}><Spark data={market.series[p.symbol].close.slice(-60)} up={p.ret >= 0} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="tiny" style={{ marginTop: 8 }}>
          {COLS.map((c, i) => <span key={c.k}>{i ? " · " : ""}<button className="link" onClick={() => setHow(how === c.k ? null : c.k)}>{c.label}</button></span>)}: tap a name for how it is computed. Tap a column to sort, a row for the position.
        </p>
        {how && <p className="srcnote">{COLS.find((c) => c.k === how)!.how}</p>}
      </section>

      {chosen ? (
        <Detail>
          <PositionDetail key={chosen.symbol} p={chosen} share={contrib.get(chosen.symbol)} expect={expect}
            onSave={(h) => { save(holdings.map((x) => (x.symbol === h.symbol ? h : x)).filter((x) => x.qty > 0)); if (h.qty <= 0) setSel(null); }} />
        </Detail>
      ) : wide ? <Detail fallback>{overview}</Detail> : <section className="section">{overview}</section>}

      {settings && (
        <Sheet onClose={() => setSettings(false)}>
          <h2 style={{ font: "var(--h)" }}>Your book stays with you</h2>
          <p className="muted small" style={{ marginTop: 6 }}>Holdings are stored in this browser only. Every figure on this page is computed here from public closing prices. {custom ? "" : "You are looking at a demo book of ₹10 crore."}</p>
          <div className="row between" style={{ marginTop: 20 }}><span className="caps">Return you expect, a year</span><span className="big num">{(expect * 100).toFixed(0)}%</span></div>
          <input className="slider" type="range" min={5} max={30} step={1} value={expect * 100} onChange={(e) => setExpect(Number(e.target.value) / 100)} aria-label="Expected annual return" />
          <p className="tiny">Compounded from each purchase date. “vs pace” holds every position to it.</p>
          {custom && <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => { save(null); setSettings(false); }}>Erase my changes, back to the demo book</button>}
        </Sheet>
      )}
    </>
  );
}

function PositionDetail({ p, share, expect, onSave }: { p: Position; share?: number; expect: number; onSave: (h: Holding) => void }) {
  const [d, setD] = useState({ qty: String(p.qty), entry: String(p.entry), date: p.date, target: p.target ? String(p.target) : "" });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  const ok = Number(d.qty) >= 0 && Number(d.entry) > 0 && /^\d{4}-\d\d-\d\d$/.test(d.date);
  return (
    <>
      <div className="meta1" style={{ display: "flex", gap: 8, font: "var(--d)", color: "var(--ink-3)" }}><b style={{ color: "var(--ink)" }}>{p.symbol}</b><span>{(p.weight * 100).toFixed(1)}% of the book</span></div>
      <h2>{cr(p.value)}, <span className={tone(p.ret)}>{signed(p.ret)}</span> since {day(p.date)}</h2>
      <div className="kv" style={{ gridTemplateColumns: "104px 1fr" }}>
        <span className="k">{num(p.qty)}</span><span className="v">shares at ₹{num(p.entry, p.entry < 1000 ? 1 : 0)}, now ₹{num(p.last, p.last < 1000 ? 1 : 0)}; held {p.days} days.</span>
        <span className={`k ${tone(p.ret - (p.bench ?? 0))}`}>{p.bench === null ? "–" : signed(p.ret - p.bench)}</span><span className="v">against the NIFTY, which returned {p.bench === null ? "–" : signed(p.bench)} over the same days.</span>
        <span className={`k ${tone(p.gap)}`}>{p.gap >= 0 ? "+" : "−"}{cr(Math.abs(p.gap))}</span><span className="v">against your pace: at {(expect * 100).toFixed(0)}% a year it would be worth <N how={`cost × (1 + ${(expect * 100).toFixed(0)}%)^(${p.days} ÷ 365)`}>{cr(p.expected)}</N>.</span>
        {share !== undefined && <><span className="k" style={share > p.weight ? { color: "var(--alert)" } : undefined}>{(share * 100).toFixed(1)}%</span><span className="v">of the book’s risk, on {(p.weight * 100).toFixed(1)}% of its money.</span></>}
        {p.progress !== null && <><span className="k">{(Math.max(0, p.progress) * 100).toFixed(0)}%</span><span className="v">of the way from entry to your target of ₹{num(p.target ?? 0)}.</span></>}
      </div>
      <p style={{ marginTop: 12 }}><Link className="link" href={`/research/${p.symbol}`}>Open research on {p.symbol}</Link></p>
      <div className="sub">Change this position</div>
      <div className="field" style={{ marginTop: 4 }}>
        <label>Shares<input inputMode="numeric" value={d.qty} onChange={set("qty")} /></label>
        <label>Entry price, ₹<input inputMode="decimal" value={d.entry} onChange={set("entry")} /></label>
        <label>Bought on<input type="date" value={d.date} onChange={set("date")} /></label>
        <label>Target price, ₹ (optional)<input inputMode="decimal" value={d.target} onChange={set("target")} /></label>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" disabled={!ok} onClick={() => onSave({ symbol: p.symbol, qty: Number(d.qty), entry: Number(d.entry), date: d.date, target: d.target ? Number(d.target) : null })}>Save</button>
        <button className="btn ghost" onClick={() => onSave({ ...p, qty: 0 })}>Remove from the book</button>
      </div>
    </>
  );
}
