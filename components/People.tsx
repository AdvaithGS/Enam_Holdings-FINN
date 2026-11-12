"use client";
import { ago, monthYear } from "@/lib/client/format";
import { type Lead, monthsSince, type Reach, strengthWord } from "@/lib/network/graph.ts";
import type { Person } from "@/lib/network/types.ts";
import { useStore } from "@/lib/client/store";
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

/** The line every card ends with: who you know that can explain this. */
export function LeadLine({ lead, verb = "Call" }: { lead: Lead; verb?: string }) {
  const open = useOpenPerson();
  return (
    <button className="who" onClick={() => open(lead.person.id)}>
      <Avatar person={lead.person} />
      <span className="grow">
        <span className="name">{verb} {lead.person.name}</span>
        <span className="why" style={{ display: "block" }}>{lead.why}</span>
        <span className="meta" style={{ display: "block" }}>
          <Meter value={lead.tie} label="tie" /> {strengthWord(lead.tie)} tie · <TieLine person={lead.person} />
        </span>
        {lead.insider && <span className="caution" style={{ display: "block" }}>Works there now. Ask for context, never for unpublished numbers.</span>}
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
        <Meter value={reach.strength} label="route" /> {strengthWord(reach.strength)} route
        {reach.via && reach.hops === 2 ? <> · {(reach.link * 100).toFixed(0)}% likely they worked together · your tie {strengthWord(reach.tie)}</> : null}
      </div>
    </div>
  );
}
