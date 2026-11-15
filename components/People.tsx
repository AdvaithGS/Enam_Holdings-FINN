"use client";
import { ago, monthYear } from "@/lib/client/format";
import { useEffect } from "react";
import { type Lead, monthsSince, pctRange, type Reach, strengthWord } from "@/lib/network/graph.ts";
import type { Person } from "@/lib/network/types.ts";
import { logSuggestion, useStore } from "@/lib/client/store";
import { useOpenPerson } from "./Shell";

export const initials = (name: string) => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export function Avatar({ person, lg }: { person: Person; lg?: boolean }) {
  return <span className={`avatar ${person.tie ? "" : "pub"} ${lg ? "lg" : ""}`} aria-hidden>{initials(person.name)}</span>;
}

/** Four bars for a probability: each bar is a quarter. */
export function Meter({ value, label }: { value: number; label?: string }) {
  const n = Math.max(1, Math.min(4, Math.ceil(value * 4)));
  return (
    <span className="meter" title={`${label ?? ""} ${(value * 100).toFixed(0)}%`} aria-label={`${label ?? "strength"} ${(value * 100).toFixed(0)} percent`}>
      {[1, 2, 3, 4].map((i) => <i key={i} className={i <= n ? "f" : ""} />)}
    </span>
  );
}

export function TieLine({ person }: { person: Person }) {
  const { graph } = useStore();
  if (!person.tie || !graph) return null;
  const m = monthsSince(person.tie.last, graph.now);
  return <>last spoke {monthYear(person.tie.last)}{m >= 9 ? ` (${ago(m)})` : ""}</>;
}

/**
 * The line every card ends with: someone you know who can explain the public context.
 * The wording is deliberate. FINN never proposes asking anyone for information that is not
 * public, and during a company's results quiet period it does not put forward a person who
 * works there at all. Each suggestion shown is written to the on-device log.
 */
export function LeadLine({ lead, verb, about }: { lead: Lead; verb?: string; about?: string }) {
  const open = useOpenPerson();
  const { graph, digest } = useStore();
  const ticker = lead.target ? graph?.orgs.get(lead.target)?.ticker : undefined;
  const quiet = ticker ? digest?.companies[ticker]?.quiet : undefined;
  const blocked = lead.insider && !!quiet?.now;
  const subject = about ?? (ticker ? `${ticker}` : lead.target ?? "");
  useEffect(() => {
    if (!blocked) logSuggestion({ person: lead.person.id, name: lead.person.name, about: subject, why: lead.why, insider: lead.insider });
  }, [blocked, lead.person.id, lead.person.name, subject, lead.why, lead.insider]);
  if (blocked) {
    return (
      <div className="who" style={{ background: "var(--wash)" }}>
        <span className="avatar pub" aria-hidden>{initials(lead.person.name)}</span>
        <span className="grow">
          <span className="why" style={{ display: "block" }}><b>{lead.person.name}</b> works there now.</span>
          <span className="caution" style={{ display: "block" }}>Not suggested: {ticker} is in its results quiet period{quiet?.until ? ` until ${quiet.until.slice(0, 10)}` : " until results are out"}.</span>
        </span>
      </div>
    );
  }
  return (
    <button className="who" onClick={() => open(lead.person.id)}>
      <Avatar person={lead.person} />
      <span className="grow">
        <span className="name">{verb?.startsWith("Other") ? "On the other side: " : ""}{lead.person.name}</span>
        <span className="why" style={{ display: "block" }}>can explain the public context. {lead.why}</span>
        <span className="meta" style={{ display: "block" }}>
          <Meter value={lead.tie} label="tie" /> {strengthWord(lead.tie)} tie · <TieLine person={lead.person} />
        </span>
        {lead.insider && <span className="caution" style={{ display: "block" }}>Works there now. Public context only; never unpublished information.</span>}
      </span>
    </button>
  );
}

export function ReachPath({ reach, target }: { reach: Reach; target: Person }) {
  const open = useOpenPerson();
  return (
    <div className="who" style={{ display: "block" }}>
      <div className="path">
        <span className="node me">You</span>
        {reach.via && <>
          <span className={`edge ${reach.tie < 0.25 ? "thin" : ""}`} />
          <button className="node c" onClick={() => open(reach.via!.id)}>{reach.via.name}</button>
        </>}
        {reach.hops === 2 || !reach.via ? <>
          <span className={`edge ${reach.link < 0.4 ? "thin" : ""}`} />
          <span className="node">{target.name}</span>
        </> : null}
      </div>
      <div className="why" style={{ marginTop: 7 }}>{reach.why[0]}</div>
      <div className="meta">
        <Meter value={reach.hi} label="route" /> route {pctRange(reach.lo, reach.hi)} likely to work
        {reach.via && reach.hops === 2 ? <> · {pctRange(reach.linkLo, reach.linkHi)} that they know each other · your tie {strengthWord(reach.tie)}</> : null}
      </div>
    </div>
  );
}
