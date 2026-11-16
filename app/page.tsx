"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Against, MiniBars, SegBar } from "@/components/Viz";
import { DateField } from "@/components/DateField";
import { EventDetail, GlanceLine, MoveRow, NeedRow, shortfall } from "@/components/Brief";
import { Close } from "@/components/Close";
import { findMoves, ThresholdSheet } from "@/components/Moves";
import { Detail, State, useOnClose, useWide } from "@/components/Shell";
import { day, dayTime } from "@/lib/client/format";
import { inWindow, useStore, WINDOWS, windowStart } from "@/lib/client/store";
import type { FinnEvent } from "@/lib/types";

export default function Brief() {
  const { digest, market, error, prefs, setPrefs, loadMarket } = useStore();
  const wide = useWide();
  const [sel, setSel] = useState<string | null>(null);
  const [aside, setAside] = useState<string | null>(null);
  const [showAside, setShowAside] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [allMoves, setAllMoves] = useState(false);
  const [how, setHow] = useState(false);
  useOnClose(useCallback(() => setSel(null), []));
  useEffect(loadMarket, [loadMarket]);

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
    return { start, events, act, glance, rest, groups: [...groups].sort((a, b) => b[1].length - a[1].length), filings: events.reduce((n, e) => n + e.filings.length, 0) };
  }, [digest, prefs]);
  const moves = useMemo(() => (market && digest && view ? findMoves(market, digest, view.start, prefs.rare, prefs.move, prefs.volume) : []), [market, digest, view, prefs.rare, prefs.move, prefs.volume]);

  if (error) return <State kind="error" title="The brief could not be loaded">Check the connection and reload. The last brief you opened is kept on this device and will show once it can be read.</State>;
  if (!digest || !view) return <State kind="loading" />;

  const pick = (id: string) => setSel(sel === id ? null : id);
  // on a laptop the evidence pane is never empty: the first thing that needs you, else the close
  const first = wide && sel === null ? view.act[0]?.id ?? null : null;
  const is = (id: string) => sel === id || first === id;
  const scale = Math.max(0.02, ...moves.map((m) => Math.abs(m.change)));
  const vm = moves.map((m) => m.volMkt).filter((x): x is number => x != null);
  const shownMoves = moves.slice(0, allMoves ? 60 : 5);
  const n = Object.keys(digest.companies).length;

  return (
    <>
      <header className="top">
        <h1 className="lede">{view.act.length === 0 ? "Nothing needs you" : `${view.act.length} ${view.act.length === 1 ? "thing needs" : "things need"} you`}</h1>
        <SegBar parts={[{ label: "need you", n: view.act.length, color: "var(--alert)" }, { label: "worth a glance", n: view.glance.length, color: "var(--d1)" }, { label: "set aside", n: view.rest.length, color: "var(--d5)" }]} />
        {digest.close && <div style={{ marginTop: 12 }}><MiniBars rows={[{ label: "Your book", v: digest.close.portfolio.ret ?? 0 }, { label: "NIFTY", v: digest.close.portfolio.market ?? 0 }, { label: "Beyond market", v: digest.close.portfolio.alpha ?? 0 }]} /></div>}
        <p className="counts sr">
          <b>{view.filings}</b> filings across {n} holdings became <b>{view.events.length}</b> events: <b className={view.act.length ? "al" : ""}>{view.act.length}</b> need you,{" "}
          <b>{view.glance.length}</b> worth a glance, <b>{view.rest.length}</b> set aside.
        </p>
        <p className="tiny" style={{ marginTop: 2 }}>Read {dayTime(digest.generated_at)} · prices to {day(digest.as_of)}</p>
        <div className="chips" role="tablist" aria-label="Window">
          {WINDOWS.map((w) => <button key={w.id} role="tab" aria-selected={prefs.window === w.id} className={`chip ${prefs.window === w.id ? "on" : ""}`} onClick={() => { setPrefs({ window: w.id }); setSel(null); }}>{w.label}</button>)}
          <label className={`chip ${prefs.window === "since" ? "on" : ""}`}>since <DateField value={prefs.since} max={digest.generated_at.slice(0, 10)} onChange={(v) => setPrefs({ window: "since", since: v })} /></label>
        </div>
      </header>

      {view.act.length > 0 ? (
        <section className="section" aria-label="Needs you">
          {view.act.map((e) => <NeedRow key={e.id} e={e} selected={is(e.id)} onSelect={() => pick(e.id)} />)}
        </section>
      ) : view.glance.length > 0 ? (
        <section className="section">
          <div className="head"><span className="caps">The closest calls, and what each lacked</span></div>
          {view.glance.slice(0, 3).map((e) => (
            <div key={e.id}>
              <button className="rowi" aria-current={sel === e.id} onClick={() => pick(e.id)}>
                <span className="meta1"><b>{e.symbol}</b><span>{e.label}</span><span style={{ marginLeft: "auto" }}>{day(e.at)}</span></span>
                <span className="title" style={{ display: "block" }}>{e.title}</span>
                <Against value={e.p} line={digest.model.act} label={shortfall(e, digest.model.act)} />
                <span className="tiny" style={{ display: "block" }}>{(e.p * 100).toFixed(0)}% against the {(digest.model.act * 100).toFixed(0)}% line</span>
              </button>
              {sel === e.id && <Detail><EventDetail e={e} /></Detail>}
            </div>
          ))}
        </section>
      ) : (
        <State kind="empty" title="A quiet window">Nothing was filed across your {n} holdings since {day(view.start.toISOString())}. Widen the window above to look further back.</State>
      )}

      <section className="section">
        <div className="head"><span className="caps">Unusual moves ({moves.length})</span>
          <button className="small link" onClick={() => setSheet(true)}>rarer than 1 in {prefs.rare}{prefs.move > 0 ? `, ±${prefs.move}%` : ""}{prefs.volume > 0 ? `, ${prefs.volume}×` : ""}</button></div>
        {moves.length === 0 ? <p className="small muted" style={{ padding: "8px 0" }}>No holding had a session rarer than 1 in {prefs.rare} in this window.</p> : <>
          {vm.length > 0 && <p className="tiny">Market volume on these days: the median NIFTY 500 stock traded {Math.min(...vm).toFixed(1)}{Math.min(...vm) !== Math.max(...vm) ? `–${Math.max(...vm).toFixed(1)}` : ""}× its own norm. Each stock’s volume below is net of that.</p>}
          {shownMoves.map((m) => <MoveRow key={m.symbol + m.date} m={m} scale={scale} selected={sel === m.symbol + m.date} onSelect={() => pick(m.symbol + m.date)} />)}
          {moves.length > 5 && <button className="count" onClick={() => setAllMoves(!allMoves)}><span>{allMoves ? "Show the five rarest" : `${moves.length - 5} more, less rare`}</span><span>{allMoves ? "−" : "+"}</span></button>}
        </>}
      </section>

      {view.act.length > 0 && view.glance.length > 0 || (view.act.length === 0 && view.glance.length > 3) ? (
        <section className="section">
          <div className="head"><span className="caps">Worth a glance ({view.act.length === 0 ? view.glance.length - 3 : view.glance.length})</span><span className="tiny">a name in green can explain it</span></div>
          {view.glance.slice(view.act.length === 0 ? 3 : 0).map((e) => <GlanceLine key={e.id} e={e} selected={sel === e.id} onSelect={() => pick(e.id)} />)}
        </section>
      ) : null}

      {view.rest.length > 0 && (
        <section className="section">
          <button className="count" onClick={() => setShowAside(!showAside)} aria-expanded={showAside}>
            <span>Set aside: {view.rest.length} events ({view.rest.reduce((k, e) => k + e.filings.length, 0)} filings) of routine paperwork</span><span>{showAside ? "−" : "+"}</span>
          </button>
          {showAside && view.groups.map(([label, list]) => (
            <div key={label}>
              <button className="count" style={{ paddingLeft: 12 }} onClick={() => setAside(aside === label ? null : label)} aria-expanded={aside === label}><span>{label}</span><span className="num">{list.length}</span></button>
              {aside === label && list.map((e) => (
                <a key={e.id} className="one" href={e.url ?? "#"} target="_blank" rel="noreferrer" style={{ paddingLeft: 24, font: "var(--d)" }}>
                  <b>{e.symbol}</b><span>{e.title}</span><span className="d">{day(e.at).slice(0, 5)}</span>
                </a>
              ))}
            </div>
          ))}
        </section>
      )}

      {wide && sel === null && first === null ? <Detail fallback><Close /></Detail> : null}
      {wide && (sel !== null || first !== null) && <section className="section"><button className="count" onClick={() => setSel("close")}><span>The close: how the session ended</span><span>→</span></button></section>}
      {wide && sel === "close" && <Detail fallback><Close /></Detail>}

      <section className="section"><button className="count" onClick={() => setHow(!how)} aria-expanded={how}><span>How this was computed</span><span>{how ? "−" : "+"}</span></button></section>
      <footer className="tiny" style={{ lineHeight: "20px", display: how ? "block" : "none" }}>
        The last refresh covered {digest.window_days} days: {digest.run.filings} filings in {digest.run.events} events
        {digest.run.tiers ? ` (${digest.run.tiers.act.events} that need you, ${digest.run.tiers.glance.events} worth a glance, ${digest.run.tiers.aside.events} set aside)` : ""}.
        A model read {digest.run.documents_read} of the documents ({digest.run.llm.calls} new, {digest.run.llm.cache_hits} from cache); {digest.run.ocr_pages} scanned pages went through local OCR.
        Results figures are read from XBRL, and ranking weights come from an event study of {digest.model.sessions.toLocaleString("en-IN")} stock-sessions. Any underlined number opens its source or its formula.
      </footer>
      {sheet && <ThresholdSheet onClose={() => setSheet(false)} shown={moves.length} />}
    </>
  );
}
