"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { StoreProvider } from "@/lib/client/store";
import { PersonSheet } from "./PersonSheet";

const SheetCtx = createContext<(id: string | null) => void>(() => {});
export const useOpenPerson = () => useContext(SheetCtx);

const TABS = [{ href: "/", label: "Brief" }, { href: "/book", label: "Book" }, { href: "/ask", label: "Ask" }, { href: "/network", label: "People" }];

/** True on a laptop-width screen, where the selected item's evidence has its own pane. */
export function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/**
 * Evidence for the selected item. On a laptop it fills the right-hand pane; on a phone it
 * opens in place, under the row that was tapped. `fallback` marks content shown when nothing
 * is selected (wide screens only).
 */
/** Ask whatever owns the selection to clear it (a sheet was dismissed). */
export const closeDetail = () => window.dispatchEvent(new Event("finn:close"));
export function useOnClose(fn: () => void) {
  useEffect(() => { window.addEventListener("finn:close", fn); return () => window.removeEventListener("finn:close", fn); }, [fn]);
}

/**
 * The detail card: every event, holding, person and company opens in this one component.
 * At 1024 px and up it fills the right pane. Below that it is a bottom sheet with a handle,
 * closed by swiping down, by Esc, or by tapping outside. `fallback` content shows only in
 * the pane, when nothing is selected.
 */
export function Detail({ children, fallback, onClose }: { children: React.ReactNode; fallback?: boolean; onClose?: () => void }) {
  const wide = useWide();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const close = onClose ?? closeDetail;
  useEffect(() => setHost(wide ? document.getElementById("pane") : document.body), [wide]);
  useEffect(() => {
    if (fallback) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [fallback, close]);
  if (!host) return null;
  if (wide) return createPortal(<div className="detail" role="region" aria-label="Details">{children}</div>, host);
  if (fallback) return null;
  let y0 = 0;
  return createPortal(
    <div className="dsheet" role="dialog" aria-modal="true" aria-label="Details" onClick={close}>
      <div onClick={(e) => e.stopPropagation()} onTouchStart={(e) => { y0 = e.currentTarget.scrollTop === 0 ? e.touches[0].clientY : -1; }}
        onTouchEnd={(e) => { if (y0 >= 0 && e.changedTouches[0].clientY - y0 > 90) close(); }}>
        <button className="handle" onClick={close} aria-label="Close details" autoFocus />
        <div className="detail">{children}</div>
      </div>
    </div>, host);
}

export function State({ kind, title, children }: { kind: "loading" | "empty" | "error"; title?: string; children?: React.ReactNode }) {
  if (kind === "loading") return <div className="state" role="status" aria-label="Loading">{[72, 96, 60, 88, 52].map((w, i) => <div key={i} className="skel" style={{ width: `${w}%` }} />)}</div>;
  return <div className="state" role={kind === "error" ? "alert" : "status"}><h2>{title}</h2>{children}</div>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [person, setPerson] = useState<string | null>(null);
  const [theme, setTheme] = useState("light");
  useEffect(() => setTheme(document.documentElement.dataset.theme ?? "light"), []);
  const flip = () => { const t = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = t; setTheme(t); try { localStorage.setItem("finn.theme", t); } catch { /* private mode */ } };
  // arrow keys move through any list of rows
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const rows = [...document.querySelectorAll<HTMLElement>("main .vrow, main .rowi, main .one, main .tbl tbody tr button")], i = rows.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href) || (href === "/ask" && path.startsWith("/research")));
  return (
    <StoreProvider>
      <SheetCtx.Provider value={setPerson}>
        <nav className="nav" aria-label="Sections">
          <div>
            <span className="wordmark">FINN</span>
            {TABS.map((t) => <Link key={t.href} href={t.href} className={active(t.href) ? "on" : ""} aria-current={active(t.href) ? "page" : undefined}>{t.label}</Link>)}
            <button className="theme" onClick={flip} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
          </div>
        </nav>
        <div className="frame">
          <main className="app">{children}</main>
          <aside id="pane" aria-label="Evidence" />
        </div>
        {person && <Detail onClose={() => setPerson(null)}><div className="pcard"><PersonSheet id={person} onClose={() => setPerson(null)} /></div></Detail>}
      </SheetCtx.Provider>
    </StoreProvider>
  );
}

export function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="scrim" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="grab" onClick={onClose} aria-label="Close" style={{ display: "block" }} />
        {children}
      </div>
    </div>
  );
}
