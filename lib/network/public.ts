/**
 * People named in filings become nodes too: public facts only, from the filing itself.
 * Pure (no browser), so the same code builds the app's graph and the route hit-rate report.
 */
import type { Graph } from "./graph.ts";
import { nameTokens, orgKey } from "./names.ts";
import type { Fn, Person, Role } from "./types.ts";

interface FiledPersonLike { name: string; role: string; action: string; tier: number;
  career?: { org: string; role?: string; from_year?: number; to_year?: number }[]; education?: { school: string; degree?: string; year?: number }[] }
interface DigestLike { companies: Record<string, { name: string }>; events: { symbol: string; at: string; url: string | null; people?: FiledPersonLike[] }[] }

function fnOf(title: string): Fn {
  const t = title.toLowerCase();
  if (/financ|cfo|treasur|account/.test(t)) return "finance";
  if (/independent|non-?\s*executive|chairman|chairperson|director/.test(t) && !/managing|executive director|whole/.test(t)) return "board";
  if (/operat|coo|plant|manufactur|supply/.test(t)) return "operations";
  if (/technolog|cto|digital|engineer/.test(t)) return "technology";
  if (/legal|counsel|compliance|secretar/.test(t)) return "legal";
  if (/risk|credit/.test(t)) return "risk";
  if (/sales|market|business head|commercial/.test(t)) return "sales";
  if (/human|people|hr\b/.test(t)) return "hr";
  return "general";
}
const year = (iso: string) => Number(iso.slice(0, 4));

/** People named in filings become nodes too: public facts only, from the filing itself. */
export function peopleFromDigest(digest: DigestLike, graph: Graph): Person[] {
  const out = new Map<string, Person>();
  for (const e of digest.events) {
    for (const fp of e.people ?? []) {
      const key = "p:" + nameTokens(fp.name).join("-");
      const company = graph.orgId(e.symbol) ?? `x:${orgKey(digest.companies[e.symbol]?.name ?? e.symbol)}`;
      const leaving = ["resigned", "retired", "ceased", "died"].includes(fp.action);
      const roles: Role[] = [{
        org: company, title: fp.role, fn: fnOf(fp.role), level: fp.tier <= 1 ? 1 : fp.tier === 2 ? 2 : fp.tier === 3 ? 1 : 3,
        from: leaving ? 0 : year(e.at), to: leaving ? year(e.at) : null,
      }];
      for (const c of fp.career ?? []) {
        const org = graph.orgId(c.org) ?? `x:${orgKey(c.org)}`;
        if (org === company && !c.from_year) continue;
        roles.push({ org, title: c.role || "role not stated", fn: fnOf(c.role ?? ""), level: 2, from: c.from_year ?? 0, to: c.to_year ?? (c.from_year ? c.from_year : 0) });
      }
      const prev = out.get(key);
      const person: Person = {
        id: key, name: fp.name, headline: `${fp.role}, ${digest.companies[e.symbol]?.name ?? e.symbol}`,
        roles: prev ? [...prev.roles, ...roles.filter((r) => !prev.roles.some((x) => x.org === r.org && x.title === r.title))] : roles,
        education: (fp.education ?? []).map((s) => ({ school: s.school, degree: s.degree, to: s.year ?? 0 })),
        source: { label: `Exchange filing, ${e.at.slice(0, 10)}`, url: e.url },
      };
      out.set(key, person);
    }
  }
  return [...out.values()];
}
export const personKey = (fp: { name: string }) => "p:" + nameTokens(fp.name).join("-");

