"use client";
import { useMemo, useState } from "react";
import { Close } from "@/components/Close";
import { ActCard, GlanceRow } from "@/components/EventCard";
import { Moves } from "@/components/Moves";
import { day, dayTime } from "@/lib/client/format";
import { inWindow, useStore, WINDOWS, windowStart } from "@/lib/client/store";
import type { FinnEvent } from "@/lib/types";

export default function Brief() {
  const { digest, error, prefs, setPrefs } = useStore();
  const [aside, setAside] = useState<string | null>(null);
  const [showAside, setShowAside] = useState(false);
  const view = useMemo(() => {
    if (!digest) return null;
    const start = windowStart(digest, prefs);
    const events = digest.events.filter((e) => inWindow(e, start));
    // the investor decides which kinds of filing may interrupt; the rest step down a tier
    const tierOf = (e: FinnEvent) => (e.tier === "act" && !prefs.alertOn.includes(e.category) ? "glance" : e.tier);
    const act = events.filter((e) => tierOf(e) === "act");
    const glance = events.filter((e) => tierOf(e) === "glance").sort((a, b) => b.p - a.p);
    const rest = events.filter((e) => tierOf(e) === "aside");
    const groups = new Map<string, FinnEvent[]>();
    for (const e of rest) groups.set(e.label, [...(groups.get(e.label) ?? []), e]);
    const filings = events.reduce((n, e) => n + e.filings.length, 0);
    const timeline = [...events].sort((a, b) => a.at.localeCompare(b.at)).map((e) => ({ id: e.id, tier: tierOf(e) }));
    return { start, events, act, glance, rest, groups: [...groups].sort((a, b) => b[1].length - a[1].length), filings, timeline };
  }, [digest, prefs]);

  if (error) return <div className="top"><div className="brand">FINN<i>.</i></div><p className="lede">{error}</p></div>;
  if (!digest || !view) return <div className="top"><div className="brand">FINN<i>.</i></div><div style={{ marginTop: 24 }}><div className="skel" /><div className="skel" /></div></div>;

  return (
    <>
      <header className="top">
        <div className="row between">
          <div className="brand">FINN<i>.</i></div>
          <span className="tiny faint">read {dayTime(digest.generated_at)} · prices to {day(digest.as_of)}</span>
        </div>
        <p className="lede">
          {view.filings === 0 ? <>Nothing was filed across your {Object.keys(digest.companies).length} companies in this window.</> : <>
            <b>{view.filings}</b> filing{view.filings === 1 ? "" : "s"} became <b>{view.events.length}</b> event{view.events.length === 1 ? "" : "s"}:{" "}
            <b style={{ color: "var(--matter)" }}>{view.act.length}</b> {view.act.length === 1 ? "needs" : "need"} you, <b>{view.glance.length}</b> worth a glance, <b>{view.rest.length}</b> set aside.
          </>}
        </p>
        <div className="chips" role="tablist" aria-label="Window">
          {WINDOWS.map((w) => <button key={w.id} role="tab" aria-selected={prefs.window === w.id} className={`chip ${prefs.window === w.id ? "on" : ""}`} onClick={() => setPrefs({ window: w.id })}>{w.label}</button>)}
          <label className={`chip ${prefs.window === "since" ? "on" : ""}`}>
            since <input type="date" value={prefs.since ?? ""} max={digest.generated_at.slice(0, 10)} onChange={(e) => e.target.value && setPrefs({ window: "since", since: e.target.value })} aria-label="Since date" />
          </label>
        </div>
        {view.timeline.length > 0 && (
          <div className="sieve" aria-hidden>
            <div className="dots">{view.timeline.map((t) => <a key={t.id} href={t.tier === "act" ? `#${t.id}` : undefined} className={`dot t-${t.tier}`} />)}</div>
          </div>
        )}
      </header>

      <Close />

      <Moves start={view.start} />

      {view.act.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps" style={{ color: "var(--matter)" }}>What matters · {view.act.length}</span></div>
          {view.act.map((e) => <ActCard key={e.id} e={e} />)}
        </section>
      )}

      {view.glance.length > 0 && (
        <section className="section">
          <div className="head"><span className="caps">Worth a glance · {view.glance.length}</span><span className="tiny faint">a green dot means you know someone</span></div>
          <div className="card" style={{ padding: "2px 14px" }}>{view.glance.map((e) => <GlanceRow key={e.id} e={e} />)}</div>
        </section>
      )}

      {view.rest.length > 0 && (
        <section className="section">
          <button className="head" style={{ width: "100%" }} onClick={() => setShowAside(!showAside)} aria-expanded={showAside}>
            <span className="caps">Set aside · {view.rest.length} events ({view.rest.reduce((n, e) => n + e.filings.length, 0)} filings)</span><span className="small link">{showAside ? "hide" : "show"}</span>
          </button>
          {showAside && (
            <div className="card" style={{ padding: "2px 14px" }}>
              {view.groups.map(([label, list]) => (
                <div key={label}>
                  <button className="aside" onClick={() => setAside(aside === label ? null : label)} aria-expanded={aside === label}><span>{label}</span><span className="num">{list.length}</span></button>
                  {aside === label && list.map((e) => (
                    <a key={e.id} className="aside small" href={e.url ?? "#"} target="_blank" rel="noreferrer" style={{ paddingLeft: 10 }}>
                      <span className="grow clip"><b>{e.symbol}</b> {e.title}</span><span className="faint" style={{ marginLeft: 8 }}>{day(e.at)}</span>
                    </a>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <footer className="section tiny faint" style={{ lineHeight: 1.6 }}>
        Ranking is measured, not asserted: an event study of {digest.model.sessions.toLocaleString("en-IN")} stock-sessions in this portfolio sets each
        category’s weight; results come from XBRL, never from a model. The last refresh covered {digest.window_days} days: {digest.run.filings} filings in {digest.run.events} events
        {digest.run.tiers ? ` (${digest.run.tiers.act.events} that matter, ${digest.run.tiers.glance.events} worth a glance, ${digest.run.tiers.aside.events} set aside)` : ""}.
        A model read {digest.run.documents_read} documents: {digest.run.llm.calls} new, {digest.run.llm.cache_hits} already read and taken from cache
        ({(digest.run.llm.input_tokens + digest.run.llm.output_tokens).toLocaleString("en-IN")} tokens this run). {digest.run.ocr_pages} scanned pages went through local OCR.
      </footer>
    </>
  );
}
