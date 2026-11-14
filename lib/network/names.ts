/**
 * Matching a name printed in a filing to a person or organisation we already hold.
 *
 * People. A filing writes "Mr. Noel N. Tata"; a contact list says "Noel Tata". Two
 * names are compatible when, after dropping honorifics and punctuation,
 *   - the surnames (last tokens) are equal, and
 *   - the remaining tokens of the shorter name can be matched, in order, to tokens of
 *     the longer one, where an initial matches any token starting with that letter.
 * Compatibility alone is "possible" (common names collide). It becomes "confirmed"
 * only with independent corroboration: an organisation the two records share.
 */

const HONORIFIC = /^(mr|mrs|ms|miss|dr|shri|smt|prof|sri|ca|cs|adv)$/;

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !HONORIFIC.test(t));
}

function tokenFits(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

/** 0 = different people, 1 = compatible with initials or missing middle names, 2 = identical tokens */
export function nameMatch(x: string, y: string): 0 | 1 | 2 {
  const a = nameTokens(x), b = nameTokens(y);
  if (a.length < 2 || b.length < 2) return 0;
  if (a[a.length - 1] !== b[b.length - 1]) return 0;
  if (a.join(" ") === b.join(" ")) return 2;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // first names must fit; a bare shared surname is not a match
  if (!tokenFits(short[0], long[0])) return 0;
  if (short[0].length === 1 && long[0].length === 1 && short.length === 2 && long.length === 2) return 1;
  let j = 0;
  for (const t of short.slice(0, -1)) {
    while (j < long.length - 1 && !tokenFits(t, long[j])) j++;
    if (j >= long.length - 1) return 0;
    j++;
  }
  // "N Tata" vs "Noel Tata": an initial-only first name is weak evidence
  return 1;
}

const ORG_NOISE = /\b(limited|ltd|pvt|private|inc|llp|plc|corp|corporation|company|co|the|india|group|industries|and|holdings?)\b/g;

export function orgKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(ORG_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}
