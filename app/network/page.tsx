"use client";
import { useMemo, useState } from "react";
import { Avatar, Meter, ReachPath } from "@/components/People";
import { Sheet, useOpenPerson } from "@/components/Shell";
import { ago, day } from "@/lib/client/format";
import { useStore } from "@/lib/client/store";
import { monthsSince, strengthWord, tieStrength } from "@/lib/network/graph.ts";
import type { Network } from "@/lib/network/types.ts";

export default function NetworkPage() {
  const { net, graph, digest, publicPeople, replaceNetwork, custom } = useStore();
  const open = useOpenPerson();
  const [theme, setTheme] = useState("specialty-chemicals");
  const [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState<string | null>(null);

  const noticed = useMemo(() => {
    if (!net || !graph || !digest) return [];
    // a quiet tie + fresh news at a company they know from the inside = a natural reason to call
    const out = [];
    for (const c of net.contacts) {
      const quiet = monthsSince(c.tie!.last, graph.now);
      if (quiet < 9) continue;
      for (const r of c.roles) {
        const sym = graph.orgs.get(r.org)?.ticker;
        const ev = sym && digest.events.find((e) => e.symbol === sym && e.tier === "act");
        if (ev) { out.push({ c, r, ev, quiet, weight: quiet * (r.to === null ? 1 : Math.pow(2, -(graph.now.year - r.to) / 5)) * c.tie!.closeness }); break; }
      }
    }
    return out.sort((a, b) => b.weight - a.weight).slice(0, 4);
  }, [net, graph, digest]);
  const experts = useMemo(() => (graph ? graph.expertise(theme, 5) : []), [graph, theme]);
  const themes = useMemo(() => (net && graph ? net.themes.filter((t) => graph.expertise(t.id, 1).length) : []), [net, graph]);
  const inNews = useMemo(() => (graph ? publicPeople.map((p) => ({ p, routes: graph.reach(p) })).filter((x) => x.routes.length).sort((a, b) => b.routes[0].strength - a.routes[0].strength).slice(0, 4) : []), [graph, publicPeople]);

  if (!net || !graph || !digest) return <div className="top"><div className="brand">People<i>.</i></div><div style={{ marginTop: 24 }}><div className="skel" /></div></div>;
  const ranked = [...net.contacts].sort((a, b) => tieStrength(b, graph.now) - tieStrength(a, graph.now));

  function save() {
    try {
      const parsed = JSON.parse(draft) as Network;
      if (!parsed.me || !Array.isArray(parsed.contacts) || !Array.isArray(parsed.orgs)) throw new Error("Expected me, contacts and orgs.");
      replaceNetwork({ ...parsed, synthetic: false });
      setSettings(false); setBad(null);
    } catch (e) { setBad(e instanceof Error ? e.message : "Not valid JSON."); }
  }

  return (
    <>
      <header className="top">
        <div className="row between"><div className="brand">People<i style={{ color: "var(--people)" }}>.</i></div>
          <button className="tiny link" onClick={() => setSettings(true)}>{net.contacts.length} people · on this device</button></div>
        <p className="lede">What your network knows that the filings don’t.</p>
      </header>

      {noticed.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps" style={{ color: "var(--people)" }}>A reason to call</span></div>
          {noticed.map(({ c, r, ev, quiet }) => (
            <button key={c.id} className="card" style={{ width: "100%", display: "block" }} onClick={() => open(c.id)}>
              <span className="row" style={{ alignItems: "flex-start", gap: 11 }}>
                <Avatar person={c} />
                <span className="grow">
                  <b>{c.name}</b> <span className="faint small">· quiet for {ago(quiet).replace(" ago", "")}</span>
                  <span style={{ display: "block", marginTop: 4 }}>{graph.orgName(r.org)}, where {c.name.split(" ")[0]} {r.to === null ? "is" : "was"} {r.title.split(",")[0]}, just filed: <b>{ev.title}</b>.</span>
                  <span className="small muted" style={{ display: "block", marginTop: 4 }}>{day(ev.at)} · {c.tie!.note ?? c.tie!.how}</span>
                </span>
              </span>
            </button>
          ))}
        </section>
      )}

      <section className="section">
        <div className="head"><span className="caps">Who to ask about</span></div>
        <div className="chips" style={{ marginTop: 0 }}>
          {themes.map((t) => <button key={t.id} className={`chip people ${theme === t.id ? "on" : ""}`} onClick={() => setTheme(t.id)}>{t.label}</button>)}
        </div>
        <div className="card" style={{ padding: "2px 14px", marginTop: 10 }}>
          {experts.map((x) => (
            <button key={x.person.id} className="hit" onClick={() => open(x.person.id)}>
              <Avatar person={x.person} />
              <span className="grow">
                <b>{x.person.name}</b>
                <span className="small muted" style={{ display: "block" }}>{x.roles.map((r) => `${r.title.split(",")[0]}, ${graph.orgName(r.org)}`).slice(0, 2).join(" · ")}</span>
                <span className="tiny faint"><Meter value={x.expertise} label="depth" /> {x.years}y in the field · <Meter value={x.tie} label="tie" /> {strengthWord(x.tie)} tie</span>
              </span>
            </button>
          ))}
        </div>
        <p className="tiny faint" style={{ marginTop: 8 }}>Depth = years in the field, weighted by seniority and by how long ago. Nobody tagged themselves an expert; it is computed from careers.</p>
      </section>

      {inNews.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps">People in this month’s filings you can reach</span></div>
          {inNews.map(({ p, routes }) => (
            <div key={p.id} className="card">
              <button className="row" style={{ width: "100%" }} onClick={() => open(p.id)}><Avatar person={p} /><span className="grow"><b>{p.name}</b><span className="small muted" style={{ display: "block" }}>{p.headline}</span></span>
                <span className="tiny faint">{routes.length} route{routes.length === 1 ? "" : "s"}</span></button>
              <ReachPath reach={routes[0]} target={p} />
            </div>
          ))}
        </section>
      )}

      <section className="section">
        <div className="head"><span className="caps">Everyone, warmest first</span></div>
        <div className="card" style={{ padding: "2px 14px" }}>
          {ranked.map((c) => (
            <button key={c.id} className="hit" onClick={() => open(c.id)}>
              <Avatar person={c} /><span className="grow"><b>{c.name}</b><span className="small muted clip" style={{ display: "block" }}>{c.headline}</span></span>
              <Meter value={tieStrength(c, graph.now)} label="tie" />
            </button>
          ))}
        </div>
      </section>

      {settings && (
        <Sheet onClose={() => setSettings(false)}>
          <h2 style={{ font: "600 21px/1.2 var(--serif)" }}>Your network stays with you</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            Contacts live in this browser’s storage and nowhere else. Matching them to filings happens on this device; FINN’s servers send public
            company data down and never receive a name from your network. {net.synthetic ? "You are looking at a synthetic demo network: invented people, real companies." : "You are using your own network."}
          </p>
          <div className="caps" style={{ marginTop: 18 }}>Bring your own</div>
          <p className="muted small" style={{ marginTop: 4 }}>Paste a network file (same shape as <a className="link" href="/data/network.seed.json" target="_blank">the demo file</a>): yourself, your contacts with roles and years, and when you last spoke.</p>
          <textarea className="textarea" style={{ marginTop: 8 }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='{"me": {...}, "contacts": [...], "orgs": [...], "schools": [...], "themes": [...]}' aria-label="Network JSON" />
          {bad && <p className="small down" style={{ marginTop: 6 }}>{bad}</p>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={save}>Use this network</button>
            {custom && <button className="btn ghost" onClick={() => { replaceNetwork(null); setSettings(false); }}>Erase mine, back to demo</button>}
          </div>
        </Sheet>
      )}
    </>
  );
}
