// WCAG contrast of the colour tokens, both themes. Text pairs need 4.5:1, chart marks 3:1.
// Reads the TOKENS block of app/globals.css, so the check is of what ships.   node scripts/contrast.mjs
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").split("TOKENS-START")[1].split("TOKENS-END")[0];
const blocks = [...css.matchAll(/\{([^}]+)\}/g)].map((m) => Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((x) => [x[1], x[2]])));
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const TEXT = ["ink", "ink-2", "ink-3", "brand", "people", "up", "down", "alert"], MARKS = ["d1", "d2", "d3", "d4", "d5", "ink-3", "people", "alert", "up", "down"];
let bad = 0;
["light", "dark"].forEach((name, i) => {
  const t = blocks[i];
  const check = (fg, bg, min, kind) => { const r = ratio(t[fg], t[bg]); if (r < min) { bad++; console.log(`FAIL ${name}: ${kind} --${fg} on --${bg} = ${r.toFixed(2)} (needs ${min})`); } };
  for (const bg of ["paper", "card"]) { TEXT.forEach((fg) => check(fg, bg, 4.5, "text")); MARKS.forEach((fg) => check(fg, bg, 3, "mark")); }
  ["ink", "ink-2"].forEach((fg) => check(fg, "wash", 4.5, "text")); check("people", "people-wash", 4.5, "text"); check("alert", "alert-wash", 4.5, "text");
  check("paper", "brand", 4.5, "text on brand"); ["alert", "d1", "d5", "up", "down", "people"].forEach((bg) => check("paper", bg, 3, "label on mark"));
});
console.log(bad ? `${bad} pair(s) below WCAG AA` : "contrast: every text pair is at least 4.5:1 and every chart mark at least 3:1, in both themes");
process.exit(bad ? 1 : 0);
