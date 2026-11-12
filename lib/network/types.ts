export type Seniority = 1 | 2 | 3 | 4; // 1 board/CXO, 2 VP/head, 3 manager, 4 individual
export type Fn = "general" | "finance" | "operations" | "sales" | "technology" | "legal" | "strategy" | "risk" | "hr" | "investing" | "board";

export interface Role {
  org: string; // org id
  title: string;
  from: number; // year
  to: number | null; // null = present
  fn: Fn;
  level: Seniority;
}
export interface Study { school: string; degree?: string; from?: number; to: number }

export interface Person {
  id: string;
  name: string;
  headline: string;
  city?: string;
  roles: Role[];
  education: Study[];
  /** only for people the investor actually knows */
  tie?: { closeness: 1 | 2 | 3; how: string; since: number; last: string /* YYYY-MM */; note?: string };
  /** where a public person's facts came from */
  source?: { label: string; url?: string | null };
}

export type OrgSize = "small" | "mid" | "large";
export interface Org {
  id: string;
  name: string;
  aliases?: string[];
  ticker?: string;
  size: OrgSize;
  themes: string[];
  group?: string;
  /** an unlisted business inside a listed parent (Reliance Retail inside Reliance Industries) */
  parent?: string;
  /** directed business relations: this org's competitors, suppliers, customers */
  competitors?: string[];
  suppliers?: string[];
  customers?: string[];
}

export interface Network {
  me: Person;
  contacts: Person[];
  orgs: Org[];
  schools: { id: string; name: string; aliases?: string[]; cohort: "small" | "large" }[];
  themes: { id: string; label: string }[];
  synthetic: boolean;
}
