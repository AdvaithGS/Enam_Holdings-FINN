"use client";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { Chart, Seg } from "@/components/Chart";
import { Spark } from "@/components/Moves";
import { Avatar, LeadLine } from "@/components/People";
import { useOpenPerson } from "@/components/Shell";
import { crore, num, pct, tone } from "@/lib/client/format";
import { type Cited, type Dossier, useDossier } from "@/lib/client/research";
import { useStore } from "@/lib/client/store";

const n = (v: unknown) => (typeof v === "number" ? v : null);
const P = (v: number) => `${(v * 100).toFixed(1)}%`;
const C = { blue: ["var(--blue)", "var(--blue-w)"], teal: ["var(--teal)", "var(--teal-w)"], violet: ["var(--violet)", "var(--violet-w)"], amber: ["var(--amber)", "var(--amber-w)"],
  rose: ["var(--rose)", "var(--rose-w)"], matter: ["var(--matter)", "var(--matter-wash)"], people: ["var(--people)", "var(--people-wash)"], ink: ["var(--ink)", "var(--wash)"] } as const;
const VERDICT: Record<string, string> = { met: "var(--up)", partial: "var(--amber)", missed: "var(--down)", pending: "var(--blue)", not_measurable: "var(--ink-3)" };

function Src({ ids, d }: { ids: string[]; d: Dossier }) {
  return <>{ids.map((id) => {
    const s = d.sources[id.split(".")[0]];
    return s ? <a key={id} className="src" href={s.url} target="_blank" rel="noreferrer" title={s.label}>{id}</a> : <span key={id} className="src">{id}</span>;
  })}</>;
}

/** A collapsible card. Closed, it still says its one-line conclusion. */
function Mod({ id, title, line, color, icon, open, toggle, children }: { id: string; title: string; line?: React.ReactNode; color: keyof typeof C; icon: string;
  open: Record<string, boolean>; toggle: (id: string) => void; children: React.ReactNode }) {
  const on = open[id] ?? false;
  return (
    <section className={`mod ${on ? "open" : ""}`} style={{ "--c": C[color][0], "--cw": C[color][1] } as React.CSSProperties}>
      <button onClick={() => toggle(id)} aria-expanded={on}>
        <span className="ic" aria-hidden>{icon}</span>
        <span className="grow"><span className="mt">{title}</span>{line && <span className="mh">{line}</span>}</span>
        <span className="chev" aria-hidden>›</span>
      </button>
      {on && <div className="body">{children}</div>}
    </section>
  );
}

const TABS = [["verdict", "Verdict", "var(--matter)"], ["numbers", "Numbers", "var(--blue)"], ["management", "Management", "var(--violet)"], ["business", "Business", "var(--amber)"]] as const;
type Tab = (typeof TABS)[number][0];
const DEFAULT_OPEN: Record<string, boolean> = { bullbear: true, price: true, trajectory: true, cash: true, pvd: true, what: true, people: true };

export default function Research({ params }: { params: Promise<{ symbol: string }> }) {
  const symbol = decodeURIComponent(use(params).symbol).toUpperCase();
  const { dossier: d, stages, error } = useDossier(symbol);
  const { graph, digest } = useStore();
  const openPerson = useOpenPerson();
  const [tab, setTab] = useState<Tab>("verdict");
  const [open, setOpen] = useState<Record<string, boolean>>(DEFAULT_OPEN);
  const [range, setRange] = useState<"1M" | "3M" | "1Y">("3M");
  const [grain, setGrain] = useState<"year" | "quarter">("year");
  const [view, setView] = useState<"size" | "margin">("size");
  const [only, setOnly] = useState<string | null>(null);
  const [quote, setQuote] = useState<string | null>(null);

  useEffect(() => { const t = new URLSearchParams(window.location.search).get("tab"); if (t && TABS.some((x) => x[0] === t)) setTab(t as Tab); }, []);
  useEffect(() => { try { const s = localStorage.getItem("finn.mods.v1"); if (s) setOpen({ ...DEFAULT_OPEN, ...JSON.parse(s) }); } catch { /* defaults */ } }, []);
  const save = (next: Record<string, boolean>) => { setOpen(next); try { localStorage.setItem("finn.mods.v1", JSON.stringify(next)); } catch { /* fine */ } };
  const toggle = (id: string) => save({ ...open, [id]: !(open[id] ?? false) });

  const leads = useMemo(() => {
    if (!graph) return [];
    const org = graph.orgId(symbol) ?? (d ? graph.orgId(d.name) : null);
    return org ? graph.whoToCall(org, [], 4).filter((l) => l.score >= 0.08) : [];
  }, [graph, symbol, d]);

  if (error) return <div className="top"><Link href="/ask" className="small link">‹ Ask</Link><p className="lede">{error}</p></div>;
  if (!d) return <div className="top"><Link href="/ask" className="small link">‹ Ask</Link><p className="lede">{digest?.companies[symbol]?.name ?? symbol}</p><div className="skel" style={{ marginTop: 16 }} /><div className="skel" /></div>;

  const f = d.fundamentals, m = f.metrics, a = d.analysis, last = f.annual[f.annual.length - 1], rows = f.annual.slice(-8);
  const px = d.price?.close ?? [], pd = d.price?.dates ?? [];
  const price = px.length ? px[px.length - 1] : null, chg = px.length > 1 ? px[px.length - 1] / px[px.length - 2] - 1 : null;
  const span = { "1M": 22, "3M": 66, "1Y": 260 }[range], pxs = px.slice(-span), pds = pd.slice(-span);
  const conv = n(m.cash_conversion_3y), de = n(m.de), g3 = n(m.revenue_cagr_3y), cyc = n(m.cycle_change_3y);
  const live = stages.some((s) => s.state === "now" || s.state === "wait");
  const ids = { verdict: ["bullbear", "story", "watch", "people"], numbers: ["price", "trajectory", "cash", "wc", "lev"], management: ["pvd", "drift", ...(d.call_extracts ?? []).map((c) => c.id)], business: ["what", "facts", "risks"] }[tab];
  const allOpen = ids.every((i) => open[i]);
  const pvd = a?.promised_vs_delivered.filter((x) => !only || x.verdict === only) ?? [];
  const q = f.quarters.slice(-8);
  const stats: [string, string, string][] = [
    ["Growth, 3y", pct(g3, 0, false), g3 !== null && g3 >= 0.15 ? "good" : g3 !== null && g3 < 0 ? "bad" : ""],
    [f.lender ? "Fin. margin" : "Op. margin", pct(n(m.opm_ttm), 1, false), ""],
    ...(f.lender ? [["ROA", pct(n(m.roa), 1, false), ""] as [string, string, string]] : [["Profit → cash", conv === null ? "–" : `${(conv * 100).toFixed(0)}%`, conv === null ? "" : conv >= 0.9 ? "good" : conv < 0.7 ? "bad" : ""] as [string, string, string]]),
    ["ROE", pct(n(m.roe), 1, false), n(m.roe) !== null && n(m.roe)! >= 0.15 ? "good" : ""],
    ["Debt / equity", de === null ? "–" : `${de.toFixed(2)}×`, !f.lender && de !== null && de > 1.5 ? "bad" : ""],
    ["P/E", n(m.pe) === null ? "–" : `${n(m.pe)!.toFixed(0)}×`, ""],
    ["Value", `₹${crore(n(m.mcap))}`, ""],
  ];
  const Empty = ({ what }: { what: string }) => <p className="note">{live ? `${what} will appear when FINN finishes reading.` : `${what} needs the earnings calls and annual report, which could not be read this time.`}</p>;
  const Points = ({ items }: { items: Cited[] }) => <>{items.map((x, i) => <p key={i}>{x.point}<Src ids={x.sources} d={d} /></p>)}</>;

  return (
    <>
      <header className="rhead">
        <div className="row" style={{ gap: 10 }}>
          <div className="grow">
            <div className="row" style={{ gap: 6 }}><Link href="/ask" className="small faint" aria-label="Back to Ask">‹</Link><span className="tick">{symbol}</span><span className="tiny faint clip">{d.industry.slice(-1)[0]}</span></div>
            <h1 className="clip" style={{ marginTop: 4 }}>{d.name}</h1>
          </div>
          {pxs.length > 1 && <div style={{ width: 74 }}><Spark data={px.slice(-66)} up={px[px.length - 1] >= px[Math.max(0, px.length - 66)]} /></div>}
          {price !== null && <div className="px num">₹{num(price, price < 1000 ? 1 : 0)}<span className={`small ${tone(chg)}`} style={{ display: "block", fontFamily: "var(--sans)" }}>{pct(chg, 1)}</span></div>}
        </div>
        <div className="stats">{stats.map(([k, v, t]) => <span key={k} className={`stat ${t}`}>{k}<b>{v}</b></span>)}</div>
        {leads[0] && (
          <button className="conn" onClick={() => openPerson(leads[0].person.id)}>
            <Avatar person={leads[0].person} />
            <span className="grow clip"><b>{leads[0].person.name}</b> · {leads[0].why}</span><span className="faint">›</span>
          </button>
        )}
        <div className="tabs" role="tablist">
          {TABS.map(([id, label, color]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} style={{ "--tab": color } as React.CSSProperties} onClick={() => { setTab(id); window.scrollTo({ top: 0 }); }}>{label}</button>)}
        </div>
      </header>

      <div className="row between" style={{ marginTop: 10 }}>
        <span className="tiny faint">{pd.length ? `close of ${pd[pd.length - 1]} · ` : ""}{f.basis} · ₹ crore</span>
        <button className="tiny link" onClick={() => save({ ...open, ...Object.fromEntries(ids.map((i) => [i, !allOpen])) })}>{allOpen ? "collapse all" : "expand all"}</button>
      </div>

      {stages.length > 0 && (live || stages.some((s) => s.state === "fail")) && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="caps">{live ? "Reading primary sources" : "What could be read"}</div>
          {stages.map((s) => <div key={s.id} className={`stage ${s.state}`}><span className="s" /><span className="grow">{s.label}</span><span className="tiny faint">{s.note ?? (s.state === "now" ? "reading" : "")}</span></div>)}
        </div>
      )}

      {tab === "verdict" && <>
        <Mod id="bullbear" title="Bull vs bear" color="matter" icon="±" open={open} toggle={toggle} line={a ? `${a.bull.length} for, ${a.bear.length} against, each tied to a source` : "after the documents are read"}>
          {a ? <div className="two">
            <div className="pane" style={{ background: "color-mix(in srgb, var(--up) 11%, transparent)" }}><div className="caps up" style={{ marginBottom: 6 }}>Bull</div><Points items={a.bull} /></div>
            <div className="pane" style={{ background: "color-mix(in srgb, var(--down) 10%, transparent)" }}><div className="caps down" style={{ marginBottom: 6 }}>Bear</div><Points items={a.bear} /></div>
          </div> : <Empty what="The case each way" />}
        </Mod>
        <Mod id="story" title="Story vs numbers" color="violet" icon="≠" open={open} toggle={toggle}
          line={a?.narrative_vs_numbers.length ? `${a.narrative_vs_numbers.filter((x) => x.verdict === "diverge").length} of ${a.narrative_vs_numbers.length} claims diverge from the numbers` : undefined}>
          {a?.narrative_vs_numbers.length ? a.narrative_vs_numbers.map((x, i) => (
            <div className="item" key={i}>
              <div className="row between" style={{ alignItems: "flex-start" }}><span className="grow"><span className="caps">They say</span><br />{x.story}</span><span className={`verdict ${x.verdict}`}>{x.verdict}</span></div>
              <p style={{ marginTop: 6 }}><span className="caps">Numbers say</span><br />{x.numbers}<Src ids={x.sources} d={d} /></p>
            </div>)) : <Empty what="Where management's story and the numbers part" />}
        </Mod>
        <Mod id="watch" title="Check next quarter" color="blue" icon="→" open={open} toggle={toggle} line={a?.watch[0]?.point}>
          {a?.watch.length ? <div className="pane" style={{ padding: 0 }}><Points items={a.watch} /></div> : <Empty what="What to watch" />}
        </Mod>
        {leads.length > 0 && (
          <Mod id="people" title="Who you know here" color="people" icon="☎" open={open} toggle={toggle} line={`${leads.length} ${leads.length === 1 ? "person" : "people"}: ${[...new Set(leads.map((l) => l.relation === "inside" ? "insider" : l.relation.split(" (")[0]))].join(", ")}`}>
            {leads.map((l, i) => <LeadLine key={l.person.id} lead={l} verb={i === 0 ? "Call" : "Or"} />)}
          </Mod>
        )}
      </>}

      {tab === "numbers" && <>
        {pxs.length > 1 && (
          <Mod id="price" title="Price" color="ink" icon="₹" open={open} toggle={toggle} line={<>₹{num(price)} · <span className={tone(pxs[pxs.length - 1] / pxs[0] - 1)}>{pct(pxs[pxs.length - 1] / pxs[0] - 1, 1)}</span> over {range === "1Y" ? "a year" : range === "3M" ? "3 months" : "a month"}</>}>
            <Seg value={range} onChange={setRange} options={[["1M", "1M"], ["3M", "3M"], ["1Y", "1Y"]]} />
            <Chart key={range} labels={pds} height={140} series={[{ name: "Close", color: pxs[pxs.length - 1] >= pxs[0] ? "var(--up)" : "var(--down)", values: pxs, kind: "area", fmt: (v) => `₹${num(v, v < 1000 ? 1 : 0)}` }]}
              note={(i) => `${pct(pxs[i] / pxs[0] - 1, 1)} since ${pds[0].slice(5)}`} />
          </Mod>
        )}
        <Mod id="trajectory" title="Trajectory" color="blue" icon="↗" open={open} toggle={toggle}
          line={<>Revenue {pct(g3, 0, false)} a year over 3 years, PAT {pct(n(m.pat_cagr_3y), 0, false)}; margin {n(m.opm_change_3y) !== null ? `${n(m.opm_change_3y)! >= 0 ? "up" : "down"} ${Math.abs(n(m.opm_change_3y)! * 1e4).toFixed(0)} bp` : "–"}</>}>
          <div className="row between"><Seg value={grain} onChange={setGrain} options={[["year", "Years"], ["quarter", "Quarters"]]} /><Seg value={view} onChange={setView} options={[["size", "₹"], ["margin", "Margin"]]} /></div>
          {grain === "year" ? (view === "size"
            ? <Chart key="ys" labels={rows.map((r) => r.fy)} series={[{ name: "Revenue", color: "var(--blue)", values: rows.map((r) => r.revenue), kind: "bar" }, { name: "PAT", color: "var(--matter)", values: rows.map((r) => r.pat), kind: "bar" }]}
                note={(i) => (i > 0 && rows[i].revenue && rows[i - 1].revenue ? `revenue ${pct(rows[i].revenue! / rows[i - 1].revenue! - 1)} YoY` : null)} />
            : <Chart key="ym" labels={rows.map((r) => r.fy)} series={[{ name: f.lender ? "Financing margin" : "Operating margin", color: "var(--blue)", values: rows.map((r) => r.opm), kind: "line", fmt: P }, { name: "PAT margin", color: "var(--matter)", values: rows.map((r) => r.npm), kind: "line", fmt: P }]} />)
            : (view === "size"
              ? <Chart key="qs" labels={q.map((r) => r.period)} series={[{ name: "Revenue", color: "var(--blue)", values: q.map((r) => r.revenue), kind: "bar" }, { name: "PAT", color: "var(--matter)", values: q.map((r) => r.pat), kind: "bar" }]}
                  note={(i) => (q[i].revenue_yoy !== null ? `revenue ${pct(q[i].revenue_yoy)} YoY, PAT ${pct(q[i].pat_yoy)}` : null)} />
              : <Chart key="qm" labels={q.map((r) => r.period)} series={[{ name: "Margin", color: "var(--blue)", values: q.map((r) => r.opm), kind: "line", fmt: P }]} />)}
          <p className="tiny faint" style={{ marginTop: 6 }}>Drag across the chart to read any period.<Src ids={["FIN"]} d={d} /></p>
        </Mod>
        {!f.lender && (
          <Mod id="cash" title="Cash quality" color="teal" icon="₹" open={open} toggle={toggle}
            line={conv === null ? "not computable" : <span className={conv < 0.7 ? "down" : conv >= 0.9 ? "up" : ""}>₹{(conv * 100).toFixed(0)} of every ₹100 of profit became operating cash (3 years)</span>}>
            <Chart labels={rows.map((r) => r.fy)} series={[{ name: "PAT", color: "var(--matter)", values: rows.map((r) => r.pat), kind: "bar" }, { name: "Operating cash", color: "var(--teal)", values: rows.map((r) => r.cfo), kind: "bar" },
              { name: "Free cash", color: "var(--violet)", values: rows.map((r) => r.fcf), kind: "line" }]}
              note={(i) => (rows[i].pat && rows[i].cfo !== null && rows[i].pat! > 0 ? `${((rows[i].cfo! / rows[i].pat!) * 100).toFixed(0)}% converted` : null)} />
            <p className="small muted" style={{ marginTop: 8 }}>Free cash flow over three years: ₹{crore(n(m.fcf_3y))}. Conversion sums cash and profit over the window before dividing, so one lumpy year cannot swing it.</p>
          </Mod>
        )}
        {!f.lender && last.cycle_days != null && (
          <Mod id="wc" title="Working-capital cycle" color="amber" icon="↻" open={open} toggle={toggle}
            line={<>{num(n(m.cycle_days))} days of cash tied up{cyc !== null && <>, <span className={cyc > 5 ? "down" : cyc < -5 ? "up" : ""}>{cyc >= 0 ? "up" : "down"} {Math.abs(cyc).toFixed(0)} in 3 years</span></>}</>}>
            <Chart labels={rows.map((r) => r.fy)} series={[{ name: "Cycle", color: "var(--amber)", values: rows.map((r) => r.cycle_days ?? null), kind: "area", fmt: (v) => `${v.toFixed(0)}d` },
              { name: "Receivables", color: "var(--blue)", values: rows.map((r) => r.debtor_days ?? null), kind: "line", fmt: (v) => `${v.toFixed(0)}d` },
              { name: "Inventory", color: "var(--violet)", values: rows.map((r) => r.inventory_days ?? null), kind: "line", fmt: (v) => `${v.toFixed(0)}d` },
              { name: "Payables", color: "var(--teal)", values: rows.map((r) => r.payable_days ?? null), kind: "line", fmt: (v) => `${v.toFixed(0)}d` }]} />
            <p className="tiny faint" style={{ marginTop: 6 }}>Cycle = receivable days + inventory days − payable days, each as 365 × average balance ÷ revenue.</p>
          </Mod>
        )}
        <Mod id="lev" title={f.lender ? "Funding and returns" : "Debt and returns"} color="violet" icon="⚖" open={open} toggle={toggle}
          line={<>Debt {de === null ? "–" : `${de.toFixed(2)}×`} equity · ROE {pct(n(m.roe), 1, false)}{n(m.net_debt_ebitda) !== null ? ` · net debt ${n(m.net_debt_ebitda)!.toFixed(1)}× operating profit` : ""}</>}>
          <Chart labels={rows.map((r) => r.fy)} series={[{ name: "Borrowings", color: "var(--rose)", values: rows.map((r) => r.debt), kind: "bar" }, { name: "Net worth", color: "var(--violet)", values: rows.map((r) => r.net_worth), kind: "bar" },
            { name: "ROE", color: "var(--teal)", values: rows.map((r) => r.roe), kind: "line", fmt: P, own: true }]} note={(i) => (rows[i].de !== null ? `D/E ${rows[i].de!.toFixed(2)}×` : null)} />
          {n(m.promoter) !== null && <p className="small muted" style={{ marginTop: 8 }}>Promoters hold {n(m.promoter)!.toFixed(1)}%{n(m.promoter_change) ? <>, {n(m.promoter_change)! > 0 ? "up" : "down"} {Math.abs(n(m.promoter_change)!).toFixed(1)} points ({String(m.promoter_span)})</> : null}.</p>}
        </Mod>
      </>}

      {tab === "management" && <>
        <Mod id="pvd" title="Promised vs delivered" color="matter" icon="✓" open={open} toggle={toggle}
          line={a?.promised_vs_delivered.length ? Object.entries(a.scorecard).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(" · ") : "after the earnings calls are read"}>
          {a?.promised_vs_delivered.length ? <>
            <div className="score" role="group" aria-label="Filter by verdict">
              {Object.entries(a.scorecard).map(([k, v]) => <button key={k} className={!only || only === k ? "on" : ""} style={{ flex: v, background: VERDICT[k] }} onClick={() => setOnly(only === k ? null : k)} title={k}>{v}</button>)}
            </div>
            <p className="tiny faint" style={{ marginTop: 5 }}>{only ? `Showing ${only.replace("_", " ")} · tap again for all` : "Tap a colour to filter: " + Object.keys(a.scorecard).map((k) => k.replace("_", " ")).join(", ")}</p>
            {pvd.map((x) => (
              <div className="item" key={x.commitment_id}>
                <div className="row between" style={{ alignItems: "flex-start" }}><b className="grow">{x.promised}</b><span className={`verdict ${x.verdict}`}>{x.verdict.replace("_", " ")}</span></div>
                <p className="muted" style={{ marginTop: 5 }}>{x.delivered}<Src ids={x.sources} d={d} />{x.by === "code" && <span className="src" title="Computed from reported numbers, not judged by a model">computed</span>}</p>
                <button className="tiny link" style={{ marginTop: 6 }} onClick={() => setQuote(quote === x.commitment_id ? null : x.commitment_id)}>{quote === x.commitment_id ? "hide" : "their words"}</button>
                {quote === x.commitment_id && <p className="quote">“{x.quote}”</p>}
              </div>))}
          </> : <Empty what="The scorecard of what management promised" />}
        </Mod>
        {a && a.guidance_drift.length > 0 && (
          <Mod id="drift" title="How guidance moved" color="blue" icon="⇅" open={open} toggle={toggle} line={a.guidance_drift.map((g) => `${g.metric} ${g.direction}`).slice(0, 3).join(" · ")}>
            {a.guidance_drift.map((g, i) => (
              <div className="item" key={i}><div className="row between"><b>{g.metric}</b><span className={`verdict ${g.direction === "raised" ? "met" : g.direction === "lowered" ? "missed" : ""}`}>{g.direction}</span></div>
                <p className="muted small" style={{ marginTop: 4 }}>{g.path}<Src ids={g.sources} d={d} /></p></div>))}
          </Mod>
        )}
        {(d.call_extracts ?? []).filter((c) => c.ok).map((c) => (
          <Mod key={c.id} id={c.id} title={`${c.quarter ?? "Earnings call"} call`} color="violet" icon={c.id} open={open} toggle={toggle} line={`${c.when} · ${c.commitments.length} commitments · analysts pressed on ${c.analyst_concerns.map((x) => x.topic.toLowerCase()).slice(0, 2).join(", ") || "nothing recorded"}`}>
            {c.claims.length > 0 && <><div className="caps">Management said</div>{c.claims.map((x, i) => <p key={i} className="small" style={{ marginTop: 6 }}><b>{x.topic}.</b> {x.claim}</p>)}</>}
            {c.analyst_concerns.length > 0 && <><div className="caps" style={{ marginTop: 12 }}>Analysts pressed on</div>{c.analyst_concerns.map((x, i) => <p key={i} className="small" style={{ marginTop: 6 }}><b>{x.topic}.</b> {x.question}</p>)}</>}
            {c.commitments.length > 0 && <><div className="caps" style={{ marginTop: 12 }}>On the record</div>{c.commitments.map((x) => <p key={x.id} className="small" style={{ marginTop: 6 }}>{x.target}<span className="src">{x.id}</span></p>)}</>}
            <p className="small" style={{ marginTop: 10 }}><a className="link" href={c.url} target="_blank" rel="noreferrer">Open the transcript</a></p>
          </Mod>))}
        {!(d.call_extracts ?? []).some((c) => c.ok) && !a && <Empty what="Call-by-call summaries" />}
      </>}

      {tab === "business" && (d.annual?.ok ? <>
        <Mod id="what" title="What it does" color="amber" icon="◆" open={open} toggle={toggle} line={d.annual.segments?.length ? `${d.annual.segments.length} segments` : undefined}>
          <p>{d.annual.what_it_does}<Src ids={["AR"]} d={d} /></p>
          {d.annual.segments?.map((s, i) => (
            <div key={s.name} style={{ marginTop: 9 }}>
              <div className="row between small"><span><b>{s.name}</b>{s.note ? <span className="muted"> · {s.note}</span> : null}</span>{s.share_pct ? <span className="num">{s.share_pct.toFixed(0)}%</span> : null}</div>
              {s.share_pct ? <div className="rho" style={{ marginTop: 4 }}><i style={{ width: `${Math.min(100, s.share_pct)}%`, background: [C.blue, C.teal, C.violet, C.amber, C.rose][i % 5][0] }} /></div> : null}
            </div>))}
          {d.annual.revenue_mix_basis && <p className="tiny faint" style={{ marginTop: 8 }}>{d.annual.revenue_mix_basis}</p>}
          {[d.annual.geography, d.annual.customers].filter(Boolean).map((t) => <p key={t} className="small muted" style={{ marginTop: 8 }}>{t}</p>)}
        </Mod>
        {d.annual.facts && d.annual.facts.length > 0 && <Mod id="facts" title="Operating facts" color="teal" icon="#" open={open} toggle={toggle} line={d.annual.facts[0].fact}>
          {d.annual.facts.map((x) => <p key={x.fact} className="small" style={{ marginTop: 6 }}>{x.fact} <span className="faint">p.{x.page}</span></p>)}</Mod>}
        {d.annual.risks && d.annual.risks.length > 0 && <Mod id="risks" title="Risks the company names" color="rose" icon="!" open={open} toggle={toggle} line={`${d.annual.risks.length} in the annual report`}>
          {d.annual.risks.map((r) => <p key={r.risk} className="small" style={{ marginTop: 6 }}>{r.risk} <span className="faint">p.{r.page}</span></p>)}</Mod>}
      </> : <Empty what="The business description" />)}

      <footer className="section tiny faint" style={{ lineHeight: 1.6 }}>
        Sources: {Object.entries(d.sources).map(([id, s], i) => <span key={id}>{i ? " · " : ""}<a className="link" href={s.url} target="_blank" rel="noreferrer">{id} {s.label}</a></span>)}.
        Prices are end of day. Ratios are computed in code from reported lines; every quoted sentence was checked to exist in its document. No news, broker research or outside knowledge.
      </footer>
    </>
  );
}
