"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Graph } from "../network/graph.ts";
import { nameTokens, orgKey } from "../network/names.ts";
import type { Fn, Network, Person, Role } from "../network/types.ts";
import type { Digest, FiledPerson, FinnEvent, Market } from "../types.ts";

export interface Prefs { window: string; since?: string; move: number; volume: number; alertOn: string[] }
const DEFAULT_PREFS: Prefs = { window: "24h", move: 3, volume: 2, alertOn: ["results", "m_and_a", "management_change", "litigation", "capex", "fund_raise"] };
const NET_KEY = "finn.network.v1", PREF_KEY = "finn.prefs.v1";

interface Store {
  digest: Digest | null; market: Market | null; error: string | null;
  net: Network | null; graph: Graph | null; publicPeople: Person[];
  prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void;
  replaceNetwork: (n: Network | null) => void; custom: boolean;
  loadMarket: () => void;
}
const Ctx = createContext<Store | null>(null);

function fnOf(title: string): Fn {
  const t = title.toLowerCase();
  if (/financ|cfo|treasur|account/.test(t)) return "finance";
  if (/independent|non-?\s*executive|chairman|chairperson|director/.test(t) && !/managing|executive director|whole/.test(t)) return "board";
  if (/operat|coo|plant|manufactur|supply/.test(t)) return "operations";
  if (/technolog|cto|digital|engineer/.test(t)) return "technology";
  if (/legal|counsel|compliance|secretar/.test(t)) return "legal";
  if (/risk|credit/.test(t)) return "risk";
  if (/sales|market|business head|commercial/.test(t)) return "sales";
  if (/human|people|hr\b/.test(t)) return "hr";
  return "general";
}
const year = (iso: string) => Number(iso.slice(0, 4));

/** People named in filings become nodes too: public facts only, from the filing itself. */
export function peopleFromDigest(digest: Digest, graph: Graph): Person[] {
  const out = new Map<string, Person>();
  for (const e of digest.events) {
    for (const fp of e.people ?? []) {
      const key = "p:" + nameTokens(fp.name).join("-");
      const company = graph.orgId(e.symbol) ?? `x:${orgKey(digest.companies[e.symbol]?.name ?? e.symbol)}`;
      const leaving = ["resigned", "retired", "ceased", "died"].includes(fp.action);
      const roles: Role[] = [{
        org: company, title: fp.role, fn: fnOf(fp.role), level: fp.tier <= 1 ? 1 : fp.tier === 2 ? 2 : fp.tier === 3 ? 1 : 3,
        from: leaving ? 0 : year(e.at), to: leaving ? year(e.at) : null,
      }];
      for (const c of fp.career ?? []) {
        const org = graph.orgId(c.org) ?? `x:${orgKey(c.org)}`;
        if (org === company && !c.from_year) continue;
        roles.push({ org, title: c.role || "role not stated", fn: fnOf(c.role ?? ""), level: 2, from: c.from_year ?? 0, to: c.to_year ?? (c.from_year ? c.from_year : 0) });
      }
      const prev = out.get(key);
      const person: Person = {
        id: key, name: fp.name, headline: `${fp.role}, ${digest.companies[e.symbol]?.name ?? e.symbol}`,
        roles: prev ? [...prev.roles, ...roles.filter((r) => !prev.roles.some((x) => x.org === r.org && x.title === r.title))] : roles,
        education: (fp.education ?? []).map((s) => ({ school: s.school, degree: s.degree, to: s.year ?? 0 })),
        source: { label: `Exchange filing, ${e.at.slice(0, 10)}`, url: e.url },
      };
      out.set(key, person);
    }
  }
  return [...out.values()];
}
export const personKey = (fp: FiledPerson) => "p:" + nameTokens(fp.name).join("-");

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [net, setNet] = useState<Network | null>(null);
  const [custom, setCustom] = useState(false);
  const [prefs, setP] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    fetch("/data/digest.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setDigest).catch(() => setError("The brief could not be loaded."));
    try {
      const saved = localStorage.getItem(PREF_KEY);
      if (saved) setP({ ...DEFAULT_PREFS, ...JSON.parse(saved) });
      // a link can carry its window: /?w=30d
      const w = new URLSearchParams(window.location.search).get("w");
      if (w && WINDOWS.some((x) => x.id === w)) setP((old) => ({ ...old, window: w }));
      const own = localStorage.getItem(NET_KEY);
      if (own) { setNet(JSON.parse(own)); setCustom(true); return; }
    } catch { /* private mode: fall through to the demo network */ }
    fetch("/data/network.seed.json").then((r) => r.json()).then(setNet).catch(() => setError("The network could not be loaded."));
  }, []);

  const loadMarket = useCallback(() => {
    if (!market) fetch("/data/market.json").then((r) => r.json()).then(setMarket).catch(() => {});
  }, [market]);
  const setPrefs = useCallback((p: Partial<Prefs>) => setP((old) => {
    const next = { ...old, ...p };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  }), []);
  const replaceNetwork = useCallback((n: Network | null) => {
    try { if (n) localStorage.setItem(NET_KEY, JSON.stringify(n)); else localStorage.removeItem(NET_KEY); } catch { /* ignore */ }
    if (n) { setNet(n); setCustom(true); } else { setCustom(false); fetch("/data/network.seed.json").then((r) => r.json()).then(setNet); }
  }, []);

  const graph = useMemo(() => {
    if (!net || !digest) return null;
    const d = new Date(digest.generated_at);
    return new Graph(net, { year: d.getFullYear(), month: d.getMonth() + 1 });
  }, [net, digest]);
  const publicPeople = useMemo(() => (digest && graph ? peopleFromDigest(digest, graph) : []), [digest, graph]);

  const value = { digest, market, error, net, graph, publicPeople, prefs, setPrefs, replaceNetwork, custom, loadMarket };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}

export const WINDOWS: { id: string; label: string; hours: number }[] = [
  { id: "24h", label: "24 hours", hours: 24 }, { id: "3d", label: "3 days", hours: 72 },
  { id: "7d", label: "Week", hours: 168 }, { id: "30d", label: "Month", hours: 720 },
];
/** Windows count back from the last refresh, not the wall clock, so a weekend never empties the brief. */
export function windowStart(digest: Digest, prefs: Prefs): Date {
  const anchor = new Date(digest.generated_at);
  if (prefs.window === "since" && prefs.since) return new Date(prefs.since + "T00:00:00");
  const w = WINDOWS.find((x) => x.id === prefs.window) ?? WINDOWS[0];
  return new Date(anchor.getTime() - w.hours * 3600 * 1000);
}
export const inWindow = (e: FinnEvent, start: Date) => new Date(e.at) >= start;
