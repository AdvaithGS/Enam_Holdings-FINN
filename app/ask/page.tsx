"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Meter } from "@/components/People";
import { Detail, State, useWide } from "@/components/Shell";
import { useOpenPerson } from "@/components/Shell";
import { useStore } from "@/lib/client/store";
import { strengthWord } from "@/lib/network/graph.ts";
import { alike, findPeople, masked, plan, words } from "@/lib/network/search.ts";
import { themeCompanies, type UCo } from "@/lib/client/universe";

interface Match { symbol: string; name: string }
type Recognition = { start: () => void; stop: () => void; onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void; onend: () => void; lang: string };

/** One box. A company opens research; a person opens their file; a theme opens your experts. */
export default function Ask() {
  const { digest, net, graph, publicPeople } = useStore();
  const open = useOpenPerson();
  const wide = useWide();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Match[]>([]);
  const [demo, setDemo] = useState<Match[]>([]);
  const [live, setLive] = useState(false);
  const [extra, setExtra] = useState<string[]>([]);
  const [uni, setUni] = useState<UCo[]>([]);
  useEffect(() => { fetch("/data/universe.json").then((r) => (r.ok ? r.json() : [])).then(setUni).catch(() => {}); }, []);
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
    // companies whose reported segments, industry or description carry the theme
    const byTheme = themeCompanies(text, uni, 6);
    // the fields those companies sit in point at the people who know them
    const fields = byTheme.slice(0, 3).flatMap((h) => words([h.co.i, ...h.co.p].join(" ")));
    const fromCompanies = net.themes.filter((t) => words(t.label).some((w) => w.length > 4 && fields.some((f) => alike(w, f) >= 0.85))).map((t) => t.id);
    const p = plan(graph, text, everyone, [...extra, ...fromCompanies]);
    const experts = p.wantsPeople || p.orgs.size ? findPeople(graph, p, 6) : [];
    const named = p.people.filter((x) => x.w >= 0.5).map((x) => x.person);
    const q = words(text);
    const near = (name: string) => { const t = words(name); return q.length > 0 && q.every((x) => t.some((y) => alike(x, y) >= 0.74)); };
    const local = experts.length && p.orgs.size === 0 ? [] : Object.values(digest.companies).filter((c) => near(`${c.symbol} ${c.name}`)).map((c) => ({ symbol: c.symbol, name: c.name }));
    const companies = experts.length && !local.length ? [] : [...local, ...remote.filter((r) => !local.some((l) => l.symbol === r.symbol))].slice(0, 6);
    const themed = byTheme.filter((h) => !companies.some((c) => c.symbol === h.co.s)).map((h) => {
      const org = graph.orgId(h.co.s) ?? graph.orgId(h.co.n);
      return { ...h, lead: org ? graph.whoToCall(org, [], 1).find((l) => l.knowledge >= 0.3) ?? null : null };
    });
    const people = experts.length ? experts : (p.themes.size ? findPeople(graph, p, 4) : []);
    return { p, experts: people, named, companies, themed };
  }, [digest, net, graph, publicPeople, remote, text, extra, uni]);

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

  // Suggested questions come from what the investor holds and what was filed this week, not from a fixed list.
  const suggestions = useMemo(() => {
    if (!digest || !net || !graph) return [];
    const out: { label: string; q: string }[] = [];
    const cos = Object.values(digest.companies).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    for (const e of digest.events.filter((x) => x.tier === "act").slice(0, 2)) out.push({ label: `${digest.companies[e.symbol]?.name ?? e.symbol}: what did management promise before this?`, q: e.symbol });
    const appointee = digest.events.flatMap((e) => e.people ?? []).find((p) => p.action === "appointed" && (p.career?.length ?? 0) > 0);
    if (appointee) out.push({ label: `How do I reach ${appointee.name}?`, q: appointee.name });
    const seen = new Set<string>();
    for (const c of cos) {
      const t = graph.themesOf(graph.orgId(c.symbol) ?? "")[0];
      if (t && !seen.has(t) && seen.size < 2) { seen.add(t); out.push({ label: `Who can explain ${graph.themeLabel(t).toLowerCase()}? (you hold ${c.symbol})`, q: `who knows ${graph.themeLabel(t).toLowerCase()}` }); }
    }
    const big = cos[0] && uni.find((u) => u.s === cos[0].symbol)?.g[0];
    if (big) out.push({ label: `Which other companies are in ${big[0].toLowerCase()}? (${(big[1] * 100).toFixed(0)}% of ${cos[0].symbol})`, q: big[0] });
    out.push({ label: "Who understands the raw-material suppliers to battery makers?", q: "Who understands the raw material suppliers for battery manufacturers?" });
    return out.slice(0, 7);
  }, [digest, net, graph, uni]);

  const results = hits && (
    <>
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
      {hits && hits.themed.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps">Companies in this business</span><span className="tiny faint">by share of revenue</span></div>
          <div className="card" style={{ padding: "2px 14px" }}>
            {hits.themed.map((h) => (
              <div key={h.co.s} className="hit" style={{ display: "block" }}>
                <Link href={`/research/${h.co.s}`} className="row" style={{ gap: 11 }}><span className="tick">{h.co.s}</span><span className="grow"><b>{h.co.n.replace(/ (Ltd\.?|Limited)$/i, "")}</b>
                  <span className="small muted" style={{ display: "block" }}>{h.how}</span></span><span className="faint">›</span></Link>
                {h.lead && <button className="cover row" style={{ gap: 6 }} onClick={() => open(h.lead!.person.id)}><Avatar person={h.lead.person} /><span><b>{h.lead.person.name}</b> can explain the public context</span></button>}
              </div>
            ))}
          </div>
        </section>
      )}
      {hits && !hits.companies.length && !hits.named.length && !hits.experts.length && !hits.themed.length && <p className="muted" style={{ marginTop: 18 }}>Nobody in your network and no NSE company matches “{q}”.</p>}
    </>
  );

  return (
    <>
      <header className="top">
        <h1 className="lede">Ask about a company, a person or a business</h1>
        <div className="search" style={{ marginTop: 12 }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Adhesives · Kaynes · who knows rural lending?" aria-label="Ask FINN" enterKeyHint="search" />
          <button className={`mic ${live ? "live" : ""}`} onClick={listen} aria-label="Speak your question" style={{ minWidth: 44, minHeight: 44 }}>{live ? "Listening" : "Speak"}</button>
        </div>
      </header>

      <section className="section">
        <div className="head"><span className="caps">{hits ? "Try another" : "Questions from your book and this week’s filings"}</span></div>
        {!digest || !net ? <State kind="loading" /> : suggestions.map((s) => <button key={s.label} className="one" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => setQ(s.q)}><span>{s.label}</span><span className="d">→</span></button>)}
      </section>

      {!hits && demo.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps">Research already read</span><span className="tiny">any other NSE company is read when you open it</span></div>
          {demo.map((d) => <Link key={d.symbol} href={`/research/${d.symbol}`} className="one" style={{ gridTemplateColumns: "92px 1fr auto" }}><b style={{ font: "var(--d)", fontWeight: 600 }}>{d.symbol}</b><span>{d.name}</span><span className="d">→</span></Link>)}
        </section>
      )}

      {wide ? <Detail fallback>{results ?? <State kind="empty" title="Answers appear here">Type a question, or pick one on the left. FINN shows how it read the question, the people who can explain the public context, and the companies in that business with the share of revenue it represents.</State>}</Detail> : results}
    </>
  );
}
