import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { themeCompanies, type UCo } from "./universe.ts";

const uni = JSON.parse(readFileSync(new URL("../../public/data/universe.json", import.meta.url), "utf8")) as UCo[];
const top = (q: string, n = 5) => themeCompanies(q, uni, n).map((h) => h.co.s);

test("a theme finds the company whose business it is, even when no segment is named after it", () => {
  assert.equal(top("adhesives")[0], "PIDILITIND");
  assert.equal(top("adhesivs")[0], "PIDILITIND");   // and survives a typo
});

test("pure plays outrank a segment that merely carries the word, and results are ordered", () => {
  const hits = themeCompanies("retail", uni, 8);
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].score >= hits[i].score);
  assert.ok(top("retail", 6).some((s) => ["TRENT", "DMART", "ABFRL", "VMM", "SHOPERSTOP"].includes(s)), top("retail", 6).join(","));
  assert.ok(top("paints", 3).includes("ASIANPAINT") && !top("paints", 5).includes("CAPLIPOINT"));
});

test("a passing mention deep in a description is not a result", () => {
  assert.ok(!top("adhesives").includes("NUVOCO"));
  assert.deepEqual(top("EV battery raw materials"), []);   // no company is that; the concept map answers it with people
});

test("nonsense finds nothing", () => assert.deepEqual(top("zzqxv"), []));
