import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Graph } from "./graph.ts";
import { alike, findPeople, masked, plan } from "./search.ts";
import type { Network } from "./types.ts";

const net = JSON.parse(readFileSync(new URL("../../public/data/network.seed.json", import.meta.url), "utf8")) as Network;
const g = new Graph(net, { year: 2026, month: 11 });
const ask = (q: string) => { const p = plan(g, q, net.contacts); return { p, hits: findPeople(g, p) }; };
const names = (q: string) => ask(q).hits.map((h) => h.person.name);

test("typos: transpositions and dropped letters still match, unrelated words do not", () => {
  assert.ok(alike("reha", "rhea") >= 0.74 && alike("semiconducter", "semiconductor") > 0.8);
  assert.equal(alike("paint", "plant"), 0);
  assert.equal(alike("bank", "tank"), 0);
  assert.equal(alike("car", "cat"), 0);
  assert.equal(ask("Reha Kapadia").p.people[0].person.name, "Rhea Kapadia");
  assert.equal(ask("suresh gowda").p.people[0].person.name, "Suresh Gowda");
});

test("supply chains are followed as edges: raw-material suppliers to battery makers are chemists", () => {
  const { p, hits } = ask("Who do I know that understands the raw material suppliers for battery manufacturers?");
  assert.equal(p.direction, "inputs");
  assert.ok(p.concepts.some((c) => c.id === "battery-materials" && c.via === "Battery cells"));
  assert.ok(p.themes.has("specialty-chemicals") && !p.themes.has("autos"));
  assert.ok(["Hemant Joshi", "Shruti Deshpande", "Priya Venkataraman", "Nikhil Shah"].includes(hits[0].person.name), hits[0].person.name);
});

test("'EV supply chain' covers the vehicle makers and what feeds them", () => {
  const { p, hits } = ask("EV supply chain");
  assert.equal(p.direction, "chain");
  assert.ok(p.themes.has("autos") && p.themes.has("specialty-chemicals") && p.themes.has("semiconductors"));
  assert.ok(hits.length >= 4);
});

test("relations on a named company: customers of Dixon, competitors of Trent", () => {
  assert.equal(names("who buys from Dixon? customers of dixon")[0], "Gaurav Sethi");
  assert.ok(names("competitors of trent").slice(0, 2).some((n) => ["Rhea Kapadia", "Tanvi Agarwal"].includes(n)));
});

test("plain words nobody anticipated still find the person whose career says them", () => {
  assert.equal(names("someone who has sat through an fda inspection")[0], "Alok Banerjee");
  assert.equal(names("microfinanse borrower stress in karnataka")[0], "Suresh Gowda");
});

test("no network name survives masking", () => {
  const m = masked("what would Rhea Kapadia or Hemant say about fluorine pricing?", net.contacts);
  assert.ok(!/rhea|kapadia|hemant/i.test(m) && /fluorine pricing/.test(m), m);
});
