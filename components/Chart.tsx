"use client";
import { useRef, useState } from "react";

export interface Series { name: string; color: string; values: (number | null)[]; kind: "bar" | "line" | "area"; fmt?: (v: number) => string; own?: boolean }

/**
 * One small chart for everything: grouped bars and lines on a shared zero-based scale
 * (a series marked `own` gets its own scale, for ratios beside rupees). Drag or tap to
 * read any column; the readout above the plot is the legend.
 */
export function Chart({ labels, series, height = 130, start, note }: { labels: string[]; series: Series[]; height?: number; start?: number; note?: (i: number) => string | null }) {
  const n = labels.length, W = 340, H = height, padB = 16, padT = 6;
  const [sel, setSel] = useState(start ?? n - 1);
  const ref = useRef<SVGSVGElement>(null);
  const i = Math.min(sel, n - 1);
  if (n === 0) return null;
  const shared = series.filter((s) => !s.own).flatMap((s) => s.values).filter((v): v is number => v !== null);
  const dense = series.every((s) => s.kind !== "bar");
  const range = (vals: number[], zero: boolean) => { const lo = Math.min(...vals, zero ? 0 : Infinity), hi = Math.max(...vals, zero ? 0 : -Infinity); return hi === lo ? [lo - 1, hi + 1] : [lo, hi]; };
  const [lo, hi] = shared.length ? range(shared, !dense) : [0, 1];
  const y = (v: number, a = lo, b = hi) => padT + (1 - (v - a) / (b - a)) * (H - padT - padB);
  const step = W / n, x = (k: number) => (dense ? (n === 1 ? W / 2 : (k / (n - 1)) * (W - 8) + 4) : k * step + step / 2);
  const bars = series.filter((s) => s.kind === "bar"), bw = Math.min(26, (step * 0.72) / Math.max(1, bars.length));
  const pick = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    setSel(Math.max(0, Math.min(n - 1, dense ? Math.round(f * (n - 1)) : Math.floor(f * n))));
  };
  const every = Math.ceil(n / 7);
  return (
    <div>
      <div className="readout" aria-live="polite">
        <span className="lab">{labels[i]}</span>
        {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name} <b>{s.values[i] === null ? "–" : (s.fmt ?? ((v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })))(s.values[i]!)}</b></span>)}
        {note?.(i) && <span className="muted">{note(i)}</span>}
      </div>
      <table className="sr"><caption>{series.map((s) => s.name).join(", ")}</caption><tbody>
        {labels.filter((_, k) => n <= 24 || k % Math.ceil(n / 24) === 0 || k === n - 1).map((l) => { const k = labels.indexOf(l); return <tr key={l}><th>{l}</th>{series.map((s) => <td key={s.name}>{s.values[k] ?? ""}</td>)}</tr>; })}
      </tbody></table>
      <svg ref={ref} className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${series.map((s) => s.name).join(", ")}: ${labels[0]} to ${labels[n - 1]}. ${series.map((s) => { const v = s.values.filter((x): x is number => x !== null); return v.length ? `${s.name} from ${v[0].toFixed(2)} to ${v[v.length - 1].toFixed(2)}` : ""; }).join("; ")}`}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); pick(e); }} onPointerMove={(e) => (e.buttons || e.pointerType === "mouse") && pick(e)}>
        {dense ? <line x1={x(i)} x2={x(i)} y1={padT} y2={H - padB} stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="2 3" />
          : <rect x={i * step + 1} y={0} width={step - 2} height={H - padB + 2} rx="5" fill="var(--wash)" />}
        {!dense && lo < 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--ink-3)" strokeWidth="0.75" />}
        {bars.map((s, b) => s.values.map((v, k) => v === null ? null : (
          <rect key={`${s.name}${k}`} x={x(k) - (bars.length * bw) / 2 + b * bw + 0.75} width={bw - 1.5} y={Math.min(y(v), y(0))} height={Math.max(1, Math.abs(y(v) - y(0)))} rx="2"
            fill={s.color} opacity={k === i ? 1 : 0.62} />)))}
        {series.filter((s) => s.kind !== "bar").map((s) => {
          const vals = s.values.filter((v): v is number => v !== null);
          if (!vals.length) return null;
          const [a, b] = s.own ? range(vals, false) : [lo, hi];
          const pts = s.values.map((v, k) => (v === null ? null : `${x(k).toFixed(1)},${y(v, a, b).toFixed(1)}`)).filter(Boolean);
          return (
            <g key={s.name}>
              {s.kind === "area" && <polygon points={`${x(s.values.findIndex((v) => v !== null))},${H - padB} ${pts.join(" ")} ${x(n - 1)},${H - padB}`} fill={s.color} opacity="0.12" />}
              <polyline points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {s.values[i] !== null && <circle cx={x(i)} cy={y(s.values[i]!, a, b)} r="3.6" fill="var(--card)" stroke={s.color} strokeWidth="2" />}
            </g>
          );
        })}
        {labels.map((l, k) => (dense ? k % Math.ceil(n / 4) === 0 : k % every === 0 || k === n - 1) && (
          <text key={k} x={Math.min(W - 14, Math.max(14, x(k)))} y={H - 3} textAnchor="middle" fontSize="9.5" fill="var(--ink-3)">{l.length > 7 ? l.slice(5) : l}</text>))}
      </svg>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <span className="seg" role="tablist">{options.map(([k, label]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{label}</button>)}</span>;
}
