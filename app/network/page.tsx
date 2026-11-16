"use client";
import { useEffect, useMemo, useState } from "react";
import { Detail, Sheet, State, useOpenPerson, useWide } from "@/components/Shell";
import { RangeBar } from "@/components/Viz";
import { ago, day, monthYear, oneIn, signed } from "@/lib/client/format";
import { useHoldings } from "@/lib/client/holdings";
import { readLog, type Suggestion, useStore } from "@/lib/client/store";
import { monthsSince, pctRange, tieStrength } from "@/lib/network/graph.ts";
import type { Network, Person } from "@/lib/network/types.ts";
import { fieldMove, positions } from "@/lib/portfolio/risk.ts";

type Group = "company" | "sector";

export default function NetworkPage() {
  const { net, graph, digest, publicPeople, replaceNetwork, custom, market, loadMarket, error } = useStore();
  const { holdings, expect } = useHoldings();
  const open = useOpenPerson();
  const wide = useWide();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group>("sector");
  const [uni, setUni] = useState<{ s: string; g: [string, number][] }[]>([]);
  useEffect(() => { fetch("/data/universe.json").then((r) => (r.ok ? r.json() : [])).then(setUni).catch(() => {}); }, []);
  const [only, setOnly] = useState<{ held: boolean; strong: boolean; quiet: boolean; sector: string }>({ held: false, strong: false, quiet: false, sector: "" });
  const [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState<string | null>(null);
  const [log, setLog] = useState<Suggestion[]>([]);
  useEffect(() => { if (settings) setLog(readLog()); }, [settings]);
  useEffect(loadMarket, [loadMarket]);
  const [pass, setPass] = useState("");
  const [vault, setVault] = useState<string | null>(null);
  async function backup() {
    const { seal, collect } = await import("@/lib/client/vault");
    const data = collect();
    if (!data["finn.network.v1"] && net) data["finn.network.v1"] = JSON.stringify(net);
    const url = URL.createObjectURL(new Blob([await seal(data, pass)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "backup.finn" }).click();
    URL.revokeObjectURL(url);
    setVault("Saved backup.finn. Keep the passphrase; it cannot be recovered.");
  }
  async function recover(file: File) {
    const { open: unseal, restore } = await import("@/lib/client/vault");
    try { const n = restore(await unseal(await file.text(), pass)); setVault(`Restored ${n} item${n === 1 ? "" : "s"}. Reloading.`); setTimeout(() => location.reload(), 700); }
    catch (e) { setVault(e instanceof Error ? e.message : "Could not open that file."); }
  }


  const pos = useMemo(() => (holdings && market ? positions(holdings, market, expect) : []), [holdings, market, expect]);
  const matrix = useMemo(() => pos.map((p) => { const org = graph?.orgId(p.symbol); return { p, cv: org && graph ? graph.coverage(org, 1) : null }; }), [pos, graph]);
  // a business's width is its reported revenue share when a reported segment's name matches it; otherwise equal shares
  const shares = useMemo(() => new Map(matrix.map(({ p, cv }) => {
    const rep = uni.find((u) => u.s === p.symbol)?.g ?? [], segs = cv?.segments ?? [];
    const raw = segs.map((x) => { const w = x.segment.label.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3); return rep.find(([name]) => w.some((t) => name.toLowerCase().includes(t)))?.[1] ?? 0; });
    const known = raw.reduce((a, b) => a + b, 0), blanks = raw.filter((r) => r === 0).length;
    return [p.symbol, segs.map((x, i) => ({ id: x.segment.id, share: raw[i] || (blanks ? Math.max(0, 1 - known) / blanks : 0) || 1 / segs.length }))] as const;
  })), [matrix, uni]);
  const covered = matrix.reduce((a, m) => a + m.p.weight * (m.cv?.covered ?? 0), 0);

  const noticed = useMemo(() => {
    if (!net || !graph || !digest) return [];
    const out = [];
    for (const c of net.contacts) {
      const quiet = monthsSince(c.tie!.last, graph.now);
      if (quiet < 9) continue;
      for (const r of c.roles) {
        const sym = graph.orgs.get(r.org)?.ticker ?? graph.orgs.get(graph.orgs.get(r.org)?.parent ?? "")?.ticker;
        if (sym && r.to === null && digest.companies[sym]?.quiet?.now) continue; // works there, and it is in its results quiet period
        const ev = sym && digest.events.find((e) => e.symbol === sym && e.tier === "act");
        if (ev) { out.push({ c, r, ev, quiet }); break; }
      }
    }
    return out.sort((a, b) => b.quiet * b.c.tie!.closeness - a.quiet * a.c.tie!.closeness).slice(0, 4);
  }, [net, graph, digest]);
  const shifts = useMemo(() => {
    if (!net || !graph || !digest || !market) return [];
    return net.themes.map((t) => {
      const syms = Object.keys(digest.companies).filter((s) => graph.themesOf(graph.orgId(s) ?? "").includes(t.id));
      const mv = fieldMove(syms, market), expert = graph.expertise(t.id, 1)[0];
      return mv && mv.p <= 0.1 && expert ? { t, syms, mv, expert } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 3);
  }, [net, graph, digest, market]);
  const reachable = useMemo(() => (graph ? publicPeople.map((p) => ({ p, r: graph.reach(p)[0] })).filter((x) => x.r && x.r.hi >= 0.05).sort((a, b) => b.r.hi - a.r.hi).slice(0, 5) : []), [graph, publicPeople]);

  const groups = useMemo(() => {
    if (!net || !graph || !digest) return [];
    const held = new Set(Object.keys(digest.companies));
    const text = q.trim().toLowerCase();
    const keep = (c: Person) => {
      const t = tieStrength(c, graph.now), m = monthsSince(c.tie!.last, graph.now);
      const tickers = c.roles.map((r) => graph.orgs.get(r.org)?.ticker ?? graph.orgs.get(graph.orgs.get(r.org)?.parent ?? "")?.ticker).filter(Boolean) as string[];
      const sectors = c.roles.flatMap((r) => graph.themesOf(r.org));
      return (!text || `${c.name} ${c.headline} ${c.roles.map((r) => graph.orgName(r.org)).join(" ")}`.toLowerCase().includes(text))
        && (!only.held || tickers.some((s) => held.has(s))) && (!only.strong || t >= 0.5) && (!only.quiet || m >= 9) && (!only.sector || sectors.includes(only.sector));
    };
    const by = new Map<string, Person[]>();
    for (const c of net.contacts.filter(keep)) {
      const latest = [...c.roles].sort((a, b) => (b.to ?? 9999) - (a.to ?? 9999))[0];
      const key = group === "company" ? graph.orgName(latest.org) : graph.themeLabel(graph.themesOf(latest.org)[0] ?? c.roles.flatMap((r) => graph.themesOf(r.org))[0] ?? "Other");
      by.set(key, [...(by.get(key) ?? []), c]);
    }
    return [...by].map(([k, v]) => [k === "undefined" ? "Other" : k, v.sort((a, b) => tieStrength(b, graph.now) - tieStrength(a, graph.now))] as const).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [net, graph, digest, q, only, group]);

  if (error) return <State kind="error" title="Your network could not be loaded">Reload to try again. Nothing has been lost; the network is stored on this device.</State>;
  if (!net || !graph || !digest) return <State kind="loading" />;
  const shown = groups.reduce((a, [, v]) => a + v.length, 0);
  function save() {
    try {
      const parsed = JSON.parse(draft) as Network;
      if (!parsed.me || !Array.isArray(parsed.contacts) || !Array.isArray(parsed.orgs)) throw new Error("Expected me, contacts and orgs.");
      replaceNetwork({ ...parsed, synthetic: false });
      setSettings(false); setBad(null);
    } catch (e) { setBad(e instanceof Error ? e.message : "Not valid JSON."); }
  }


  const insight = (
    <>
      <div className="sub" style={{ marginTop: 0 }}>Coverage of the book, business by business: {(covered * 100).toFixed(0)}%</div>
      <p className="tiny">Each holding is the businesses it reports. A name in green can explain that business; orange means no one can.</p>
      <div role="table" aria-label="Coverage by holding and business">
        {matrix.map(({ p, cv }) => cv && (
          <div key={p.symbol} className="cg" role="row">
            <span role="rowheader"><b>{p.symbol}</b> <span className="tiny">{(p.weight * 100).toFixed(0)}%</span></span>
            <span className="cells">{cv.segments.map((x) => {
              const share = shares.get(p.symbol)?.find((g) => g.id === x.segment.id)?.share ?? 1 / cv.segments.length;
              return <button key={x.segment.id} role="cell" className={x.leads[0] ? "has" : "none"} style={{ flex: Math.max(share, 0.06) }} onClick={() => x.leads[0] && open(x.leads[0].person.id)}
                title={`${x.segment.label}: ${x.leads[0]?.person.name ?? "no one"}`} aria-label={`${x.segment.label}, ${(share * 100).toFixed(0)} percent of revenue: ${x.leads[0]?.person.name ?? "no one"}`} />;
            })}</span>
          </div>))}
      </div>
      <div className="keys"><span><i style={{ background: "var(--people)" }} />someone can explain it</span><span><i style={{ border: "1.5px dashed var(--alert)" }} />no one</span><span>width = share of revenue where the company reports it</span></div>

      {noticed.length > 0 && <><div className="sub">A reason to get back in touch</div>
        {noticed.map(({ c, r, ev, quiet }) => (
          <button key={c.id} className="rowi" onClick={() => open(c.id)}>
            <span className="pname">{c.name}</span> <span className="tiny">quiet for {ago(quiet).replace(" ago", "")}</span>
            <span className="line2" style={{ display: "block" }}>{graph.orgName(r.org)}, where {c.name.split(" ")[0]} {r.to === null ? "is" : "was"} {r.title.split(",")[0]}, filed on {day(ev.at)}: {ev.title}</span>
          </button>))}</>}

      {shifts.length > 0 && <><div className="sub">A field is moving</div>
        {shifts.map(({ t, syms, mv, expert }) => (
          <button key={t.id} className="rowi" onClick={() => open(expert.person.id)}>
            <b>{t.label}</b>: {syms.join(" and ")} moved <b className={mv.move >= 0 ? "up" : "down"}>{signed(mv.move)}</b> against the market over five sessions together ({oneIn(mv.p)} such stretches).
            <span className="line2" style={{ display: "block" }}><span className="pname">{expert.person.name}</span> can explain the public context: {expert.years} years in the field.</span>
          </button>))}</>}

      {reachable.length > 0 && <><div className="sub">People in this month’s filings you can reach</div>
        {reachable.map(({ p, r }) => (
          <button key={p.id} className="one" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }} onClick={() => open(p.id)}>
            <span>{p.name} <span className="tiny">{p.headline}</span><span className="line2" style={{ display: "block", font: "var(--d)", color: "var(--ink-2)" }}>via <span className="pname">{r.via?.name ?? "you"}</span></span></span>
            <RangeBar lo={r.lo} hi={r.hi} width={90} />
          </button>))}</>}
    </>
  );

  return (
    <>
      <header className="top">
        <h1 className="lede">{net.contacts.length} people, covering {(covered * 100).toFixed(0)}% of the book</h1>
        <p className="tiny" style={{ marginTop: 2 }}>{net.synthetic ? "Synthetic demo network" : "Your network"}, kept on this device · <button className="link" onClick={() => setSettings(true)}>privacy, backup and the suggestion log</button></p>
        <div className="search" style={{ marginTop: 12 }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, a company, a role" aria-label="Search people" /></div>
        <div className="chips" role="group" aria-label="Filters">
          <button className={`chip ${group === "company" ? "on" : ""}`} aria-pressed={group === "company"} onClick={() => setGroup("company")}>By company</button>
          <button className={`chip ${group === "sector" ? "on" : ""}`} aria-pressed={group === "sector"} onClick={() => setGroup("sector")}>By sector</button>
          <button className={`chip ${only.held ? "on" : ""}`} aria-pressed={only.held} onClick={() => setOnly({ ...only, held: !only.held })}>At a holding</button>
          <button className={`chip ${only.strong ? "on" : ""}`} aria-pressed={only.strong} onClick={() => setOnly({ ...only, strong: !only.strong })}>Tie 50 or more</button>
          <button className={`chip ${only.quiet ? "on" : ""}`} aria-pressed={only.quiet} onClick={() => setOnly({ ...only, quiet: !only.quiet })}>Not spoken in 9 months</button>
          <label className={`chip ${only.sector ? "on" : ""}`}><select value={only.sector} onChange={(e) => setOnly({ ...only, sector: e.target.value })} aria-label="Sector" style={{ border: 0, background: "transparent", font: "inherit", color: "inherit" }}>
            <option value="">Any sector</option>{net.themes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        </div>
      </header>

      {!wide && <section className="section">{insight}</section>}

      <section className="section">
        {shown === 0 ? <State kind="empty" title="No one matches">Clear a filter or the search to see all {net.contacts.length} people.</State> : groups.map(([name, list]) => (
          <div key={name} style={{ marginTop: 14 }}>
            <div className="sub" style={{ margin: "0 0 2px" }}>{name} <span className="faint" style={{ fontWeight: 400 }}>{list.length}</span></div>
            {list.map((c) => {
              const m = monthsSince(c.tie!.last, graph.now);
              return (
                <button key={c.id} className="one" style={{ gridTemplateColumns: "1fr auto" }} onClick={() => open(c.id)}>
                  <span><span className="pname">{c.name}</span><span className="line2" style={{ display: "block", font: "var(--d)", color: "var(--ink-2)" }}>{c.headline}</span></span>
                  <span className="d" style={{ textAlign: "right" }}><b style={{ color: "var(--ink)" }}>tie {Math.round(tieStrength(c, graph.now) * 100)} of 100</b><br /><span style={m >= 9 ? { color: "var(--alert)" } : undefined}>last spoke {monthYear(c.tie!.last)}</span></span>
                </button>
              );
            })}
          </div>
        ))}
      </section>

      {wide && <Detail fallback>{insight}</Detail>}
      {settings && (
        <Sheet onClose={() => setSettings(false)}>
          <h2 style={{ font: "600 21px/1.2 var(--serif)" }}>Your network stays with you</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            Contacts live in this browser’s storage and nowhere else. Matching them to filings happens on this device; FINN’s servers send public
            company data down and never receive a name from your network. {net.synthetic ? "You are looking at a synthetic demo network: invented people, real companies." : "You are using your own network."}
          </p>
          <div className="caps" style={{ marginTop: 18 }}>Encrypted backup</div>
          <p className="muted small" style={{ marginTop: 4 }}>Move your network, holdings and settings to another device. The file is encrypted here with your passphrase (AES-256, key stretched 310,000 times); without it the file is noise, to us as well.</p>
          <input className="textarea" style={{ minHeight: 0, marginTop: 8, fontSize: 16 }} type="password" placeholder="Passphrase, 10 characters or more" value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Passphrase" autoComplete="new-password" />
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn" disabled={pass.length < 10} onClick={backup}>Save backup</button>
            <label className="btn ghost" style={{ cursor: "pointer" }}>Restore from file<input type="file" accept=".finn,application/json" hidden onChange={(e) => e.target.files?.[0] && recover(e.target.files[0])} /></label>
          </div>
          {vault && <p className="small" style={{ marginTop: 6 }}>{vault}</p>}
          <div className="caps" style={{ marginTop: 18 }}>Suggestion log</div>
          <p className="muted small" style={{ marginTop: 4 }}>Every contact FINN has put forward on this device, with the subject and the grounds: {log.length} entr{log.length === 1 ? "y" : "ies"}.
            {log.length > 0 && <> Latest: {log[log.length - 1].name} on {log[log.length - 1].about}, {log[log.length - 1].at.slice(0, 10)}.</>}</p>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn ghost" disabled={!log.length} onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(log, null, 1)], { type: "application/json" }));
              Object.assign(document.createElement("a"), { href: url, download: "finn-suggestions.json" }).click(); URL.revokeObjectURL(url); }}>Export log</button>
          </div>
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
