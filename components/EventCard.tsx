"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { crore, day, dayTime, num, pct, tone } from "@/lib/client/format";
import { personKey, useStore } from "@/lib/client/store";
import { FIT } from "@/lib/network/graph.ts";
import type { FinnEvent, ResultsCard } from "@/lib/types";
import { LeadLine, ReachPath } from "./People";
import { useOpenPerson } from "./Shell";

/** Everything the network has to say about one event. */
export function useEventPeople(e: FinnEvent) {
  const { graph, publicPeople } = useStore();
  return useMemo(() => {
    if (!graph) return { leads: [], reaches: [], other: [] };
    const org = graph.orgId(e.symbol);
    const leads = org ? graph.whoToCall(org, FIT[e.category] ?? [], 2).filter((l) => l.score >= 0.1 && l.knowledge >= 0.3) : [];
    const cp = graph.orgId(e.counterparty);
    const other = cp && cp !== org ? graph.whoToCall(cp, FIT[e.category] ?? [], 1).filter((l) => l.score >= 0.1 && l.relation === "inside") : [];
    const reaches = (e.people ?? []).filter((p) => p.action !== "reappointed" && p.tier <= 3).map((fp) => {
      const person = publicPeople.find((x) => x.id === personKey(fp));
      return person ? { fp, person, routes: graph.reach(person).slice(0, 1) } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    return { leads, reaches, other };
  }, [graph, publicPeople, e]);
}

function Results({ card }: { card: ResultsCard }) {
  return (
    <>
      <table className="rt">
        <thead><tr><th>₹ crore</th><th>{card.period}</th><th>QoQ</th><th>YoY</th></tr></thead>
        <tbody>
          {card.rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="v">{num(r.value)}{r.margin !== undefined && <span className="m">{(r.margin * 100).toFixed(1)}% margin</span>}</td>
              <td className={tone(r.qoq)}>{pct(r.qoq)}{r.margin !== undefined && r.margin_prev !== undefined && <span className="m">{((r.margin - r.margin_prev) * 1e4).toFixed(0)} bp</span>}</td>
              <td className={tone(r.yoy)}>{pct(r.yoy)}{r.margin !== undefined && r.margin_year !== undefined && <span className="m">{((r.margin - r.margin_year) * 1e4).toFixed(0)} bp</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <a className="proof" href={card.source} target="_blank" rel="noreferrer">
        <i className={card.checks_ok ? "ok" : "bad"} />
        {card.checks_ok ? `Read from the company's XBRL filing; ${card.checks.length} of ${card.checks.length} accounting identities hold`
          : `Unverified: ${card.checks.filter((c) => !c.ok).length} accounting identity does not hold in the filing`}
        {` · ${card.basis}`}
      </a>
      {card.notes.map((n) => <p key={n} className="small muted" style={{ marginTop: 5 }}>{n}</p>)}
    </>
  );
}

export function ActCard({ e }: { e: FinnEvent }) {
  const { digest } = useStore();
  const [why, setWhy] = useState(false);
  const open = useOpenPerson();
  const { leads, reaches, other } = useEventPeople(e);
  const co = digest?.companies[e.symbol];
  const logOdds = (p: number) => Math.log(p / (1 - p));
  return (
    <article className="card act" id={e.id}>
      <div className="row between">
        <div className="row"><Link href={`/research/${e.symbol}`} className="tick">{e.symbol}</Link><span className="caps">{e.label}</span></div>
        <span className="tiny faint">{dayTime(e.at)}</span>
      </div>
      <h3 className="title">{e.results ? `${co?.name ?? e.symbol}, ${e.title}` : e.title}</h3>
      {e.summary && <p className="summary">{e.summary}</p>}
      {e.results && <Results card={e.results} />}
      {e.amount && (
        <div style={{ marginTop: 12 }}>
          <div className="row between small"><span>₹{crore(e.amount.cr)}</span><span className="muted">{e.amount.rho >= 10 ? e.amount.rho.toFixed(0) : e.amount.rho.toFixed(1)}× the materiality line</span></div>
          <div className="rho" title={`SEBI line ₹${crore(e.amount.line_cr)} (${e.amount.leg})`}>
            <i style={{ width: `${Math.min(100, (Math.log10(Math.max(e.amount.rho, 0.1)) + 1) / 3 * 100)}%` }} /><b style={{ left: "33.3%" }} />
          </div>
          {e.amount.mcap_share !== undefined && (
            <p className="tiny faint" style={{ marginTop: 6 }}>
              {pct(e.amount.mcap_share, e.amount.mcap_share < 0.01 ? 2 : 1, false)} of market value{e.amount.cfo_years !== undefined ? ` · ${e.amount.cfo_years.toFixed(1)} years of operating cash flow` : ""}
            </p>
          )}
        </div>
      )}
      {e.intraday && (
        <p className="small muted" style={{ marginTop: 10 }}>
          Filed {e.intraday.at}: <b className={`num ${tone(e.intraday.shock)}`}>{pct(e.intraday.shock, 2)}</b> in the next {e.intraday.minutes} minutes
          {e.intraday.vol_x !== null ? ` on ${e.intraday.vol_x.toFixed(1)}× usual volume` : ""}
          {Math.min(e.intraday.p, e.intraday.p_vol) <= 0.2 ? ` · 1 in ${Math.round(1 / Math.min(e.intraday.p, e.intraday.p_vol))} half hours` : " · no reaction to speak of"}
        </p>
      )}
      {reaches.map(({ fp, person, routes }) => (
        <div className="person" key={person.id}>
          <button className="row" onClick={() => open(person.id)} style={{ width: "100%" }}>
            <span className="avatar pub">{fp.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
            <span className="grow"><b>{fp.name}</b><span className="muted small" style={{ display: "block" }}>{fp.action} · {fp.role}{fp.effective ? ` · ${fp.effective}` : ""}</span></span>
          </button>
          {fp.bio && <p className="bio">{fp.bio}</p>}
          {(fp.career?.length || fp.education?.length) ? (
            <div className="tags">
              {fp.career?.slice(0, 5).map((c, i) => <span className="tag" key={i}>{c.org}{c.from_year ? ` ${c.from_year}–${c.to_year ? String(c.to_year).slice(2) : ""}` : ""}</span>)}
              {fp.education?.slice(0, 2).map((s, i) => <span className="tag" key={`s${i}`}>{s.school}</span>)}
            </div>
          ) : null}
          {routes.length ? routes.map((r, i) => <ReachPath key={i} reach={r} target={person} />)
            : fp.tier <= 2 && <p className="small faint" style={{ marginTop: 8 }}>No route to {fp.name.split(" ")[0]} in your network yet.</p>}
        </div>
      ))}
      {leads.map((l) => <LeadLine key={l.person.id} lead={l} verb={leads[0] === l ? "Call" : "Or"} />)}
      {other.map((l) => <LeadLine key={`o${l.person.id}`} lead={l} verb="Other side:" />)}
      <div className="foot">
        <button onClick={() => setWhy(!why)} aria-expanded={why}>Why it ranks · {e.lift.toFixed(1)}× a quiet day</button>
        {e.url && <a className="link" href={e.url} target="_blank" rel="noreferrer">{e.filings.length > 1 ? `${e.filings.length} filings` : "Filing"}</a>}
      </div>
      {why && digest && (
        <div className="ev">
          <div className="line"><span className="d">{logOdds(digest.model.baseline).toFixed(1)}</span><span>Start: on a day with no filing, the market notices {pct(digest.model.baseline, 1, false)} of the time.</span></div>
          {e.evidence.map((x, i) => <div className="line" key={i}><span className="d">{x.d >= 0 ? "+" : ""}{x.d.toFixed(1)}</span><span>{x.text}</span></div>)}
          <div className="line"><span className="d">= {pct(e.p, 0, false)}</span><span>Chance this is a day that matters. The numbers on the left are log-odds; the cut-off for this list is {pct(digest.model.act, 0, false)}.</span></div>
          {e.filings.length > 1 && <div className="small" style={{ marginTop: 4 }}>{e.filings.map((f) => (
            <a key={f.id} href={f.url ?? "#"} target="_blank" rel="noreferrer" className="aside"><span className="grow clip">{f.title}</span><span className="faint">{day(f.at)}</span></a>))}</div>}
        </div>
      )}
    </article>
  );
}

export function GlanceRow({ e }: { e: FinnEvent }) {
  const { leads, reaches } = useEventPeople(e);
  const [open, setOpen] = useState(false);
  const known = leads.length > 0 || reaches.some((r) => r.routes.length);
  return (
    <>
      <button className="glance" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tick">{e.symbol}</span>
        <span className="t">{e.title}<span className="faint"> · {e.label.toLowerCase()} · {day(e.at)}</span></span>
        {known ? <span className="pp" title="Someone you know can explain this" /> : <span />}
      </button>
      {open && (
        <div style={{ paddingBottom: 12 }}>
          {e.summary && <p className="small muted">{e.summary}</p>}
          {e.evidence.slice(1).map((x, i) => <p key={i} className="small muted" style={{ marginTop: 4 }}>{x.text}</p>)}
          {leads.slice(0, 1).map((l) => <LeadLine key={l.person.id} lead={l} />)}
          <p className="small" style={{ marginTop: 8 }}>
            {e.url && <a className="link" href={e.url} target="_blank" rel="noreferrer">Open filing</a>} <span className="faint">· {e.lift.toFixed(1)}× a quiet day</span>
          </p>
        </div>
      )}
    </>
  );
}
