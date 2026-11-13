import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Market } from "../types.ts";
import { beta, defaults, fieldMove, positions, quantile, risk } from "./risk.ts";

const market = JSON.parse(readFileSync(new URL("../../public/data/market.json", import.meta.url), "utf8")) as Market;
const digest = JSON.parse(readFileSync(new URL("../../public/data/digest.json", import.meta.url), "utf8"));
const weights = Object.fromEntries(Object.values<{ symbol: string; weight: number }>(digest.companies).map((c) => [c.symbol, c.weight]));

test("quantile is an order statistic and beta of a series with itself is 1", () => {
  const x = Array.from({ length: 100 }, (_, i) => i - 50);
  assert.equal(quantile(x, 0.05), -46);   // the 5th worst of 100
  assert.ok(Math.abs(beta(x, x) - 1) < 1e-12);
  assert.ok(Math.abs(beta(x.map((v) => 2 * v + 3), x) - 2) < 1e-12);
});

test("the demo book has the stated weights at entry and adds up", () => {
  const h = defaults(market, weights);
  assert.equal(h.length, 20);
  const cost = h.reduce((a, x) => a + x.qty * x.entry, 0);
  assert.ok(Math.abs(cost / 1e8 - 1) < 0.01, String(cost));
  const p = positions(h, market, 0.15);
  assert.ok(Math.abs(p.reduce((a, x) => a + x.weight, 0) - 1) < 1e-9);
  assert.ok(Math.abs(p.reduce((a, x) => a + x.pnl, 0) - (p.reduce((a, x) => a + x.value, 0) - cost)) < 1e-3);
});

test("expectation: a position held one year at exactly E is neither ahead nor behind", () => {
  const s = market.series.TCS, last = s.close[s.close.length - 1];
  const year = new Date(Date.parse(market.as_of) - 365 * 864e5).toISOString().slice(0, 10);
  const [p] = positions([{ symbol: "TCS", qty: 10, entry: last / 1.15, date: year }], market, 0.15);
  assert.ok(Math.abs(p.gap) < 1e-6 && Math.abs(p.ret - 0.15) < 1e-9);
});

test("risk: VaR is a loss the book exceeded on about 1 day in 20, and shortfall is worse", () => {
  const r = risk(positions(defaults(market, weights), market, 0.15), market)!;
  assert.ok(r.sessions >= 200 && r.var95 > 0.003 && r.var95 < 0.05, String(r.var95));
  assert.ok(r.shortfall >= r.var95 && r.beta > 0.5 && r.beta < 1.6 && r.te > 0);
  assert.equal(r.rolling.filter((x) => x !== null).length, r.sessions - 59);
});

test("a field move is ranked against the same stocks' own history", () => {
  const f = fieldMove(["SRF", "DEEPAKNTR"], market)!;
  assert.ok(f.p > 0 && f.p <= 1 && f.n > 100);
  assert.equal(fieldMove(["SRF"], market), null);
});
