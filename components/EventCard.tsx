"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { crore, day, dayTime, num, pct, signed, tone } from "@/lib/client/format";
import { personKey, useStore } from "@/lib/client/store";
import { FIT } from "@/lib/network/graph.ts";
import type { FinnEvent, ResultsCard } from "@/lib/types";
import { LeadLine, ReachPath } from "./People";
import { N } from "./Viz";
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

export function Results({ card }: { card: ResultsCard }) {
  return (
    <>
      <table className="rt">
        <thead><tr><th>₹ crore</th><th>{card.period}</th><th>QoQ</th><th>YoY</th></tr></thead>
        <tbody>
          {card.rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="v"><N href={card.source} how="Read from this quarter's XBRL filing">{num(r.value)}</N>{r.margin !== undefined && <span className="m">{(r.margin * 100).toFixed(1)}% margin</span>}</td>
              <td className={tone(r.qoq)}><N href={card.sources?.prev} how="Against the previous quarter's own filing">{signed(r.qoq, 0)}</N>{r.margin !== undefined && r.margin_prev !== undefined && <span className="m">{((r.margin - r.margin_prev) * 1e4).toFixed(0)} bp</span>}</td>
              <td className={tone(r.yoy)}><N href={card.sources?.year} how="Against the same quarter last year, from that quarter's own filing">{signed(r.yoy, 0)}</N>{r.margin !== undefined && r.margin_year !== undefined && <span className="m">{((r.margin - r.margin_year) * 1e4).toFixed(0)} bp</span>}</td>
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

/** Who changed, where they came from, and how you reach them. Used on full cards and glance rows alike. */
export function PeopleBlocks({ reaches }: { reaches: ReturnType<typeof useEventPeople>["reaches"] }) {
  const open = useOpenPerson();
  return (
    <>
      {reaches.map(({ fp, person, routes }) => (
        <div className="person" key={person.id}>
          <button className="row" onClick={() => open(person.id)} style={{ width: "100%" }}>
            <span className="avatar pub">{fp.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
            <span className="grow"><b>{fp.name}</b><span className="muted small" style={{ display: "block" }}>{fp.action} · {fp.role}{fp.effective ? ` · ${fp.effective}` : ""}</span></span>
          </button>
          {fp.bio && <p className="bio">{fp.bio}</p>}
          {(fp.career?.length || fp.education?.length) ? (
            <p className="small muted" style={{ marginTop: 4 }}>
              {fp.career?.length ? <>Previously: {fp.career.slice(0, 6).map((c) => `${c.org}${c.from_year ? ` (${c.from_year}\u2013${c.to_year ?? ""})` : ""}`).join(", ")}. </> : null}
              {fp.education?.length ? <>Studied at {fp.education.slice(0, 3).map((s) => s.school).join(", ")}. </> : null}
              {fp.profile_url ? <a className="link" href={fp.profile_url} target="_blank" rel="noreferrer">Profile letter</a> : null}
            </p>
          ) : null}
          {routes.length ? routes.map((r, i) => <ReachPath key={i} reach={r} target={person} />)
            : fp.tier <= 2 && <p className="small faint" style={{ marginTop: 8 }}>No route to {fp.name.split(" ")[0]} in your network yet.</p>}
        </div>
      ))}
    </>
  );
}

