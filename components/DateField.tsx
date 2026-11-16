"use client";
import { useEffect, useState } from "react";

/** A date typed and shown as dd/mm/yyyy, whatever the browser's locale. Value in and out is ISO (yyyy-mm-dd). */
export function DateField({ value, max, onChange }: { value?: string; max?: string; onChange: (iso: string) => void }) {
  const show = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "");
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text), iso = m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  const ok = !!iso && !isNaN(Date.parse(iso)) && (!max || iso <= max);
  return <input className="datef" inputMode="numeric" placeholder="dd/mm/yyyy" aria-label="Date, dd/mm/yyyy" aria-invalid={text !== "" && !ok} value={text} maxLength={10}
    onChange={(e) => { const d = e.target.value.replace(/[^\d]/g, "").slice(0, 8); setText([d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("/")); }}
    onBlur={() => ok && iso !== value && onChange(iso!)} onKeyDown={(e) => { if (e.key === "Enter" && ok) onChange(iso!); }} />;
}
