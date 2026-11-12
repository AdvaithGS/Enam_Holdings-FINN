"use client";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { LeadLine } from "@/components/People";
import { crore, num, pct, tone } from "@/lib/client/format";
import { type Annual, type Cited, type Dossier, useDossier } from "@/lib/client/research";
import { useStore } from "@/lib/client/store";

const n = (v: unknown) => (typeof v === "number" ? v : null);

function Src({ ids, d }: { ids: string[]; d: Dossier }) {
  return <>{ids.map((id) => {
    const s = d.sources[id.split(".")[0]];
    return s ? <a key={id} className="src" href={s.url} target="_blank" rel="noreferrer" title={s.label}>{id}</a> : <span key={id} className="src">{id}</span>;
  })}</>;
}

function Bars({ rows, pick, accent }: { rows: Annual[]; pick: (r: Annual) => number | null; accent?: (r: Annual) => number | null }) {
  const vals = rows.map(pick);
  const max = Math.max(...vals.map((v) => Math.abs(v ?? 0)), 1);
  return (
    <div className="bars">
      {rows.map((r, i) => {
        const v = vals[i], a = accent ? accent(r) : null;
        return (
          <div className="col" key={r.fy} title={`${r.fy}: ${num(v)}`}>
            <div className={`bar ${v !== null && v < 0 ? "neg" : ""}`} style={{ height: `${(Math.abs(v ?? 0) / max) * 100}%` }}>
              {a !== null && v ? <i style={{ height: `${Math.max(0, Math.min(1, a / v)) * 100}%` }} /> : null}
            </div>
            <span>{r.fy.slice(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Tile({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return <div className="tile"><span className="caps">{label}</span><b className={cls}>{value}</b>{sub && <span className="tiny faint">{sub}</span>}</div>;
}

function Points({ title, items, d, color }: { title: string; items: Cited[]; d: Dossier; color?: string }) {
  if (!items?.length) return null;
  return (
    <div className="card">
      <div className="caps" style={color ? { color } : undefined}>{title}</div>
      {items.map((x, i) => <p key={i} style={{ marginTop: 9 }}>{x.point}<Src ids={x.sources} d={d} /></p>)}
    </div>
  );
}

export default function Research({ params }: { params: Promise<{ symbol: string }> }) {
  const symbol = decodeURIComponent(use(params).symbol).toUpperCase();
  const { dossier: d, stages, error } = useDossier(symbol);
  const { graph, digest } = useStore();
  const [quote, setQuote] = useState<string | null>(null);
  const [how, setHow] = useState(false);

  const leads = useMemo(() => {
    if (!graph) return [];
    const org = graph.orgId(symbol) ?? (d ? graph.orgId(d.name) : null);
    return org ? graph.whoToCall(org, [], 3).filter((l) => l.score >= 0.08) : [];
  }, [graph, symbol, d]);
  const themePeople = useMemo(() => {
    // a company outside the network's map: fall back to the field it is in
    if (!graph || !d || leads.length) return [];
    const words = d.industry.join(" ").toLowerCase();
    const theme = graph.net.themes.find((t) => t.label.toLowerCase().split(/[ &]+/).some((w) => w.length > 4 && words.includes(w.replace(/s$/, ""))));
    return theme ? graph.expertise(theme.id, 2).map((x) => ({ x, theme })) : [];
  }, [graph, d, leads]);

  const head = (
    <header className="top">
      <div className="row between"><Link href="/ask" className="small link">‹ Ask</Link><span className="tick">{symbol}</span></div>
      <h1 className="lede" style={{ fontSize: 24, fontWeight: 600 }}>{d?.name ?? digest?.companies[symbol]?.name ?? symbol}</h1>
      {d && <p className="small muted" style={{ marginTop: 2 }}>{d.industry.slice(-2).join(" · ")} · {d.fundamentals.basis}</p>}
    </header>
  );
  if (error) return <>{head}<p className="muted">{error}</p></>;
  if (!d) return <>{head}<div className="skel" /><div className="skel" /></>;

  const f = d.fundamentals, m = f.metrics, last = f.annual[f.annual.length - 1], rows = f.annual.slice(-8);
  const a = d.analysis;
  const live = stages.some((s) => s.state === "now" || s.state === "wait");
  const conv = n(m.cash_conversion_3y);

  return (
    <>
      {head}
      {stages.length > 0 && (live || stages.some((s) => s.state === "fail")) && (
        <div className="card">
          <div className="caps">{live ? "Reading primary sources" : "What could be read"}</div>
          {stages.map((s) => <div key={s.id} className={`stage ${s.state}`}><span className="s" /><span className="grow">{s.label}</span><span className="tiny faint">{s.note ?? (s.state === "now" ? "reading" : "")}</span></div>)}
        </div>
      )}

      {(leads.length > 0 || themePeople.length > 0) && (
        <section className="section" style={{ marginTop: 14 }}>
          <div className="head"><span className="caps" style={{ color: "var(--people)" }}>Before you read on: who you know</span></div>
          {leads.map((l, i) => <LeadLine key={l.person.id} lead={l} verb={i === 0 ? "Call" : "Or"} />)}
          {themePeople.map(({ x, theme }) => (
            <LeadLine key={x.person.id} verb="Ask" lead={{ person: x.person, role: x.roles[0], relation: theme.label, knowledge: x.expertise, tie: x.tie, score: x.tie * x.expertise, insider: false,
              why: `${x.years} years in ${theme.label.toLowerCase()}: ${x.roles[0].title}, ${graph!.orgName(x.roles[0].org)}`, factors: { relation: 0.3, freshness: 1, depth: 1, seniority: 1, fit: 1 } }} />
          ))}
        </section>
      )}

      <section className="section">
        <div className="head"><span className="caps">Now</span><Src ids={["FIN"]} d={d} /></div>
        <div className="tiles">
          <Tile label="Revenue, 12m" value={`₹${crore(n(m.revenue_ttm))}`} sub={`3y growth ${pct(n(m.revenue_cagr_3y), 0, false)} a year`} />
          <Tile label={f.lender ? "Financing margin" : "Operating margin"} value={pct(n(m.opm_ttm), 1, false)} sub={n(m.opm_change_3y) !== null ? `${(n(m.opm_change_3y)! * 1e4).toFixed(0)} bp in 3 years` : undefined} />
          <Tile label="PAT, 12m" value={`₹${crore(n(m.pat_ttm))}`} sub={`3y growth ${pct(n(m.pat_cagr_3y), 0, false)} a year`} />
          <Tile label="Return on equity" value={pct(n(m.roe), 1, false)} sub={f.lender ? `on assets ${pct(n(m.roa), 1, false)}` : `on capital ${pct(n(m.roce), 1, false)}`} />
          <Tile label="Debt / equity" value={n(m.de) !== null ? `${n(m.de)!.toFixed(2)}×` : "–"} sub={n(m.net_debt_ebitda) !== null ? `net debt ${n(m.net_debt_ebitda)!.toFixed(1)}× op. profit` : undefined} />
          <Tile label="Price / earnings" value={n(m.pe) !== null ? `${n(m.pe)!.toFixed(0)}×` : "–"} sub={`value ₹${crore(n(m.mcap))}`} />
        </div>
      </section>

      {d.annual?.ok && (
        <section className="section">
          <div className="head"><span className="caps">The business</span><Src ids={["AR"]} d={d} /></div>
          <div className="card">
            <p>{d.annual.what_it_does}</p>
            {d.annual.segments && d.annual.segments.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {d.annual.segments.map((s) => (
                  <div key={s.name} style={{ marginTop: 7 }}>
                    <div className="row between small"><span><b>{s.name}</b>{s.note ? <span className="muted"> · {s.note}</span> : null}</span>{s.share_pct ? <span className="num">{s.share_pct.toFixed(0)}%</span> : null}</div>
                    {s.share_pct ? <div className="rho" style={{ marginTop: 4 }}><i style={{ width: `${Math.min(100, s.share_pct)}%`, background: "var(--ink)" }} /></div> : null}
                  </div>
                ))}
                {d.annual.revenue_mix_basis && <p className="tiny faint" style={{ marginTop: 8 }}>{d.annual.revenue_mix_basis}</p>}
              </div>
            )}
            {[d.annual.geography, d.annual.customers].filter(Boolean).map((t) => <p key={t} className="small muted" style={{ marginTop: 8 }}>{t}</p>)}
            {d.annual.facts?.map((x) => <p key={x.fact} className="small" style={{ marginTop: 6 }}>{x.fact} <span className="faint">p.{x.page}</span></p>)}
          </div>
        </section>
      )}

      <section className="section">
        <div className="head"><span className="caps">Trajectory</span><span className="tiny faint">revenue, with PAT in orange · ₹ cr</span></div>
        <div className="card">
          <Bars rows={rows} pick={(r) => r.revenue} accent={(r) => r.pat} />
          <table className="rt">
            <thead><tr><th>Quarter</th><th>Revenue</th><th>YoY</th><th>{f.lender ? "Fin. margin" : "Op. margin"}</th><th>PAT YoY</th></tr></thead>
            <tbody>{f.quarters.slice(-5).reverse().map((q) => (
              <tr key={q.period}><td>{q.period}</td><td className="v">{num(q.revenue)}</td><td className={tone(q.revenue_yoy)}>{pct(q.revenue_yoy)}</td><td>{pct(q.opm, 1, false)}</td><td className={tone(q.pat_yoy)}>{pct(q.pat_yoy)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="head"><span className="caps">{f.lender ? "Funding" : "Balance sheet and cash"}</span><button className="tiny link" onClick={() => setHow(!how)}>{how ? "hide working" : "show working"}</button></div>
        <div className="card">
          {!f.lender && (
            <>
              <p><b className={conv !== null && conv < 0.7 ? "down" : conv !== null && conv >= 0.9 ? "up" : ""}>
                {conv === null ? "Cash conversion not computable." : `Of every ₹100 of profit in the last three years, ₹${(conv * 100).toFixed(0)} arrived as operating cash.`}</b>
                {n(m.fcf_3y) !== null && <> Free cash flow over the same years: ₹{crore(n(m.fcf_3y))}.</>}</p>
              <p className="muted" style={{ marginTop: 8 }}>
                Cash is tied up for <b style={{ color: "var(--ink)" }}>{num(n(m.cycle_days))} days</b> between paying suppliers and collecting from customers
                {n(m.cycle_change_3y) !== null && <>, {n(m.cycle_change_3y)! >= 0 ? "up" : "down"} {Math.abs(n(m.cycle_change_3y)!).toFixed(0)} days in three years</>}
                {" "}(receivables {num(last.debtor_days)} + inventory {num(last.inventory_days)} − payables {num(last.payable_days)}).
              </p>
              <div className="caps" style={{ marginTop: 14 }}>Operating cash by year · ₹ cr</div>
              <Bars rows={rows} pick={(r) => r.cfo} />
            </>
          )}
          <table className="rt">
            <thead><tr><th>Year</th><th>Borrowings</th><th>Net worth</th><th>D/E</th><th>ROE</th></tr></thead>
            <tbody>{f.annual.slice(-4).reverse().map((r) => (
              <tr key={r.fy}><td>{r.fy}</td><td>{num(r.debt)}</td><td>{num(r.net_worth)}</td><td className="v">{r.de !== null ? `${r.de.toFixed(2)}×` : "–"}</td><td>{pct(r.roe, 1, false)}</td></tr>
            ))}</tbody>
          </table>
          {n(m.promoter) !== null && <p className="small muted" style={{ marginTop: 10 }}>Promoters hold {n(m.promoter)!.toFixed(1)}%{n(m.promoter_change) ? <>, {n(m.promoter_change)! > 0 ? "up" : "down"} {Math.abs(n(m.promoter_change)!).toFixed(1)} points ({String(m.promoter_span)})</> : null}.</p>}
          {how && <div className="note">{Object.entries(f.formulas).filter(([k]) => !f.lender || !/days|cash|net_debt|roce/.test(k)).map(([k, v]) => <div key={k}><b>{k.replace(/_/g, " ")}</b> = {v}</div>)}</div>}
        </div>
      </section>

      {a && a.promised_vs_delivered.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps" style={{ color: "var(--matter)" }}>Promised vs delivered</span>
            <span className="row">{Object.entries(a.scorecard).map(([k, v]) => <span key={k} className={`verdict ${k}`}>{v} {k.replace("_", " ")}</span>)}</span></div>
          <div className="card">
            {a.promised_vs_delivered.map((x) => (
              <div className="item" key={x.commitment_id}>
                <div className="row between" style={{ alignItems: "flex-start" }}><b className="grow">{x.promised}</b><span className={`verdict ${x.verdict}`}>{x.verdict.replace("_", " ")}</span></div>
                <p className="muted" style={{ marginTop: 5 }}>{x.delivered}<Src ids={x.sources} d={d} />{x.by === "code" && <span className="src" title="Verdict computed from reported numbers, not judged by a model">computed</span>}</p>
                <button className="tiny link" style={{ marginTop: 6 }} onClick={() => setQuote(quote === x.commitment_id ? null : x.commitment_id)}>{quote === x.commitment_id ? "hide" : "their words"}</button>
                {quote === x.commitment_id && <p className="quote">“{x.quote}”</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {a && a.guidance_drift.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps">How guidance moved</span></div>
          <div className="card">{a.guidance_drift.map((g, i) => (
            <div className="item" key={i}><div className="row between"><b>{g.metric}</b><span className={`verdict ${g.direction === "raised" ? "met" : g.direction === "lowered" ? "missed" : ""}`}>{g.direction}</span></div>
              <p className="muted small" style={{ marginTop: 4 }}>{g.path}<Src ids={g.sources} d={d} /></p></div>))}</div>
        </section>
      )}

      {a && a.narrative_vs_numbers.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps">Story vs numbers</span></div>
          <div className="card">{a.narrative_vs_numbers.map((x, i) => (
            <div className="item" key={i}>
              <div className="row between" style={{ alignItems: "flex-start" }}><span className="grow"><span className="caps">They say</span><br />{x.story}</span><span className={`verdict ${x.verdict}`}>{x.verdict}</span></div>
              <p style={{ marginTop: 6 }}><span className="caps">Numbers say</span><br />{x.numbers}<Src ids={x.sources} d={d} /></p>
            </div>))}</div>
        </section>
      )}

      {a && (
        <section className="section">
          <Points title="Bull" items={a.bull} d={d} color="var(--up)" />
          <Points title="Bear" items={a.bear} d={d} color="var(--down)" />
          <Points title="Check next quarter" items={a.watch} d={d} />
        </section>
      )}

      {d.annual?.ok && d.annual.risks && d.annual.risks.length > 0 && (
        <section className="section"><div className="head"><span className="caps">Risks the company names itself</span><Src ids={["AR"]} d={d} /></div>
          <div className="card">{d.annual.risks.map((r) => <p key={r.risk} className="small" style={{ marginTop: 5 }}>{r.risk} <span className="faint">p.{r.page}</span></p>)}</div></section>
      )}

      <footer className="section tiny faint" style={{ lineHeight: 1.6 }}>
        Sources: {Object.entries(d.sources).map(([id, s], i) => <span key={id}>{i ? " · " : ""}<a className="link" href={s.url} target="_blank" rel="noreferrer">{id} {s.label}</a></span>)}.
        Ratios are computed in code from reported lines. Statements about management come only from the transcripts and annual report cited; every quoted sentence was checked to exist in its document
        {d.call_extracts ? ` (${d.call_extracts.reduce((s, c) => s + (c.dropped ?? 0), 0)} extracted items failed that check and were dropped)` : ""}. No news, broker research or outside knowledge.
      </footer>
    </>
  );
}
