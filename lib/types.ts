export interface ResultRow {
  key: string; label: string; value: number; prev: number | null; year: number | null;
  qoq: number | null; yoy: number | null; margin?: number; margin_prev?: number; margin_year?: number;
}
export interface ResultsCard {
  symbol: string; period: string; period_end: string; kind: "company" | "lender" | "bank";
  basis: string; audited: boolean; rows: ResultRow[]; notes: string[];
  checks: { id: string; label: string; ok: boolean; gap: number }[]; checks_ok: boolean; source: string;
}
export interface FiledPerson {
  name: string; role: string; action: string; tier: number; effective?: string | null; reason?: string; age?: number;
  bio?: string; source: string;
  career?: { org: string; role?: string; from_year?: number; to_year?: number }[];
  education?: { school: string; degree?: string; year?: number }[];
}
export interface Evidence { k: string; text: string; d: number }
export interface FinnEvent {
  id: string; symbol: string; at: string; session: string; category: string; label: string;
  title: string; summary: string | null; url: string | null; tier: "act" | "glance" | "aside"; p: number; lift: number;
  evidence: Evidence[]; filings: { id: string; at: string; subject: string; title: string; url: string | null }[];
  results?: ResultsCard; people?: FiledPerson[]; names?: string[]; counterparty?: string | null;
  amount?: { cr: number; rho: number; quote: string; line_cr: number; leg: string; from: string; mcap_share?: number; cfo_years?: number };
  /** the half hour after the filing landed, from 5-minute bars (finn/intraday.py) */
  intraday?: { at: string; minutes: number; shock: number; vol_x: number | null; p: number; p_vol: number; n: number };
  market?: { change: number | null; abnormal: number | null; vol_ratio: number | null; p_ret: number | null; p_vol: number | null };
}
export interface Company {
  symbol: string; name: string; legal_name?: string; sector: string; industry?: string; mcap_cr?: number;
  line?: { cr: number; leg: string } | null; beta?: number | null;
}
export interface Digest {
  generated_at: string; as_of: string; window_days: number;
  model: { baseline: number; act: number; alpha: number; sessions: number; categories: Record<string, { n: number; p: number; lift: number; lo: number; hi: number }> };
  labels: Record<string, string>; companies: Record<string, Company>; events: FinnEvent[]; close?: CloseBrief | null;
  run: { filings: number; events: number; documents_read: number; seconds: number; ocr_pages: number; llm_available: boolean;
         llm: { calls: number; cache_hits: number; input_tokens: number; output_tokens: number } };
}
export interface Candles { dates: string[]; o: number[]; h: number[]; l: number[]; c: number[] }
export interface WorldIndex extends Candles {
  id: string; name: string; region: string; session: string; close: number; change: number | null; p: number | null;
  links: { symbol?: string; theme?: string; why: string }[];
}
/** The session once it is over (finn/close.py). */
export interface CloseBrief {
  session: string; final: boolean;
  portfolio: { n: number; ret: number | null; market: number | null; alpha: number | null; alpha_p: number | null; up: number; down: number; unusual: number };
  movers: { symbol: string; change: number | null; abnormal: number | null; vol_ratio: number | null; p: number; event: string | null; event_title: string | null }[];
  regime: { vol: number; pct: number; label: "calm" | "normal" | "elevated" | "stressed"; sessions: number } | null;
  sectors: { id: string; name: string; ret: number | null; rel: number | null; rel_20: number | null; p: number | null; held: string[] }[];
  rotation: number | null; world: WorldIndex[]; filed: { act: number; glance: number; aside: number }; act: string[];
}
export interface Series { dates: string[]; close: number[]; change: (number | null)[]; abnormal: (number | null)[]; vol_ratio: (number | null)[]; p_ret: (number | null)[]; p_vol: (number | null)[] }
export interface Market { as_of: string; series: Record<string, Series> }
