"use client";
import Link from "next/link";
import { day } from "@/lib/client/format";
import { useStore } from "@/lib/client/store";
import { strengthWord, tieStrength } from "@/lib/network/graph.ts";
import type { Person } from "@/lib/network/types.ts";
import { Avatar, Meter, ReachPath, TieLine } from "./People";
import { Sheet } from "./Shell";

export function usePerson(id: string): Person | null {
  const { net, publicPeople } = useStore();
  return net?.contacts.find((c) => c.id === id) ?? publicPeople.find((p) => p.id === id) ?? null;
}

export function PersonSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const person = usePerson(id);
  const { graph, digest, net } = useStore();
  if (!person || !graph || !digest || !net) return null;
  const roles = [...person.roles].sort((a, b) => (b.to ?? 9999) - (a.to ?? 9999) || b.from - a.from);
  const tickers = new Map<string, string>();
  for (const r of person.roles) { const t = graph.orgs.get(r.org)?.ticker; if (t && digest.companies[t]) tickers.set(r.org, t); }
  // what this person can speak to in the portfolio, beyond the companies they worked at
  const angles = new Map<string, string>();
  for (const sym of Object.keys(digest.companies)) {
    const target = graph.orgId(sym);
    if (!target) continue;
    for (const r of person.roles) {
      const rel = graph.relation(r.org, target);
      if (rel && rel.w >= 0.5 && !angles.has(sym)) angles.set(sym, rel.label === "inside" ? (r.to === null ? "works there" : "worked there") : `${rel.label} view, from ${graph.orgName(r.org)}`);
    }
  }
  const news = digest.events.filter((e) => e.tier !== "aside" && [...tickers.values()].includes(e.symbol)).slice(0, 3);
  const reach = person.tie ? [] : graph.reach(person).slice(0, 3);
  const tie = tieStrength(person, graph.now);
  return (
    <Sheet onClose={onClose}>
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <Avatar person={person} lg />
        <div className="grow">
          <h2 style={{ font: "600 21px/1.2 var(--serif)" }}>{person.name}</h2>
          <div className="muted small">{person.headline}{person.city ? ` · ${person.city}` : ""}</div>
        </div>
      </div>
      {person.tie ? (
        <div className="who" style={{ display: "block" }}>
          <div className="meta" style={{ marginTop: 0 }}><Meter value={tie} label="tie" /> <b style={{ color: "var(--people)" }}>{strengthWord(tie)} tie</b> · <TieLine person={person} /></div>
          <div className="why" style={{ marginTop: 5 }}>{person.tie.how}, {person.tie.since}.</div>
          {person.tie.note && <div className="why" style={{ marginTop: 4 }}>{person.tie.note}</div>}
        </div>
      ) : (
        <>
          <div className="caps" style={{ marginTop: 18 }}>How you reach them</div>
          {reach.length ? reach.map((r, i) => <ReachPath key={i} reach={r} target={person} />)
            : <p className="muted small" style={{ marginTop: 6 }}>No one in your network has overlapped with {person.name.split(" ")[0]} at any organisation or school the filings name.</p>}
          {reach.length > 0 && reach[0].why.length > 1 && (
            <><div className="caps" style={{ marginTop: 16 }}>Worth asking about</div>
              {reach.flatMap((r) => r.why).filter((w, i, a) => a.indexOf(w) === i).slice(0, 4).map((w) => <p key={w} className="small muted" style={{ marginTop: 5 }}>{w}</p>)}</>
          )}
        </>
      )}
      <div className="caps" style={{ marginTop: 18 }}>Career</div>
      <div className="tl">
        {roles.map((r, i) => (
          <div key={i} style={{ display: "contents" }}>
            <span className="y">{r.from > 0 ? `${r.from}–${r.to === null ? "now" : String(r.to).slice(2)}` : r.to === null ? "now" : r.to ? `to ${r.to}` : "earlier"}</span>
            <span>{r.title}, <b>{graph.orgName(r.org.startsWith("x:") ? r.org.slice(2) : r.org)}</b>{tickers.has(r.org) && <span className="src">{tickers.get(r.org)}</span>}</span>
          </div>
        ))}
        {person.education.map((e, i) => (
          <div key={`e${i}`} style={{ display: "contents" }}>
            <span className="y">{e.to || ""}</span><span className="muted">{e.degree ? `${e.degree}, ` : ""}{e.school}</span>
          </div>
        ))}
      </div>
      {person.tie && angles.size > 0 && (
        <><div className="caps" style={{ marginTop: 18 }}>Can speak to</div>
          <div className="tags">{[...angles].slice(0, 8).map(([sym, how]) => <Link key={sym} href={`/research/${sym}`} onClick={onClose} className="tag"><b>{sym}</b> · {how}</Link>)}</div></>
      )}
      {news.length > 0 && (
        <><div className="caps" style={{ marginTop: 18 }}>A reason to talk</div>
          {news.map((e) => <p key={e.id} className="small" style={{ marginTop: 6 }}><span className="tick">{e.symbol}</span> {e.title} <span className="faint">· {day(e.at)}</span></p>)}</>
      )}
      <p className="tiny faint" style={{ marginTop: 18 }}>
        {person.tie ? (net.synthetic ? "Synthetic demo contact. Held on this device only." : "Held on this device only.")
          : <>Public record: {person.source?.url ? <a className="link" href={person.source.url} target="_blank" rel="noreferrer">{person.source.label}</a> : person.source?.label}</>}
      </p>
    </Sheet>
  );
}
