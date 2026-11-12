import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Graph, overlapYears, tieStrength } from "./graph.ts";
import { nameMatch, orgKey } from "./names.ts";
import type { Network, Person } from "./types.ts";

const net = JSON.parse(readFileSync(new URL("../../public/data/network.seed.json", import.meta.url), "utf8")) as Network;
const now = { year: 2026, month: 11 };
const g = new Graph(net, now);
const by = (name: string) => net.contacts.find((c) => c.name === name)!;

test("names: initials and honorifics are compatible, different first names are not", () => {
  assert.equal(nameMatch("Mr. Noel N. Tata", "Noel Tata"), 1);
  assert.equal(nameMatch("Noel N Tata", "Noel N. Tata"), 2);
  assert.equal(nameMatch("Ratan Tata", "Noel Tata"), 0);
  assert.equal(nameMatch("N. Tata", "Noel Tata"), 1);
  assert.equal(nameMatch("Tata", "Noel Tata"), 0);
  assert.equal(nameMatch("Meera R. Iyer", "Meera Iyer"), 1);
  assert.equal(nameMatch("Meera Iyer", "Meera Nair"), 0);
});

test("orgs: legal suffixes do not matter", () => {
  assert.equal(orgKey("Kaynes Technology India Limited"), orgKey("Kaynes Technology"));
  assert.equal(g.orgId("One 97 Communications Limited"), "paytm");
  assert.equal(g.orgId("Hindustan Unilever Ltd., Mumbai"), "hul");
  assert.equal(g.orgId("Some Unknown Pvt Ltd"), null);
});

test("tie strength halves every 36 quiet months", () => {
  const p: Person = { id: "x", name: "A B", headline: "", roles: [], education: [], tie: { closeness: 3, how: "", since: 2010, last: "2023-11" } };
  assert.ok(Math.abs(tieStrength(p, now) - 0.45) < 1e-9);
});

test("overlap counts whole years inclusively", () => {
  const a = { org: "x", title: "", from: 2014, to: 2016, fn: "sales", level: 3 } as const;
  const b = { org: "x", title: "", from: 2016, to: 2020, fn: "sales", level: 3 } as const;
  assert.equal(overlapYears(a, b, now), 1);
  assert.equal(overlapYears(a, { ...b, from: 2017 }, now), 0);
});

test("knows: probability follows 1-(1-q)^y and needs real overlap", () => {
  const rhea = by("Rhea Kapadia"), tanvi = by("Tanvi Agarwal");
  // both at Trent (mid, q=.25), same function (x2), one senior (x1.5) => q=.75, overlap 2015..2019 = 5 years
  const k = g.knows(rhea, tanvi);
  assert.ok(Math.abs(k.p - (1 - Math.pow(0.25, 5))) < 1e-9, String(k.p));
  assert.equal(g.knows(by("Hemant Joshi"), by("Sneha Reddy")).p, 0);
});

test("who to call: an insider-turned-competitor outranks a same-theme acquaintance", () => {
  const leads = g.whoToCall("kaynes", ["operations"]);
  assert.equal(leads[0].person.name, "Anitha Rao");
  assert.ok(leads.every((l, i) => i === 0 || leads[i - 1].score >= l.score));
  const trent = g.whoToCall("trent");
  // Tanvi bought for Zudio until 2019 but runs a competing category today: the fresher role wins
  assert.deepEqual(trent.slice(0, 2).map((l) => l.person.name).sort(), ["Rhea Kapadia", "Tanvi Agarwal"]);
  // knowledge from several roles combines but stays a probability
  assert.ok(trent.every((l) => l.knowledge > 0 && l.knowledge < 1));
  assert.ok(g.whoToCall("reliance").find((l) => l.person.name === "Tanvi Agarwal")!.insider);
  // a fashion buyer at Reliance Retail is no guide to Bharti Airtel, though Jio is its rival
  assert.ok(!g.whoToCall("bharti").some((l) => l.person.name === "Tanvi Agarwal"));
});

test("reach: a two-step path is tie x link and never exceeds either", () => {
  const target: Person = { id: "t", name: "Noel N. Tata", headline: "", education: [],
    roles: [{ org: "trent", title: "Chairman", from: 0, to: 2026, fn: "board", level: 1 }] };
  const r = g.reach(target);
  assert.ok(r.length > 0);
  for (const x of r) { assert.ok(x.strength <= x.tie + 1e-12 && x.strength <= x.link + 1e-12); }
  assert.ok(["Rhea Kapadia", "Tanvi Agarwal"].includes(r[0].via!.name));
});

test("expertise: the theme map ranks practitioners first", () => {
  const e = g.expertise("specialty-chemicals");
  assert.ok(e.length >= 3);
  assert.ok(["Hemant Joshi", "Shruti Deshpande", "Priya Venkataraman", "Nikhil Shah"].includes(e[0].person.name));
  assert.ok(e.every((x) => x.expertise > 0 && x.expertise < 1));
});
