"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Meter } from "@/components/People";
import { useOpenPerson } from "@/components/Shell";
import { useStore } from "@/lib/client/store";
import { strengthWord } from "@/lib/network/graph.ts";

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
  const rec = useRef<Recognition | null>(null);

  useEffect(() => { fetch("/data/research/index.json").then((r) => (r.ok ? r.json() : [])).then(setDemo).catch(() => {}); }, []);
  const text = q.trim().toLowerCase().replace(/^(who (knows|can explain|do i know (at|in))|research|analyse|analyze|tell me about)\s+/, "").replace(/\?$/, "");

  useEffect(() => {
    if (text.length < 2) { setRemote([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/research?stage=resolve&q=${encodeURIComponent(text)}`).then((r) => (r.ok ? r.json() : { matches: [] }))
        .then((d) => setRemote(d.matches ?? [])).catch(() => setRemote([]));
    }, 220);
    return () => clearTimeout(t);
  }, [text]);

  const hits = useMemo(() => {
    if (!digest || !net || !graph || text.length < 2) return null;
    const local = Object.values(digest.companies).filter((c) => c.symbol.toLowerCase().includes(text) || c.name.toLowerCase().includes(text)).map((c) => ({ symbol: c.symbol, name: c.name }));
    const companies = [...local, ...remote.filter((r) => !local.some((l) => l.symbol === r.symbol))].slice(0, 6);
    const people = [...net.contacts, ...publicPeople].filter((p) => p.name.toLowerCase().includes(text) || p.headline.toLowerCase().includes(text)).slice(0, 6);
    const themes = net.themes.filter((t) => t.label.toLowerCase().includes(text) || text.includes(t.label.toLowerCase())).slice(0, 3)
      .map((t) => ({ ...t, experts: graph.expertise(t.id, 4) })).filter((t) => t.experts.length);
    return { companies, people, themes };
  }, [digest, net, graph, publicPeople, remote, text]);

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

  const examples = ["Who knows rural lending?", "Kaynes", "Semiconductors", "PI Industries", "Noel Tata"];
  return (
    <>
      <header className="top">
        <div className="brand">Ask<i>.</i></div>
        <p className="lede">A company, a person, or a theme.</p>
      </header>
      <div className="search">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kaynes · who knows specialty chemicals?" aria-label="Ask FINN" enterKeyHint="search" />
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

      {hits && hits.themes.map((t) => (
        <section className="section" key={t.id}>
          <div className="head"><span className="caps" style={{ color: "var(--people)" }}>Your people for {t.label.toLowerCase()}</span></div>
          <div className="card" style={{ padding: "2px 14px" }}>
            {t.experts.map((x) => (
              <button key={x.person.id} className="hit" onClick={() => open(x.person.id)}>
                <Avatar person={x.person} />
                <span className="grow">
                  <b>{x.person.name}</b>
                  <span className="small muted" style={{ display: "block" }}>{x.years} years in the field · {x.roles.map((r) => graph!.orgName(r.org)).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</span>
                  <span className="tiny faint"><Meter value={x.expertise} label="depth" /> depth · <Meter value={x.tie} label="tie" /> {strengthWord(x.tie)} tie</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {hits && hits.companies.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps">Companies</span></div>
          <div className="card" style={{ padding: "2px 14px" }}>
            {hits.companies.map((c) => <Link key={c.symbol} href={`/research/${c.symbol}`} className="hit"><span className="tick">{c.symbol}</span><span className="grow clip">{c.name}</span><span className="faint">›</span></Link>)}
          </div>
        </section>
      )}
      {hits && hits.people.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps">People</span></div>
          <div className="card" style={{ padding: "2px 14px" }}>
            {hits.people.map((p) => (
              <button key={p.id} className="hit" onClick={() => open(p.id)}>
                <Avatar person={p} /><span className="grow"><b>{p.name}</b><span className="small muted clip" style={{ display: "block" }}>{p.headline}</span></span>
                <span className="tiny faint">{p.tie ? "you know" : "in filings"}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {hits && !hits.companies.length && !hits.people.length && !hits.themes.length && <p className="muted" style={{ marginTop: 18 }}>Nothing matches “{q}”. Try an NSE symbol or a company name.</p>}
    </>
  );
}
