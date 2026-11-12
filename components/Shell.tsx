"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState } from "react";
import { StoreProvider } from "@/lib/client/store";
import { PersonSheet } from "./PersonSheet";

const SheetCtx = createContext<(id: string | null) => void>(() => {});
export const useOpenPerson = () => useContext(SheetCtx);

const TABS = [
  { href: "/", label: "Brief", sub: "what changed" },
  { href: "/ask", label: "Ask", sub: "dig in" },
  { href: "/network", label: "People", sub: "who knows" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [person, setPerson] = useState<string | null>(null);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href) || (href === "/ask" && path.startsWith("/research")));
  return (
    <StoreProvider>
      <SheetCtx.Provider value={setPerson}>
        <main className="app">{children}</main>
        <nav className="nav" aria-label="Sections">
          <div>
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} className={active(t.href) ? "on" : ""} aria-current={active(t.href) ? "page" : undefined}>
                <b>{t.label}</b>{t.sub}
              </Link>
            ))}
          </div>
        </nav>
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
