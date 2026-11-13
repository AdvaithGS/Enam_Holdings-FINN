"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { defaults, type Holding } from "../portfolio/risk.ts";
import { useStore } from "./store";

const KEY = "finn.holdings.v1", EKEY = "finn.expect.v1";

/** Holdings live on the device, like the network. The demo book is built from stated weights. */
export function useHoldings() {
  const { digest, market, loadMarket } = useStore();
  const [own, setOwn] = useState<Holding[] | null>(null);
  const [expect, setE] = useState(0.15);
  useEffect(loadMarket, [loadMarket]);
  useEffect(() => {
    try {
      const h = localStorage.getItem(KEY); if (h) setOwn(JSON.parse(h));
      const e = localStorage.getItem(EKEY); if (e) setE(Number(e));
    } catch { /* demo book */ }
  }, []);
  const seed = useMemo(() => (digest && market ? defaults(market, Object.fromEntries(Object.values(digest.companies).map((c) => [c.symbol, c.weight]))) : null), [digest, market]);
  const holdings = own ?? seed;
  const save = useCallback((h: Holding[] | null) => {
    setOwn(h);
    try { if (h) localStorage.setItem(KEY, JSON.stringify(h)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  }, []);
  const setExpect = useCallback((e: number) => { setE(e); try { localStorage.setItem(EKEY, String(e)); } catch { /* ignore */ } }, []);
  return { holdings, save, custom: own !== null, expect, setExpect, market, digest };
}
