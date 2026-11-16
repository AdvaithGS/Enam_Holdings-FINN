"use client";
import { useMemo } from "react";
import { crore, day, dayTime, num, oneIn, pct, signed, tone } from "@/lib/client/format";
import { useStore } from "@/lib/client/store";
import { FIT, pctRange } from "@/lib/network/graph.ts";
import type { Digest, FinnEvent } from "@/lib/types";
import { PeopleBlocks, Results, useEventPeople } from "./EventCard";
import { type Move, MoveChart } from "./Moves";
import { LeadLine } from "./People";
import { Detail } from "./Shell";
import { Decomp, Icon, N, Rarity } from "./Viz";

const BETA = "Market share = this stock's beta (exponentially weighted, 90-session half-life) x the NIFTY's move. Sector share = its loading on the first principal component of its peers' market-adjusted returns, fitted on the 250 sessions before the window. Own = what is left.";
const RARE = "Share of this stock's last 500 sessions with a market-adjusted move (in units of that day's GARCH volatility) or a volume, net of the market's, at least this large.";

export function partsOf(digest: Digest, symbol: string, session: string, change?: number | null, abnormal?: number | null) {
  const p = digest.moves?.[symbol]?.[session]?.parts;
  if (p) return p;
  return change != null && abnormal != null ? { market: change - abnormal, own: abnormal } : null;
}
const rarityOf = (e: FinnEvent) => { const ps = [e.market?.p_ret, e.market?.p_vol].filter((x): x is number => x != null); return ps.length ? Math.min(...ps) : null; };

/** The one-line fact that sizes an event: its numbers, not its adjectives. */
function keyLine(e: FinnEvent): React.ReactNode {
  if (e.results) {
    const r = (k: string) => e.results!.rows.find((x) => x.key === k);
    const rev = r("revenue"), pat = r("pat");
    return <>Revenue <b>₹{crore(rev?.value)}</b> <span className={tone(rev?.yoy)}>{signed(rev?.yoy, 0)}</span> · PAT <b>₹{crore(pat?.value)}</b> <span className={tone(pat?.yoy)}>{signed(pat?.yoy, 0)}</span> on last year</>;
  }
  if (e.amount) return <><b>₹{crore(e.amount.cr)}</b> · <span className={e.amount.rho >= 1 ? "al" : ""} style={e.amount.rho >= 1 ? { color: "var(--alert)", fontWeight: 600 } : undefined}>{e.amount.rho >= 10 ? e.amount.rho.toFixed(0) : e.amount.rho.toFixed(1)}× the materiality line</span></>;
  return e.summary;
}

/** The one number that sizes an event, and what it is. */
export function bigOf(e: FinnEvent): { v: string; cls: string; what: string } {
  const pat = e.results?.rows.find((x) => x.key === "pat");
  if (pat?.yoy != null) return { v: `${pat.yoy >= 0 ? "▲" : "▼"} ${signed(pat.yoy, 0)}`, cls: tone(pat.yoy), what: "PAT on last year" };
  if (e.amount) return { v: `${e.amount.rho >= 10 ? e.amount.rho.toFixed(0) : e.amount.rho.toFixed(1)}×`, cls: e.amount.rho >= 1 ? "al" : "", what: "the materiality line" };
  if (e.market?.abnormal != null) return { v: `${e.market.abnormal >= 0 ? "▲" : "▼"} ${signed(e.market.abnormal)}`, cls: tone(e.market.abnormal), what: "the stock's own move" };
  return { v: pct(e.p, 0, false), cls: "", what: "chance it matters" };
}

/** An item that needs the investor: icon, ticker, one number, one picture. The words are in the card. */
export function NeedRow({ e, selected, onSelect }: { e: FinnEvent; selected: boolean; onSelect: () => void }) {
  const { digest } = useStore();
  const { leads, reaches } = useEventPeople(e);
  const parts = digest ? partsOf(digest, e.symbol, e.session, e.market?.change, e.market?.abnormal) : null;
  const route = reaches.find((r) => r.routes.length), big = bigOf(e), who = route?.routes[0].via?.name ?? leads[0]?.person.name;
  return (
    <>
      <button className="vrow" aria-current={selected} onClick={onSelect} aria-label={`${e.symbol}, ${e.label}: ${e.title}. ${big.v} ${big.what}`}>
        <Icon kind={e.category} label={e.label} />
        <span><b>{e.symbol}</b><br /><span className={`bign ${big.cls}`} style={big.cls === "al" ? { color: "var(--alert)" } : undefined} title={big.what}>{big.v}</span></span>
        {parts ? <Decomp market={parts.market} sector={parts.sector} own={parts.own} labels={false} /> : <span className="tiny" style={{ textAlign: "right" }}>{big.what}</span>}
        <span className="t">{e.title}{who && <span className="pname"> · {who}</span>}</span>
      </button>
      {selected && <Detail><EventDetail e={e} /></Detail>}
    </>
  );
}

/** Worth a glance: one line. */
export function GlanceLine({ e, selected, onSelect }: { e: FinnEvent; selected: boolean; onSelect: () => void }) {
  const { leads, reaches } = useEventPeople(e);
  const who = reaches.find((r) => r.routes.length)?.routes[0].via?.name ?? leads[0]?.person.name;
  return (
    <>
      <button className="one" aria-current={selected} onClick={onSelect}>
        <span className="row" style={{ gap: 6 }}><Icon kind={e.category} label={e.label} /><b style={{ font: "var(--d)", fontWeight: 600 }}>{e.symbol}</b></span>
        <span>{e.title}{who && <span className="pname" style={{ font: "var(--d)", fontWeight: 600 }}> · {who}</span>}</span>
        <span className="d">{day(e.at).slice(0, 5)}</span>
      </button>
      {selected && <Detail><EventDetail e={e} /></Detail>}
    </>
  );
}

/** Everything behind one event: the numbers with their sources, why it ranks, who can explain it. */
export function EventDetail({ e }: { e: FinnEvent }) {
  const { digest } = useStore();
  const { leads, reaches, other } = useEventPeople(e);
  if (!digest) return null;
  const parts = partsOf(digest, e.symbol, e.session, e.market?.change, e.market?.abnormal), p = rarityOf(e);
  const lo = (x: number) => Math.log(x / (1 - x));
  return (
    <>
      <div className="meta1" style={{ display: "flex", gap: 8, font: "var(--d)", color: "var(--ink-3)" }}><b style={{ color: "var(--ink)" }}>{e.symbol}</b><span>{e.label}</span><span>{dayTime(e.at)}</span></div>
      <h2>{e.results ? `${digest.companies[e.symbol]?.name ?? e.symbol}, ${e.title}` : e.title}</h2>
      {e.summary && <p className="muted">{e.summary}</p>}
      {e.results && <Results card={e.results} />}
      {e.amount && <p style={{ marginTop: 10 }}><N href={e.url} how={`Stated in the filing: “${e.amount.quote}”`}>₹{crore(e.amount.cr)}</N> is{" "}
        <N how={`Amount ÷ this company's SEBI materiality line of ₹${crore(e.amount.line_cr)} (${e.amount.leg}; Regulation 30(4)(i)(c)). 1× is the regulator's own definition of material.`}>{e.amount.rho >= 10 ? e.amount.rho.toFixed(0) : e.amount.rho.toFixed(2)}×</N> the materiality line.</p>}

      {parts && e.market?.change != null && <>
        <div className="sub">The stock that session: <span className={tone(e.market.change)}>{signed(e.market.change)}</span></div>
        <Decomp market={parts.market} sector={parts.sector} own={parts.own} />
        <p className="small muted" style={{ marginTop: 6 }}>{p !== null && <Rarity p={p} />}{e.market.vol_ratio != null && <> · {e.market.vol_ratio.toFixed(1)}× its usual volume</>} · <N how={BETA}>how this is split</N> · <N how={RARE}>how rarity is measured</N></p>
      </>}
      {e.intraday && <p className="small muted" style={{ marginTop: 6 }}>Filed {e.intraday.at}. Next {e.intraday.minutes} minutes: <b className={tone(e.intraday.shock)}>{signed(e.intraday.shock, 2)}</b> volume-weighted
        {e.intraday.vol_x !== null ? `, ${e.intraday.vol_x.toFixed(1)}× the usual volume for that time` : ""} · <N how={`VWAP of the 30 minutes after ÷ VWAP of the session before the filing, ranked against ${e.intraday.n} half-hours at the same time of day.`}>{oneIn(Math.min(e.intraday.p, e.intraday.p_vol))} half-hours</N></p>}

      <PeopleBlocks reaches={reaches} />
      {leads.map((l) => <LeadLine key={l.person.id} lead={l} about={`${e.symbol}: ${e.title}`} />)}
      {other.map((l) => <LeadLine key={`o${l.person.id}`} lead={l} verb="Other side:" about={`${e.symbol}: ${e.title}`} />)}

      <div className="sub">Why it ranks here: <N how={`Logistic of the sum on the left. The cut-off for "needs you" is ${pct(digest.model.act, 0, false)}, three times the no-filing baseline of ${pct(digest.model.baseline, 1, false)}.`}>{pct(e.p, 0, false)}</N> chance this is a day that matters</div>
      <div className="kv">
        <span className="k">{lo(digest.model.baseline).toFixed(1).replace("-", "\u2212")}</span><span className="v">A day with no filing: the market notices {pct(digest.model.baseline, 1, false)} of them ({digest.model.sessions.toLocaleString("en-IN")} stock-sessions).</span>
        {e.evidence.map((x, i) => <span key={i} style={{ display: "contents" }}><span className="k">{x.d >= 0 ? "+" : "−"}{Math.abs(x.d).toFixed(1)}</span><span className="v">{x.text}</span></span>)}
      </div>

      <div className="sub">{e.filings.length === 1 ? "The filing" : `${e.filings.length} filings in this event`}</div>
      {e.filings.map((f) => <a key={f.id} className="one" href={f.url ?? "#"} target="_blank" rel="noreferrer" style={{ gridTemplateColumns: "1fr auto", font: "var(--d)" }}><span>{f.title}</span><span className="d">{dayTime(f.at)}</span></a>)}
    </>
  );
}

/** An unusual move: ticker, the move, and what it was made of. */
export function MoveRow({ m, selected, onSelect, scale }: { m: Move; selected: boolean; onSelect: () => void; scale: number }) {
  const parts = m.note?.parts ?? (m.abnormal != null ? { market: m.change - m.abnormal, own: m.abnormal } : null);
  return (
    <>
      <button className="vrow" aria-current={selected} onClick={onSelect} aria-label={`${m.symbol} moved ${signed(m.change)} on ${day(m.date)}`}>
        <Icon kind="move" label="Unusual move" />
        <span><b>{m.symbol}</b><br /><span className={`bign ${tone(m.change)}`}>{m.change >= 0 ? "▲" : "▼"} {signed(m.change)}</span></span>
        <span>{parts && <Decomp market={parts.market} sector={parts.sector} own={parts.own} scale={scale} labels={false} />}{m.p !== null && <Rarity p={m.p} width={96} />}</span>
      </button>
      {selected && <Detail><MoveDetail m={m} /></Detail>}
    </>
  );
}

export function MoveDetail({ m }: { m: Move }) {
  const { graph } = useStore();
  const parts = m.note?.parts ?? (m.abnormal != null ? { market: m.change - m.abnormal, own: m.abnormal } : null);
  const why = m.event ? [] : m.note?.why ?? [];
  // route the move to the contact who fits its explanation; a market-wide day is nobody's to explain
  const lead = useMemo(() => {
    if (!graph || m.event || !m.note) return null;
    const org = graph.orgId(m.symbol), kind = m.note.why[0]?.k;
    if (!org || kind === "market" || kind === "breadth") return null;
    if (kind === "sector") {
      const peers = new Set((m.note.parts?.sector_peers ?? []).map((p) => graph.orgId(p)).filter(Boolean));
      const at = graph.whoToCall(org, [], 6).find((l) => l.person.roles.some((r) => peers.has(r.org) && (r.to === null || r.to >= graph.now.year - 3)));
      if (at) { const r = at.person.roles.find((x) => peers.has(x.org))!; return { ...at, why: `${r.title}, ${graph.orgName(r.org)}, which moved with it.` }; }
    }
    return graph.whoToCall(org, kind === "calendar" ? FIT.results : kind === "deal" ? FIT.fund_raise : FIT.press_release, 1).find((l) => l.knowledge >= 0.3) ?? null;
  }, [graph, m]);
  return (
    <>
      <div className="meta1" style={{ display: "flex", gap: 8, font: "var(--d)", color: "var(--ink-3)" }}><b style={{ color: "var(--ink)" }}>{m.symbol}</b><span>Unusual move</span><span>{day(m.date)}</span></div>
      <h2>{m.symbol} <span className={tone(m.change)}>{signed(m.change)}</span>{m.vol != null && <> on {m.vol.toFixed(1)}× its usual volume</>}</h2>
      {parts && <><Decomp market={parts.market} sector={parts.sector} own={parts.own} />
        <p className="small muted" style={{ marginTop: 6 }}>{m.p !== null && <Rarity p={m.p} />} · <N how={BETA}>how this is split</N> · <N how={RARE}>how rarity is measured</N>{m.volMkt != null && <> · market volume that day: {m.volMkt.toFixed(1)}× its norm</>}</p></>}
      <MoveChart px={m.px} vols={m.vols} up={m.change >= 0} rarity={m.p} />
      <p className="tiny">30 sessions: price as % change from the first; bars are volume in multiples of its own 20-day average.</p>
      {m.event ? <p style={{ marginTop: 10 }}>Filed that session: <a className="link" href={`#${m.event.id}`}>{m.event.title}</a></p>
        : <><div className="sub">{m.note?.found ? "No filing that session. What the data supports" : "No filing, and no public explanation holds"}</div>
          {why.map((w, i) => <p key={i} className={i ? "small muted" : ""} style={{ marginTop: i ? 6 : 2 }}>{w.text}</p>)}
          {!m.note && <p className="small muted">Below the size the batch job examines.</p>}</>}
      {lead && <LeadLine lead={lead} about={`${m.symbol} moved ${signed(m.change)} on ${day(m.date)}`} />}
    </>
  );
}

/** When nothing needs the investor: the closest calls, and what each lacked. */
export function shortfall(e: FinnEvent, act: number): string {
  const tape = e.evidence.some((x) => x.k === "tape");
  const base = `${pct(e.p, 0, false)} against a ${pct(act, 0, false)} cut-off.`;
  if (e.amount && e.amount.rho < 1) return `${base} ₹${crore(e.amount.cr)} is ${e.amount.rho.toFixed(2)}× the materiality line, below 1×.`;
  if (e.people?.length) return `${base} A ${e.people[0].tier >= 3 ? "board-level" : "senior"} change, not one of the people who run the company or its finances.`;
  if (!e.amount) return `${base} The filing states no amount to size it${tape ? "" : ", and the stock did not react"}.`;
  return `${base} Size alone did not carry it${tape ? "" : " and the stock did not react"}.`;
}
