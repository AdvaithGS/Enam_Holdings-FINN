"use client";
import { useMemo, useState } from "react";
import { day, oneIn, pct, tone } from "@/lib/client/format";
import { useStore } from "@/lib/client/store";
import { strengthWord } from "@/lib/network/graph.ts";
import type { Person } from "@/lib/network/types.ts";
import type { Candles, CloseBrief } from "@/lib/types";
import { Avatar, Meter, TieLine } from "./People";
import { useOpenPerson } from "./Shell";

/** A move this rare, or rarer, is worth a phone call. */
const FLAG = 0.1;

export function CandleChart({ data, height = 54 }: { data: Candles; height?: number }) {
  const n = data.c.length;
  if (n < 2) return null;
  const w = 150, lo = Math.min(...data.l), hi = Math.max(...data.h), step = w / n;
  const y = (v: number) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (height - 4);
  return (
    <svg className="candles" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img"
      aria-label={`Daily candles, ${day(data.dates[0])} to ${day(data.dates[n - 1])}`}>
      {data.c.map((c, i) => {
        const o = data.o[i], x = i * step + step / 2, up = c >= o, top = y(Math.max(o, c)), bot = y(Math.min(o, c));
        return (
          <g key={data.dates[i]} stroke={up ? "var(--up)" : "var(--down)"} fill={up ? "var(--up)" : "var(--down)"}>
            <line x1={x} x2={x} y1={y(data.h[i])} y2={y(data.l[i])} strokeWidth="0.8" />
            <rect x={x - step * 0.32} width={step * 0.64} y={top} height={Math.max(0.8, bot - top)} stroke="none" />
          </g>
        );
      })}
    </svg>
  );
}

interface Action { key: string; headline: string; person: Person; why: string; tie: number; insider?: boolean }

/** Tie the session's moves to people the investor knows. Runs on the device. */
function useActions(c: CloseBrief | null | undefined): Action[] {
  const { graph, digest, prefs } = useStore();
  return useMemo(() => {
    if (!c || !graph || !digest) return [];
    const out: Action[] = [];
    const company = (symbol: string, headline: string) => {
      const org = graph.orgId(symbol);
      const lead = org ? graph.whoToCall(org, [], 1).find((l) => l.score >= 0.1) : undefined;
      if (lead) out.push({ key: `${headline}|${lead.person.id}`, headline, person: lead.person, why: lead.why, tie: lead.tie, insider: lead.insider });
    };
    for (const m of c.movers.filter((x) => x.p <= 1 / prefs.rare)) {
      if (m.p <= 0.05 && !m.event) company(m.symbol, `${m.symbol} moved ${pct(m.change, 1)} and nothing was filed`);
    }
    for (const s of c.sectors) {
      if (s.p === null || s.p > FLAG) continue;
      for (const symbol of s.held) {
        company(symbol, `${s.name} stocks ${s.rel !== null && s.rel >= 0 ? "beat" : "lagged"} the NIFTY by ${pct(Math.abs(s.rel ?? 0), 1, false)}, a gap seen ${oneIn(s.p)} sessions; you hold ${symbol}`);
      }
    }
    for (const w of c.world) {
      if (w.p === null || w.p > FLAG || w.change === null) continue;
      for (const link of w.links) {
        const headline = `${w.name} ${w.change >= 0 ? "rose" : "fell"} ${pct(Math.abs(w.change), 1, false)} (${oneIn(w.p)} sessions): ${link.why}`;
        if (link.symbol) company(link.symbol, headline);
        else if (link.theme) {
          const e = graph.expertise(link.theme, 1)[0];
          if (e && e.tie >= 0.1) out.push({ key: `${headline}|${e.person.id}`, headline, person: e.person, tie: e.tie,
            why: `${Math.round(e.years)} years in ${graph.themeLabel(link.theme).toLowerCase()}: ${e.person.headline}` });
        }
      }
    }
    const seen = new Set<string>();
    return out.filter((a) => (seen.has(a.person.id) ? false : (seen.add(a.person.id), true))).slice(0, 3);
  }, [c, graph, digest]);
}

const REGIME: Record<string, string> = { calm: "calm", normal: "ordinary", elevated: "elevated", stressed: "stressed" };

export function Close() {
  const { digest, prefs } = useStore();
  const [more, setMore] = useState(false);
  const open = useOpenPerson();
  const c = digest?.close;
  const actions = useActions(c);
  if (!digest || !c) return null;
  const pf = c.portfolio;
  const verb = (x: number | null) => (x === null ? "moved" : x > 0 ? "rose" : x < 0 ? "fell" : "was flat at");
  const amt = (x: number | null) => pct(x === null ? null : Math.abs(x), 2, false);
  const regions = [...new Set(c.world.map((w) => w.region))];
  const span = Math.max(0.005, ...c.sectors.map((s) => Math.abs(s.rel ?? 0)));
  const lead = c.sectors[0], lag = c.sectors[c.sectors.length - 1];
  return (
    <section className="section">
      <div className="head">
        <span className="caps">{c.final ? "The close" : "The session so far"} · {day(c.session)}</span>
        {c.regime && <span className={`tiny regime ${c.regime.label}`} title={`NIFTY conditional volatility ${pct(c.regime.vol, 1, false)} a year (GARCH), higher than ${pct(c.regime.pct, 0, false)} of the last ${c.regime.sessions} sessions`}>volatility {REGIME[c.regime.label]}</span>}
      </div>
      <div className="card">
        <p className="closing">
          Your {pf.n} stocks {verb(pf.ret)} <b className={`num ${tone(pf.ret)}`}>{amt(pf.ret)}</b>; the NIFTY {verb(pf.market)} <b className={`num ${tone(pf.market)}`}>{amt(pf.market)}</b>.
          {pf.alpha !== null && <> Beyond their market exposure that is <b className={`num ${tone(pf.alpha)}`}>{pct(pf.alpha, 2)}</b>{pf.alpha_p !== null && <>, {pf.alpha_p <= FLAG ? <>a gap seen {oneIn(pf.alpha_p)} sessions</> : "an ordinary day"}</>}.</>}
        </p>
        <p className="small muted" style={{ marginTop: 6 }}>
          {pf.up} up, {pf.down} down · filed today: {c.filed.act === 0 ? "nothing that needs you" : <a className="link" href={`#${c.act[0]}`}>{c.filed.act} that need{c.filed.act === 1 ? "s" : ""} you</a>}, {c.filed.glance} worth a glance, {c.filed.aside} set aside
        </p>
        {c.movers.some((m) => m.p <= 1 / prefs.rare) && <div style={{ marginTop: 8 }}>
          {c.movers.filter((m) => m.p <= 1 / prefs.rare).map((m) => (
            <a className="aside" key={m.symbol} href={m.event ? `#${m.event}` : undefined} style={{ alignItems: "baseline", gap: 8 }}>
              <span className="grow"><b className="tick">{m.symbol}</b> <b className={`num ${tone(m.change)}`}>{pct(m.change, 1)}</b>{" "}
                {m.event_title ? <span className="small clip" style={{ display: "block", marginTop: 2 }}>{m.event_title}</span> : <span className="small">· no filing explains it</span>}</span>
              <span className="tiny faint" style={{ whiteSpace: "nowrap" }}>{oneIn(m.p)} days</span>
            </a>
          ))}
        </div>}

        {actions.map((a) => (
          <div key={a.key}>
            <p className="small" style={{ marginTop: 12 }}>{a.headline}.</p>
            <button className="who" style={{ marginTop: 6 }} onClick={() => open(a.person.id)}>
              <Avatar person={a.person} />
              <span className="grow">
                <span className="name">Call {a.person.name}</span>
                <span className="why" style={{ display: "block" }}>{a.why}</span>
                <span className="meta" style={{ display: "block" }}><Meter value={a.tie} label="tie" /> {strengthWord(a.tie)} tie · <TieLine person={a.person} /></span>
                {a.insider && <span className="caution" style={{ display: "block" }}>Works there now. Ask for context, never for unpublished numbers.</span>}
              </span>
            </button>
          </div>
        ))}

        <div className="foot">
          <button onClick={() => setMore(!more)} aria-expanded={more}>{more ? "Hide sectors and world markets" : "Sectors and world markets"}</button>
          {lead && lag && lead !== lag && <span className="tiny">{lead.name} led, {lag.name} lagged</span>}
        </div>

        {more && <>
          {c.sectors.length > 0 && <>
            <div className="caps" style={{ marginTop: 12 }}>Sectors against the NIFTY, today</div>
            <div className="sectors">
              {c.sectors.map((s) => (
                <div className="sector" key={s.id} title={s.rel_20 !== null ? `Previous 20 sessions: ${pct(s.rel_20, 1)} against the NIFTY` : undefined}>
                  <span className="small">{s.name}{s.held.length > 0 && <span className="faint"> · {s.held.join(", ")}</span>}</span>
                  <span className="track"><i className={(s.rel ?? 0) >= 0 ? "pos" : "neg"} style={{ width: `${Math.abs(s.rel ?? 0) / span * 50}%` }} /></span>
                  <span className={`small num ${tone(s.rel)}`}>{pct(s.rel, 1)}</span>
                </div>
              ))}
            </div>
            {c.rotation !== null && (
              <p className="tiny faint" style={{ marginTop: 6 }}>
                {c.rotation <= -0.5 ? "Rotation: today’s leaders were the past month’s laggards" : c.rotation >= 0.5 ? "Continuation: the past month’s leaders led again" : "No clear rotation against the past month"}
                {" "}(rank correlation {c.rotation.toFixed(2)} between today and the previous 20 sessions, {c.sectors.length} sectors).
              </p>
            )}
          </>}
          {regions.map((r) => (
            <div key={r}>
              <div className="caps" style={{ marginTop: 14 }}>{r}</div>
              <div className="world">
                {c.world.filter((w) => w.region === r).map((w) => (
                  <div className="tile" key={w.id}>
                    <div className="row between"><span className="small clip">{w.name}</span><b className={`small num ${tone(w.change)}`} style={{ margin: 0, font: "inherit", fontWeight: 600 }}>{pct(w.change, 1)}</b></div>
                    <CandleChart data={w} />
                    <div className="tiny faint">{day(w.session)} close{w.p !== null && w.p <= FLAG ? ` · ${oneIn(w.p)} sessions` : ""}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="tiny faint" style={{ marginTop: 10 }}>
            Each market is shown at its last completed session, {c.world[0]?.dates.length ?? 30} daily candles. “Your stocks” is an equal-weight average; position sizes are not held.
            “Beyond market exposure” is the average market-model residual of the holdings.
          </p>
        </>}
      </div>
    </section>
  );
}
