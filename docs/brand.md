# FINN brand sheet

One page. Everything on screen follows it; `app/globals.css` (block "v3") is the implementation and `scripts/contrast.mjs` checks the colours.

## Type
| Role | Font | Size / line | Use |
|---|---|---|---|
| Headline | Anek Latin 650 | 24 / 30 | one per screen or card |
| Body | Anek Latin 400, 600 for emphasis | 16 / 24 | sentences, row titles |
| Data | Anek Latin 400 | 13.5 / 20 | labels, captions, table cells |
| Big number | Martian Mono 600 | 22 / 26 | the one number in a row |

- Anek Latin (Ek Type, SIL Open Font Licence) for all words. Martian Mono for all numbers.
- Digits, `%`, `+`, `−` and `×` are drawn from Martian Mono everywhere, including inside sentences, at the size of the surrounding text (a `unicode-range` face, "Finn Digits"). So figures align without tabular-figure support and a sentence never mixes two text faces.
- No uppercase tracking, no italics for emphasis.

## Colour tokens
| Token | Light | Dark | Means |
|---|---|---|---|
| `--brand`, `--d1` | #3A2FBF | #9C95FF | FINN itself: selection, focus, the stock's own share of a move |
| `--people` | #17624F | #5FCBAB | a person you know, and nothing else |
| `--up` / `--down` | #0A5FA8 / #B0215F | #6FB6F5 / #F27FB0 | a signed number; always with ▲▼ or + − |
| `--alert` | #A8400F | #F59A62 | a line was crossed (needs you, above materiality, risk above money, no coverage) |
| `--d2` `--d3` `--d4` `--d5` | #0A7F7B #C2410C #7A3FD0 #6B6558 | #3CC9C2 #F59A62 #C3A1FF #9A9385 | further chart series; `--d5` is "the market" |
| `--ink` `--ink-2` `--ink-3` | #16130F #4A453C #6B6558 | #F1EDE4 #BDB6A8 #9A9385 | text, secondary text, captions |
| `--paper` `--card` `--wash` `--rule` | #F7F5F0 #FFFFFF #ECE7DC #DDD7CA | #121110 #1B1A18 #26241F #33302A | surfaces and hairlines |

Text on any surface is at least 4.5:1 and every chart mark at least 3:1, in both themes (`npm run contrast`). Colour never carries a meaning alone: signs, arrows, a dashed hatch for "no one", and words repeat it.

## Space and shape
- 4 px grid. Rows are separated by a 1 px `--rule`; a box only where grouping would otherwise be ambiguous (a card in the answer pane, a sheet).
- Radius 6 for bars, 10 for cards, 18 for the sheet. Every control is at least 44 px tall with a 3 px `--brand` focus ring.
- Two panes from 1024 px (list, detail card). Below that one column and the detail card is a bottom sheet.

## Charts
- A row is a picture: icon, ticker, one big number, one chart. Words live in the detail card.
- Move decomposition: market `--d5`, sector `--d2`, own `--d1`, from a centre zero line.
- Rarity: log scale, 1 in 10 to 1 in 1,000; the tick turns `--alert` at 1 in 100.
- People: filled `--people` for someone, dashed `--alert` hatch for no one.
- Every chart has an `aria-label` that states its conclusion and a visually hidden data table.
- Motion is off under `prefers-reduced-motion`.
