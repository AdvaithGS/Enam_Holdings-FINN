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
export function Detail({ children, fallback }: { children: React.ReactNode; fallback?: boolean }) {
  const wide = useWide();
  const [pane, setPane] = useState<HTMLElement | null>(null);
  useEffect(() => setPane(document.getElementById("pane")), [wide]);
  if (wide) return pane ? createPortal(<div className="detail">{children}</div>, pane) : null;
  return fallback ? null : <div className="detail">{children}</div>;
}

export function State({ kind, title, children }: { kind: "loading" | "empty" | "error"; title?: string; children?: React.ReactNode }) {
  if (kind === "loading") return <div className="state" role="status" aria-label="Loading">{[72, 96, 60, 88, 52].map((w, i) => <div key={i} className="skel" style={{ width: `${w}%` }} />)}</div>;
  return <div className="state" role={kind === "error" ? "alert" : "status"}><h2>{title}</h2>{children}</div>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [person, setPerson] = useState<string | null>(null);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href) || (href === "/ask" && path.startsWith("/research")));
  return (
    <StoreProvider>
      <SheetCtx.Provider value={setPerson}>
        <nav className="nav" aria-label="Sections">
          <div>
            <span className="wordmark">FINN</span>
            {TABS.map((t) => <Link key={t.href} href={t.href} className={active(t.href) ? "on" : ""} aria-current={active(t.href) ? "page" : undefined}>{t.label}</Link>)}
          </div>
        </nav>
        <div className="frame">
          <main className="app">{children}</main>
          <aside id="pane" aria-label="Evidence" />
        </div>
        {person && <PersonSheet id={person} onClose={() => setPerson(null)} />}
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
