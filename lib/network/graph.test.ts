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

test("subsidiaries named in annual reports resolve to the parent, existing nodes keep their own id", () => {
  const h = new Graph(net, now, { KAYNES: ["Iskraemeco India Private Limited", "Kaynes Semicon Private Limited"], RELIANCE: ["Jio Platforms Limited", "Reliance New Energy Limited"] });
  assert.equal(h.orgId("Iskraemeco India Pvt. Ltd."), "kaynes");
  assert.equal(h.orgId("Reliance New Energy Limited"), "reliance");
  assert.equal(h.orgId("Jio Platforms Limited"), "jio");        // already a node, with reliance as parent
  assert.equal(g.orgId("Iskraemeco India Private Limited"), null);
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

test("knows: dated overlap is 1-(1-q)^y, and the range brackets the point", () => {
  const rhea = by("Rhea Kapadia"), tanvi = by("Tanvi Agarwal");
  // both at Trent (mid, q=.25), same function (x2), one senior (x1.5), different business units (x0.3) => q=.225; 2015..2019 = 5 years
  const k = g.knows(rhea, tanvi);
  assert.ok(Math.abs(k.p - (1 - Math.pow(1 - 0.225, 5))) < 1e-9, String(k.p));
  assert.ok(k.lo < k.p && k.p < k.hi && k.hi <= 1);
  assert.equal(g.knows(by("Hemant Joshi"), by("Sneha Reddy")).p, 0);
});

test("knows: an undated former employer cannot yield more than the chance the stints overlapped", () => {
  // a filing says the appointee was once at ICICI Bank, no dates; Meera has been there since 2020
  const appointee: Person = { id: "t", name: "V. N. Srivatsan", headline: "", education: [],
    roles: [{ org: "icici", title: "Head, Compliance", from: 0, to: 0, fn: "legal", level: 2 }] };
  const k = g.knows(by("Meera Iyer"), appointee);
  assert.ok(k.hi < 0.5 && k.lo < 0.1 && k.p > k.lo && k.p < k.hi, JSON.stringify(k));
  assert.match(k.why[0], /dates not stated; .*% likely the stints overlapped/);
});

test("a board seat links a director to directors and top executives only", () => {
  const chair: Person = { id: "t", name: "Noel N. Tata", headline: "", education: [],
    roles: [{ org: "trent", title: "Chairman", from: 0, to: 2026, fn: "board", level: 1 }] };
  assert.equal(g.reach(chair).length, 0);   // a head of merchandising and a buyer did not "work with" the chairman
  const ceo: Person = { id: "c", name: "A B", headline: "", education: [], roles: [{ org: "trent", title: "CEO", from: 2014, to: 2022, fn: "general", level: 1 }] };
  assert.ok(g.knows(chair, ceo).p > 0.3);
  assert.ok(g.knows(by("Nandini Krishnan"), { ...ceo, roles: [{ org: "bandhan", title: "Branch manager", from: 2019, to: null, fn: "sales", level: 3 }] }).p === 0);
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

test("reach: a two-step path is tie x link, never exceeds either, and carries its range", () => {
  const target: Person = { id: "t", name: "Some Executive", headline: "", education: [],
    roles: [{ org: "trent", title: "Chief Financial Officer", from: 2014, to: 2020, fn: "finance", level: 1 }] };
  const r = g.reach(target);
  assert.ok(r.length > 0);
  for (const x of r) { assert.ok(x.strength <= x.tie + 1e-12 && x.strength <= x.link + 1e-12 && x.lo <= x.strength && x.strength <= x.hi); }
  assert.ok(["Rhea Kapadia", "Tanvi Agarwal"].includes(r[0].via!.name));
});

test("connectors: PageRank is a probability distribution and rewards bridges", () => {
  const target: Person = { id: "t", name: "Some Executive", headline: "", education: [],
    roles: [{ org: "trent", title: "Chief Financial Officer", from: 2014, to: 2020, fn: "finance", level: 1 }] };
  const c = g.connectors([target], 40);
  assert.ok(c.every((x) => x.score > 0 && x.score < 1));
  assert.ok(c.reduce((a, x) => a + x.score, 0) < 1);
  assert.ok(c[0].doors.some((p) => p.name === "Some Executive"));
});

test("coverage is by business: Reliance is five businesses and one contact does not cover them", () => {
  const c = g.coverage("reliance");
  assert.equal(c.segments.length, 5);
  const by = Object.fromEntries(c.segments.map((s) => [s.segment.id, s.leads.map((l) => l.person.name)]));
  assert.ok(by.retail.includes("Tanvi Agarwal") && !by.digital.includes("Tanvi Agarwal"));
  assert.ok(by.digital.includes("Imran Qureshi"));
  assert.deepEqual(by.o2c, []);
  assert.ok(c.covered < 1 && c.covered > 0);
  const lt = g.coverage("lt");
  assert.deepEqual(lt.segments.filter((s) => s.leads.length).map((s) => s.segment.id), ["hydrocarbon"]);
});

test("expertise: the theme map ranks practitioners first", () => {
  const e = g.expertise("specialty-chemicals");
  assert.ok(e.length >= 3);
  assert.ok(["Hemant Joshi", "Shruti Deshpande", "Priya Venkataraman", "Nikhil Shah"].includes(e[0].person.name));
  assert.ok(e.every((x) => x.expertise > 0 && x.expertise < 1));
});
