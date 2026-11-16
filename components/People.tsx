"use client";
import { ago, monthYear } from "@/lib/client/format";
import { useEffect } from "react";
import { type Lead, monthsSince, pctRange, type Reach, strengthWord } from "@/lib/network/graph.ts";
import type { Person } from "@/lib/network/types.ts";
import { logSuggestion, useStore } from "@/lib/client/store";
import { useOpenPerson } from "./Shell";
import { Route } from "./Viz";

export const initials = (name: string) => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/** People are shown by name, in green. No initials in circles. */
export function Avatar(_: { person: Person; lg?: boolean }) { return null; }

/** A strength, as a number. */
export function Meter({ value }: { value: number; label?: string }) {
  return <span className="num">{Math.round(value * 100)} of 100</span>;
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
        <span className="why"> can explain the public context. {lead.why}</span>
        <span className="meta" style={{ display: "block" }}>
          tie {Math.round(lead.tie * 100)} of 100 ({strengthWord(lead.tie)}) · <TieLine person={lead.person} />
        </span>
        {lead.insider && <span className="caution" style={{ display: "block" }}>Works there now. Public context only; never unpublished information.</span>}
      </span>
    </button>
  );
}

export function ReachPath({ reach, target }: { reach: Reach; target: Person }) {
  return <Route reach={reach} target={target} />;
}
