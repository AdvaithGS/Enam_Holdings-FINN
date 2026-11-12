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
  amount?: { cr: number; rho: number; quote: string; line_cr: number; leg: string; from: string };
  market?: { change: number | null; abnormal: number | null; vol_ratio: number | null; p_ret: number | null; p_vol: number | null };
}
export interface Company {
  symbol: string; name: string; legal_name?: string; sector: string; industry?: string; mcap_cr?: number;
  line?: { cr: number; leg: string } | null; beta?: number | null;
}
export interface Digest {
  generated_at: string; as_of: string; window_days: number;
  model: { baseline: number; act: number; alpha: number; sessions: number; categories: Record<string, { n: number; p: number; lift: number; lo: number; hi: number }> };
  labels: Record<string, string>; companies: Record<string, Company>; events: FinnEvent[];
  run: { filings: number; events: number; documents_read: number; seconds: number; ocr_pages: number; llm_available: boolean;
         llm: { calls: number; cache_hits: number; input_tokens: number; output_tokens: number } };
}
export interface Series { dates: string[]; close: number[]; change: (number | null)[]; abnormal: (number | null)[]; vol_ratio: (number | null)[]; p_ret: (number | null)[]; p_vol: (number | null)[] }
export interface Market { as_of: string; series: Record<string, Series> }
