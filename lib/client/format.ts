export const pct = (x: number | null | undefined, digits = 0, sign = true) =>
  x === null || x === undefined || !isFinite(x) ? "–" : `${sign && x > 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;

/** Rupees crore, compact: 1,23,456 cr -> "1.23 lakh cr" */
export function crore(x: number | null | undefined): string {
  if (x === null || x === undefined || !isFinite(x)) return "–";
  const a = Math.abs(x);
  if (a < 0.1) return `${(x * 100).toFixed(a < 0.01 ? 2 : 1)} lakh`; // under ₹10 lakh, crores hide the figure
  if (a >= 1e5) return `${(x / 1e5).toFixed(2)} lakh cr`;
  if (a >= 100) return `${Math.round(x).toLocaleString("en-IN")} cr`;
  if (a >= 10) return `${x.toFixed(1)} cr`;
  return `${x.toFixed(2)} cr`;
}
export const num = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined || !isFinite(x) ? "–" : x.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const tone = (x: number | null | undefined) => (x === null || x === undefined ? "" : x > 0 ? "up" : x < 0 ? "down" : "");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");
/** Indian date format: dd/mm/yyyy */
export function day(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export function dayTime(iso: string): string {
  const d = new Date(iso);
  return `${day(iso)}, ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
export function monthYear(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
export function ago(months: number): string {
  if (months < 1) return "this month";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const y = Math.floor(months / 12), m = months % 12;
  return m >= 3 ? `${y}y ${m}m ago` : `${y} year${y === 1 ? "" : "s"} ago`;
}
/** "1 in N" for a probability */
export const oneIn = (p: number) => `1 in ${Math.max(1, Math.round(1 / p)).toLocaleString("en-IN")}`;

/** A signed percentage: the sign carries the meaning, colour only repeats it. */
export const signed = (x: number | null | undefined, digits = 1) => (x === null || x === undefined || !isFinite(x) ? "\u2013" : `${x > 0 ? "+" : x < 0 ? "\u2212" : ""}${Math.abs(x * 100).toFixed(digits)}%`);
