"use client";
import { useEffect, useRef, useState } from "react";

export interface Annual { fy: string; revenue: number | null; op_profit: number | null; pat: number | null; opm: number | null; npm: number | null; cfo: number | null; fcf: number | null;
  debt: number | null; net_worth: number | null; de: number | null; roe: number | null; roce: number | null; roa: number | null;
  cogs?: number | null; days_basis?: "cost" | "revenue"; debtor_days?: number | null; inventory_days?: number | null; payable_days?: number | null; cycle_days?: number | null; net_debt_ebitda?: number | null }
export interface Fundamentals { ok: boolean; lender: boolean; last_fy: string; basis: string; days_basis?: "cost" | "revenue"; annual: Annual[];
  quarters: { period: string; revenue: number | null; pat: number | null; opm: number | null; revenue_yoy: number | null; pat_yoy: number | null }[];
  metrics: Record<string, number | string | null>; formulas: Record<string, string> }
export interface Commitment { id: string; source: string; metric: string; target: string; horizon?: string; quote: string; speaker?: string }
export interface CallExtract { id: string; when: string; url: string; ok: boolean; reason?: string; quarter?: string; commitments: Commitment[];
  claims: { topic: string; claim: string; quote: string; source: string }[]; analyst_concerns: { topic: string; question: string; quote?: string }[]; dropped?: number }
export interface AnnualExtract { ok: boolean; reason?: string; year: number; url: string; what_it_does?: string; segments?: { name: string; share_pct?: number; note?: string }[];
  revenue_mix_basis?: string; geography?: string; customers?: string; facts?: { fact: string; page: number }[]; risks?: { risk: string; page: number }[]; pages_read?: number[]; pages_total?: number }
export interface Cited { point: string; sources: string[] }
export interface Analysis {
  promised_vs_delivered: { commitment_id: string; promised: string; delivered: string; verdict: string; sources: string[]; quote: string; by: string; call: string; metric: string }[];
  scorecard: Record<string, number>; guidance_drift: { metric: string; direction: string; path: string; sources: string[] }[];
  narrative_vs_numbers: { story: string; numbers: string; verdict: string; sources: string[] }[]; bull: Cited[]; bear: Cited[]; watch: Cited[];
}
export interface Dossier { price?: { dates: string[]; close: number[] } | null; ok: boolean; reason?: string; symbol: string; name: string; industry: string[]; fundamentals: Fundamentals; llm?: boolean;
  calls: { id: string; when: string; url: string }[]; annual_report: { year: number; url: string } | null;
  call_extracts?: CallExtract[]; annual?: AnnualExtract | null; analysis?: Analysis; sources: Record<string, { label: string; url: string }>; generated_at?: string }
export interface Stage { id: string; label: string; state: "wait" | "now" | "done" | "fail"; note?: string }

async function api<T>(stage: string, params: Record<string, string>, body?: unknown): Promise<T> {
  const q = new URLSearchParams({ stage, ...params });
  const r = await fetch(`/api/research?${q}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data as T;
}

/** Precomputed dossier if there is one; otherwise read the company live, stage by stage. */
export function useDossier(symbol: string) {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (started.current === symbol) return;
    started.current = symbol;
    const key = `finn.research.v2.${symbol}`;
    const mark = (id: string, state: Stage["state"], note?: string) => setStages((s) => s.map((x) => (x.id === id ? { ...x, state, note } : x)));
    (async () => {
      try {
        const pre = await fetch(`/data/research/${symbol}.json`);
        if (pre.ok) { const d = (await pre.json()) as Dossier; if (d.analysis) { setDossier(d); return; } }
        const cached = localStorage.getItem(key);
        if (cached) { setDossier(JSON.parse(cached)); return; }
      } catch { /* fall through to live */ }
      try {
        setStages([{ id: "FIN", label: "Reported statements", state: "now" }]);
        const base = await api<Dossier>("base", { symbol });
        if (!base.ok) { setError(base.reason ?? "No data for this company."); mark("FIN", "fail"); return; }
        const d: Dossier = { ...base, call_extracts: [] };
        setDossier(d);
        const plan: Stage[] = [{ id: "FIN", label: "Reported statements", state: "done", note: `${base.fundamentals.annual.length} years` },
          ...base.calls.map((c) => ({ id: c.id, label: `Earnings call, ${c.when}`, state: "wait" as const })),
          ...(base.annual_report ? [{ id: "AR", label: `Annual report ${base.annual_report.year}`, state: "wait" as const }] : []),
          { id: "SYN", label: "Promised vs delivered", state: "wait" as const }];
        setStages(plan);
        if (!base.llm) {
          setStages([plan[0], { id: "DOC", label: "Earnings calls and annual report", state: "fail", note: "reading model not configured" }]);
          return;
        }
        for (const c of base.calls) {
          mark(c.id, "now");
          try {
            const x = await api<CallExtract>("call", {}, { name: base.name, call: c });
            d.call_extracts = [...(d.call_extracts ?? []), x];
            d.sources = { ...d.sources, [c.id]: { label: `Earnings call, ${c.when}`, url: c.url } };
            mark(c.id, x.ok ? "done" : "fail", x.ok ? `${x.commitments.length} commitments` : x.reason);
          } catch (e) { mark(c.id, "fail", e instanceof Error ? e.message : "failed"); }
          setDossier({ ...d });
        }
        if (base.annual_report) {
          mark("AR", "now");
          try {
            d.annual = await api<AnnualExtract>("annual", {}, { name: base.name, ar: base.annual_report });
            if (d.annual.ok) d.sources = { ...d.sources, AR: { label: `Annual report ${d.annual.year}`, url: d.annual.url } };
            mark("AR", d.annual.ok ? "done" : "fail", d.annual.ok ? `${d.annual.pages_read?.length} of ${d.annual.pages_total} pages` : d.annual.reason);
          } catch (e) { mark("AR", "fail", e instanceof Error ? e.message : "failed"); }
          setDossier({ ...d });
        }
        mark("SYN", "now");
        try {
          d.analysis = await api<Analysis>("synth", {}, { base, calls: d.call_extracts, annual: d.annual });
          mark("SYN", "done");
          setDossier({ ...d });
          try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* storage full: fine */ }
        } catch (e) { mark("SYN", "fail", e instanceof Error ? e.message : "failed"); }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Research could not be loaded.");
      }
    })();
  }, [symbol]);
  return { dossier, stages, error };
}
