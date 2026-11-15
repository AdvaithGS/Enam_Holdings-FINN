/**
 * Route hit rate: of the people newly appointed in the current digest window, for how many
 * does the network offer a route? Run after each digest:  npm run hits
 *
 * The demo network is synthetic, and three of its contacts were written or edited AFTER
 * seeing real appointees' former employers (FITTED below), which makes any hit they produce
 * in-sample. The report therefore gives the rate twice: with the whole network, and with
 * the fitted contacts removed. The network is frozen (data/network.freeze.json); from the
 * freeze date on, every hit on a newly filed appointment is out of sample, whoever makes it.
 * Each run appends one line to data/route-hits.log.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { Graph } from "../lib/network/graph.ts";
import { peopleFromDigest, personKey } from "../lib/network/public.ts";
import type { Network } from "../lib/network/types.ts";

const FITTED = ["Arvind Nambiar", "Zubin Contractor", "Ankit Jain"];
const MIN = 0.05; // a route counts when even its upper bound clears 5%
const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const netText = readFileSync(new URL("../public/data/network.seed.json", import.meta.url), "utf8");
const net = JSON.parse(netText) as Network, digest = read("../public/data/digest.json"), hierarchy = read("../public/data/hierarchy.json");
const hash = createHash("sha256").update(netText).digest("hex").slice(0, 16);
const freezePath = new URL("../data/network.freeze.json", import.meta.url);
if (process.argv.includes("--freeze") || !existsSync(freezePath)) writeFileSync(freezePath, JSON.stringify({ frozen_on: digest.generated_at.slice(0, 10), sha256_16: hash, contacts: net.contacts.length, fitted: FITTED }, null, 1) + "\n");
const freeze = JSON.parse(readFileSync(freezePath, "utf8"));

const d = new Date(digest.generated_at), now = { year: d.getFullYear(), month: d.getMonth() + 1 };
function rate(n: Network) {
  const g = new Graph(n, now, hierarchy), people = peopleFromDigest(digest, g);
  const rows: { name: string; symbol: string; at: string; background: boolean; best: number; via: string | null }[] = [];
  const seen = new Set<string>();
  for (const e of digest.events) for (const fp of e.people ?? []) {
    if (!["appointed", "redesignated"].includes(fp.action) || fp.tier > 3 || seen.has(personKey(fp))) continue;
    seen.add(personKey(fp));
    const person = people.find((p) => p.id === personKey(fp))!;
    const r = g.reach(person)[0];
    rows.push({ name: fp.name, symbol: e.symbol, at: e.at.slice(0, 10), background: !!(fp.career?.length || fp.education?.length), best: r?.hi ?? 0, via: r?.via?.name ?? null });
  }
  return rows;
}
const all = rate(net), clean = rate({ ...net, contacts: net.contacts.filter((c) => !FITTED.includes(c.name)) });
const hits = (rows: typeof all, since?: string) => rows.filter((r) => r.best >= MIN && (!since || r.at >= since)).length;
const fresh = all.filter((r) => r.at >= freeze.frozen_on);
const line = `${digest.generated_at.slice(0, 10)}  window ${digest.window_days}d  appointees ${all.length}  with a stated background ${all.filter((r) => r.background).length}  ` +
  `route: ${hits(all)} with the full network, ${hits(clean)} without the ${FITTED.length} fitted contacts  |  filed since the freeze (${freeze.frozen_on}): ${fresh.length} appointees, ${hits(all, freeze.frozen_on)} routed` +
  (hash === freeze.sha256_16 ? "" : "  [network changed since the freeze: these numbers are in-sample again]");
console.log(line);
for (const r of all) console.log(`  ${r.at} ${r.symbol.padEnd(10)} ${r.name.padEnd(22)} ${r.background ? "background" : "no background"}  ${r.best >= MIN ? `route up to ${(r.best * 100).toFixed(0)}% via ${r.via ?? "you"}${FITTED.includes(r.via ?? "") ? " (fitted contact)" : ""}` : "no route"}`);
if (!process.argv.includes("--dry")) appendFileSync(new URL("../data/route-hits.log", import.meta.url), line + "\n");
