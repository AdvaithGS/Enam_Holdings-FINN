"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Meter } from "@/components/People";
import { useOpenPerson } from "@/components/Shell";
import { useStore } from "@/lib/client/store";
import { strengthWord } from "@/lib/network/graph.ts";
import { alike, findPeople, masked, plan, words } from "@/lib/network/search.ts";

interface Match { symbol: string; name: string }
type Recognition = { start: () => void; stop: () => void; onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void; onend: () => void; lang: string };

/** One box. A company opens research; a person opens their file; a theme opens your experts. */
export default function Ask() {
  const { digest, net, graph, publicPeople } = useStore();
  const open = useOpenPerson();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Match[]>([]);
  const [demo, setDemo] = useState<Match[]>([]);
  const [live, setLive] = useState(false);
  const [extra, setExtra] = useState<string[]>([]);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => { const v = new URLSearchParams(window.location.search).get("q"); if (v) setQ(v); }, []);
  useEffect(() => { fetch("/data/research/index.json").then((r) => (r.ok ? r.json() : [])).then(setDemo).catch(() => {}); }, []);
  const text = q.trim();

  useEffect(() => {
    if (text.length < 2 || text.split(/\s+/).length > 3) { setRemote([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/research?stage=resolve&q=${encodeURIComponent(text)}`).then((r) => (r.ok ? r.json() : { matches: [] }))
        .then((d) => setRemote(d.matches ?? [])).catch(() => setRemote([]));
    }, 220);
    return () => clearTimeout(t);
  }, [text]);

  // Unusual phrasing the concept map does not cover: ask a model which fields apply.
  // Only the question goes, with every network name masked on this device first.
  useEffect(() => {
    setExtra([]);
    if (!net || !graph || text.split(/\s+/).length < 3) return;
    const p = plan(graph, text, [...net.contacts, ...publicPeople]);
    if (p.themes.size || p.orgs.size || p.people.length) return;
    const t = setTimeout(() => {
      fetch("/api/research?stage=plan", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: masked(text, [...net.contacts, ...publicPeople]), themes: net.themes }) })
        .then((r) => (r.ok ? r.json() : { themes: [] })).then((d) => setExtra(d.themes ?? [])).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [text, net, graph, publicPeople]);

  const hits = useMemo(() => {
    if (!digest || !net || !graph || text.length < 2) return null;
    const everyone = [...net.contacts, ...publicPeople];
    const p = plan(graph, text, everyone, extra);
    const experts = p.wantsPeople || p.orgs.size ? findPeople(graph, p, 6) : [];
    const named = p.people.filter((x) => x.w >= 0.5).map((x) => x.person);
    const q = words(text);
    const near = (name: string) => { const t = words(name); return q.length > 0 && q.every((x) => t.some((y) => alike(x, y) >= 0.74)); };
    const local = experts.length && p.orgs.size === 0 ? [] : Object.values(digest.companies).filter((c) => near(`${c.symbol} ${c.name}`)).map((c) => ({ symbol: c.symbol, name: c.name }));
    const companies = experts.length && !local.length ? [] : [...local, ...remote.filter((r) => !local.some((l) => l.symbol === r.symbol))].slice(0, 6);
    return { p, experts, named, companies };
  }, [digest, net, graph, publicPeople, remote, text, extra]);

  function listen() {
    const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const R = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!R) return;
    if (live) { rec.current?.stop(); return; }
    const r = new R();
    r.lang = "en-IN";
    r.onresult = (e) => setQ(e.results[0][0].transcript);
    r.onend = () => setLive(false);
    rec.current = r;
    setLive(true);
    r.start();
  }

  const examples = ["Who understands raw material suppliers for battery makers?", "EV supply chain", "Kaynes", "customers of Dixon", "Reha Kapadia", "PI Industries"];
  return (
    <>
      <header className="top">
        <div className="brand">Ask<i>.</i></div>
        <p className="lede">Ask it the way you would ask a colleague.</p>
      </header>
      <div className="search">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Who knows battery raw materials?" aria-label="Ask FINN" enterKeyHint="search" />
        <button className={`mic ${live ? "live" : ""}`} onClick={listen} aria-label="Speak">●</button>
      </div>

      {!hits && (
        <>
          <div className="chips" style={{ flexWrap: "wrap", margin: "12px 0 0", padding: 0 }}>
            {examples.map((x) => <button key={x} className="chip" onClick={() => setQ(x)}>{x}</button>)}
          </div>
          {demo.length > 0 && (
            <section className="section">
              <div className="head"><span className="caps">Research ready to read</span></div>
              <div className="card" style={{ padding: "2px 14px" }}>
                {demo.map((d) => <Link key={d.symbol} href={`/research/${d.symbol}`} className="hit"><span className="tick">{d.symbol}</span><span className="grow clip">{d.name}</span><span className="faint">›</span></Link>)}
              </div>
              <p className="tiny faint" style={{ marginTop: 8 }}>Any other NSE company is read live when you open it: statements first, then the last four earnings calls and the annual report.</p>
            </section>
          )}
        </>
      )}

      {hits && (hits.p.concepts.length > 0 || hits.p.orgs.size > 0 || extra.length > 0) && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Read as:{" "}
          {hits.p.direction !== "self" && <b>{{ inputs: "suppliers to", customers: "customers of", chain: "the chain around", rivals: "competitors of" }[hits.p.direction]} </b>}
          {[...hits.p.concepts.filter((c) => !c.via).map((c) => c.label), ...hits.p.concepts.filter((c) => c.via).map((c) => `${c.label} (feeds ${c.via})`),
            ...[...hits.p.orgs.keys()].map((o) => graph!.orgName(o)), ...extra.map((t) => `${graph!.themeLabel(t)} (model)`)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 6).join(" · ")}
          {hits.p.leftover.length > 0 && <span className="faint"> · also weighing “{hits.p.leftover.join(" ")}”</span>}
        </p>
      )}
      {hits && hits.experts.length > 0 && (
        <section className="section" style={{ marginTop: 14 }}>
          <div className="head"><span className="caps" style={{ color: "var(--people)" }}>People who would know</span></div>
          <div className="card" style={{ padding: "2px 14px" }}>
            {hits.experts.map((x) => (
              <button key={x.person.id} className="hit" onClick={() => open(x.person.id)}>
                <Avatar person={x.person} />
                <span className="grow">
                  <b>{x.person.name}</b>
                  <span className="small muted" style={{ display: "block" }}>{x.why}</span>
                  <span className="tiny faint"><Meter value={x.relevance} label="relevance" /> relevance · <Meter value={x.tie} label="tie" /> {strengthWord(x.tie)} tie</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {hits && hits.named.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps">People</span></div>
          <div className="card" style={{ padding: "2px 14px" }}>
            {hits.named.map((p) => (
              <button key={p.id} className="hit" onClick={() => open(p.id)}>
                <Avatar person={p} /><span className="grow"><b>{p.name}</b><span className="small muted clip" style={{ display: "block" }}>{p.headline}</span></span>
                <span className="tiny faint">{p.tie ? "you know" : "in filings"}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {hits && hits.companies.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps">Companies</span></div>
          <div className="card" style={{ padding: "2px 14px" }}>
            {hits.companies.map((c) => <Link key={c.symbol} href={`/research/${c.symbol}`} className="hit"><span className="tick">{c.symbol}</span><span className="grow clip">{c.name}</span><span className="faint">›</span></Link>)}
          </div>
        </section>
      )}
      {hits && !hits.companies.length && !hits.named.length && !hits.experts.length && <p className="muted" style={{ marginTop: 18 }}>Nobody in your network and no NSE company matches “{q}”.</p>}
    </>
  );
}
