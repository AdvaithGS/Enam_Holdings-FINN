"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Graph } from "../network/graph.ts";
import { peopleFromDigest, personKey } from "../network/public.ts";
import type { Network, Person } from "../network/types.ts";
import type { Digest, FinnEvent, Market } from "../types.ts";

export { peopleFromDigest, personKey };

/** rare: show a move only if it is rarer than 1 in `rare` sessions for that stock. move / volume: optional extra floors (0 = off). */
export interface Prefs { window: string; since?: string; rare: number; move: number; volume: number; alertOn: string[] }
const DEFAULT_PREFS: Prefs = { window: "24h", rare: 50, move: 0, volume: 0, alertOn: ["results", "m_and_a", "management_change", "litigation", "capex", "fund_raise"] };
const NET_KEY = "finn.network.v1", PREF_KEY = "finn.prefs.v2";

interface Store {
  digest: Digest | null; market: Market | null; error: string | null;
  net: Network | null; graph: Graph | null; publicPeople: Person[];
  prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void;
  replaceNetwork: (n: Network | null) => void; custom: boolean;
  loadMarket: () => void;
}
const Ctx = createContext<Store | null>(null);

const SEEN_KEY = "finn.seen.v1";
/** If the investor allowed notifications, tell them about events that matter and are new to this device. */
function announce(d: Digest) {
  try {
    const seen = new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
    const first = seen.size === 0;
    const fresh = d.events.filter((e) => e.tier === "act" && !seen.has(e.id));
    localStorage.setItem(SEEN_KEY, JSON.stringify(d.events.filter((e) => e.tier === "act").map((e) => e.id)));
    if (first || !fresh.length || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const title = fresh.length === 1 ? `${fresh[0].symbol}: ${fresh[0].title}` : `${fresh.length} filings need you`;
    const body = fresh.length === 1 ? (fresh[0].summary ?? fresh[0].label) : fresh.slice(0, 3).map((e) => `${e.symbol} ${e.title}`).join("\n");
    navigator.serviceWorker?.ready.then((reg) => reg.showNotification(title, { body, tag: "finn-act", data: `/#${fresh[0].id}`, icon: "/icon.svg" })).catch(() => new Notification(title, { body }));
  } catch { /* storage or notifications unavailable */ }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [market, setMarket] = useState<Market | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [net, setNet] = useState<Network | null>(null);
  const [custom, setCustom] = useState(false);
  const [hierarchy, setHierarchy] = useState<Record<string, string[]>>({});
  const [prefs, setP] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    const load = () => fetch("/data/digest.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Digest) => { setDigest((old) => (old?.generated_at === d.generated_at ? old : d)); announce(d); })
      .catch(() => setDigest((old) => { if (!old) setError("The brief could not be loaded."); return old; }));
    load();
    fetch("/data/hierarchy.json").then((r) => (r.ok ? r.json() : {})).then(setHierarchy).catch(() => {});
    // coming back to the app is the moment to look for a newer brief
    const onShow = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onShow);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
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
    return new Graph(net, { year: d.getFullYear(), month: d.getMonth() + 1 }, hierarchy);
  }, [net, digest, hierarchy]);
  const publicPeople = useMemo(() => (digest && graph ? peopleFromDigest(digest, graph) : []), [digest, graph]);

  const value = { digest, market, error, net, graph, publicPeople, prefs, setPrefs, replaceNetwork, custom, loadMarket };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}

/**
 * Every contact FINN puts forward is written to a log on this device: who, about what, on what
 * grounds, and when. A compliance officer can read it; the investor can export or clear it.
 */
export interface Suggestion { at: string; person: string; name: string; about: string; why: string; insider: boolean }
const LOG_KEY = "finn.calls.v1";
export function readLog(): Suggestion[] { try { return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]"); } catch { return []; } }
export function logSuggestion(s: Omit<Suggestion, "at">) {
  try {
    const log = readLog(), day = new Date().toISOString().slice(0, 10);
    if (log.some((x) => x.person === s.person && x.about === s.about && x.at.slice(0, 10) === day)) return;
    log.push({ ...s, at: new Date().toISOString() });
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-2000)));
  } catch { /* storage unavailable: nothing to log to */ }
}
export const clearLog = () => { try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ } };

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
