# FINN

A mobile-first investment agent for a 20-stock NSE portfolio. It tells you what changed and why it ranks (**Push**), researches any NSE company from primary filings (**Pull**), and ends every item with the person in your own network who can explain it (**Network**).

> **Point of view.** An investor's unit of work is not a filing, it is a lead: *what happened, how sure are we that it matters, and who do I call.* So every card in FINN has the same three parts, and anything green on screen is a person you know. Scores are measured or derived, shown with their working, and never come from a model's opinion.

## What it does

**Brief (push).** Pick a window (24 hours, 3 days, a week, a month, or since a date). Every filing across the portfolio is folded into events and placed in one of three tiers.

- **What matters.** A full card per event.
  - *Results* are read from the company's XBRL filing: Revenue, EBITDA, PBT and PAT against last quarter and the same quarter last year, with margins. For lenders and banks, EBITDA is replaced by net interest income and pre-provision profit. The card states how many of the filing's own accounting identities hold.
  - *Management changes* name the person, their role and their stated background, then show the strongest route to them through your network.
  - *Everything else* shows the amount at stake against the company's regulatory materiality line.
  - Each card ends with who to call, and a "why it ranks" panel that adds up the evidence.
- **Worth a glance.** One line per event. A green dot means you know someone relevant.
- **Set aside.** Known paperwork, collapsed into counts.
- **Unusual moves.** Stock-days that crossed *your* thresholds (±X% or N× the 20-day average volume), each with how rare it is for that stock and which filing arrived that day. The threshold sheet shows how many alerts a week your setting would have produced over the past year, so you choose a line knowing its cost.

**Ask (pull).** One box, asked the way you would ask a colleague, typed or spoken.

- It reads meaning, not strings. "Who understands the raw material suppliers for battery manufacturers?" is read as *suppliers to → battery materials (feeds battery cells)* and returns the chemists in your network. Concepts carry the words people type and list what supplies them, so a supply chain is a graph step, not a keyword. Misspellings match by edit distance ("Reha Kapadia", "semiconducter").
- The reading is shown under the box ("Read as: …"), so a wrong interpretation is visible, not silent.
- This runs on the device. For phrasing the concept map does not cover, a small model picks fields from a fixed list; it is sent the question with every network name masked first.

- A company opens a research page built for scanning. A locked header keeps price, seven colour-coded vital signs and your strongest contact on screen while you read. Four tabs (Verdict, Numbers, Management, Business) hold collapsible modules; a closed module still states its one-line conclusion. Charts are interactive: drag to read any period, switch years and quarters, rupees and margins, and tap the promise scorecard to filter by verdict. Every point links to its source document.
- The research page opens with who you know at the company, a competitor, a supplier or a customer.
- Demo companies are precomputed. Any other NSE symbol is read live in stages, and the page shows what is being read.

**People (network).** Not a contact list.

- *A reason to call:* a contact you have not spoken to in nine months whose company just filed something that matters.
- *Who to ask about* a theme: depth is computed from careers, not self-declared.
- *People in filings you can reach:* second-degree routes with the evidence for each link.
- A person's page: career, what in your portfolio they can speak to, and recent filings at their companies.

## First principles

Each number on screen has a derivation. The short version:

| Quantity | How it is obtained |
|---|---|
| Abnormal return | `e = r - (a + b·m)`, market model fitted on the trailing 250 sessions, out of sample |
| "Unusual" | Empirical tail frequency in the stock's own last 500 sessions: `p = (1 + #{days at least this extreme}) / (1 + n)`. No normality assumed; reads as "1 in N days" |
| Category weight | Event study on 11,120 stock-sessions of this portfolio. Ridge-penalised logistic regression of "the market noticed" on which categories were filed that session, so co-filed categories do not share credit wrongly. Results days: 6.5× baseline (90% interval 5.5–7.6). Most other categories: indistinguishable from 1× |
| Size | `rho = amount / SEBI materiality line`. The line is Regulation 30(4)(i)(c): the lowest of 2% of turnover, 2% of net worth, 5% of three-year average profit. `rho = 1` is pinned to the "what matters" cut-off |
| The tape | A tail session multiplies an event's odds by `1 + r·(LR − 1)`, where `r` is that event's share of the session's prior odds. The likeliest cause takes the credit; paperwork filed the same day takes almost none |
| Results | XBRL facts, with four identities checked (income = revenue + other income; PBT = income − expenses; and so on). 20 of 20 portfolio companies pass 4 of 4 |
| Tie strength | `s = c · 2^(−months/36)`, c from the investor's own closeness rating |
| "Did they know each other" | `p = 1 − (1 − q)^years`, q set by organisation size, seniority and function; classmates by cohort size; evidence combined by noisy-OR |
| Ask | Token similarity `1 − d/len` (Damerau-Levenshtein); concept weights fade by 0.7 per supply-chain link; a person's relevance is `1 − e^(−Σ match·years·seniority·freshness / 6)`, the same form as the expertise map |
| Who to call | `score = tie × knowledge`, knowledge = relation × freshness × depth × seniority × fit, combined across roles |
| Promised vs delivered | Quantified full-year commitments on revenue growth and margins are adjudicated in code against reported numbers; the model judges only what code cannot |

One honest finding from the event study: apart from results, the *category* of a filing says little about whether it matters. A litigation filing is as likely to be a ₹2 lakh GST notice as a ₹2,000 crore demand. That is why the score leans on what is inside the document (size against the materiality line, the seniority of the person) and not on the label. I also tested whether finer traits (top-role changes, order wins) had a measurable market effect; with 22 top-role changes in three years the standard error was too large to say, so role tiers are stated judgment, and labelled as such in the code.

## Architecture

```
 GitHub Actions (every 2 h on trading days)                 Vercel, Mumbai (bom1)
┌───────────────────────────────────────────────┐          ┌──────────────────────────────────────┐
│ python -m finn.digest                         │          │ Next.js app (static shell)           │
│                                               │          │   /         Brief                    │
│ NSE bhavcopy + Yahoo history ─► signals       │          │   /ask      company, person, theme   │
│ NSE announcements ─► classify (rules)         │  git     │   /network  People                   │
│   ─► fold into events                         │ ───────► │   /research/[symbol]                 │
│   ─► open opaque letters (pdftotext, OCR)     │  commit  │                                      │
│   ─► read (Flash-Lite, quotes verified)       │          │ api/research.py (Python function)    │
│   ─► results from XBRL, identities checked    │          │   resolve · base · call×4 · annual   │
│   ─► score (event-study prior + evidence)     │          │   · synth      one stage per request │
│ ► public/data/digest.json, market.json        │          └──────────────────┬───────────────────┘
│ ► data/cache/llm (committed), last-run.log    │                             │ public company data only
└───────────────────────────────────────────────┘                             ▼
                                                           ┌──────────────────────────────────────┐
                                                           │ The phone                            │
                                                           │   network graph (browser storage)    │
                                                           │   lib/network: ties, overlaps,       │
                                                           │   routes, who-to-call, name matching │
                                                           │   joins filings ⨝ network locally    │
                                                           └──────────────────────────────────────┘
```

### Data pipelines

- **Prices and volume.** Three years of daily history per stock from Yahoo's chart endpoint; the latest sessions are overwritten from the NSE bhavcopy, the exchange's own end-of-day file.
- **Filings.** NSE's corporate-announcements endpoint per symbol. A filing made after 15:30, or on a holiday, is assigned to the next trading session, because that is when the market could first react.
- **Results.** NSE's integrated-filing index gives the XBRL instance for each quarter. QoQ and YoY each come from that quarter's own filing.
- **Fundamentals.** screener.in for standardised statement lines and for links to annual reports and transcripts (BSE-hosted PDFs). Screener's ratios are not used; ours are recomputed.
- **Profiles.** People named in filings come from the filing's own text. The investor's contacts are synthetic (see below).
- **Linking.** Organisations resolve through an alias table after stripping legal suffixes. People match when surnames are equal and the remaining name parts are compatible (an initial matches a full name); a name-only match is "possible" and becomes "confirmed" only with a shared organisation.
- **Access.** Every request sends an honest User-Agent, is rate-limited per host and cached on disk. BSE's JSON API refuses automated clients, so it is not used. Nothing bypasses a bot check.
- **Refresh and storage.** The scheduled job writes static JSON and commits it. Git is the database, the model cache and the audit trail of what FINN said and when.

### Data security and privacy

- **The network never leaves the device.** It is held in browser storage. The server sends public company data down; the join between filings and contacts runs in the browser (`lib/network`). No contact name is ever in a request, a log or a model prompt.
- **No model sees the network.** "Who to call" and its reasons are produced by code from structured careers, so there is nothing to send to a provider.
- **What is stored about real people.** Only what a company published about its own directors and officers in an exchange filing (name, role, stated career), with a link to that filing. It expires with the digest window.
- **The demo network is synthetic.** 34 invented contacts with invented careers at real organisations (`scripts/make_network.py`). No profile was scraped. LinkedIn's terms forbid scraping, so FINN does not do it.
- **Compliance guard.** When the best-placed contact currently works at the company, the card says so and warns against seeking unpublished information.
- **For a real deployment.** Import from sources the investor owns: their LinkedIn data export, phone contacts, calendar and CRM notes. Sync between devices with a key derived on the device, so the server stores ciphertext only. Per-user isolation; no cross-user graph without both sides opting in. Deletion by the investor is immediate and complete; a contact can ask to be removed. Role-based access inside a firm, with an access log for the compliance officer.

### Use of models and agents

| Step | What does it | Why |
|---|---|---|
| Category of a filing | NSE's subject, then ordered text rules | Free; the exchange's own label is reliable when specific |
| Opaque titles ("General Updates") | `pdftotext`, tesseract OCR for scans, then the letter's "Sub:" line | Local and free; the company's own words |
| Results | XBRL parse and arithmetic | Exact; a model adds only risk here |
| Ranking | Event-study prior plus derived evidence | A model's "importance score" cannot be audited |
| Read a material filing | Gemini Flash-Lite, schema output | Cheap extraction of headline, counterparty, amount. Each amount must come with the words that state it, and code checks those words are in the document |
| Management backgrounds | Flash-Lite on the filing's profile annexure | Every employer and school must appear in the text or it is dropped |
| Transcripts → commitments | Flash-Lite, one call per transcript | Long context, structured output, verbatim quotes checked in code |
| Annual report | Local page scoring picks ~14 of ~300 pages; Flash-Lite reads those | Tokens go only where the business is described |
| Promised vs delivered, bull and bear | Gemini Flash, one call | The one reasoning step. It sees extracts and computed numbers, never raw documents, and must cite a source id for every point |

There is no free-roaming agent. The pipeline is a fixed sequence in which each step's output can be checked, because a wrong number in front of an investor costs more than a slower one. The stage-by-stage research call is the closest thing to an agent loop, and the phone drives it.

**Cost.** A research dossier is six model calls. A digest run reads at most 60 documents. Every answer is cached by content hash and the cache is committed, so a re-run pays only for new filings. Model names are discovered at run time; an overloaded Flash request can fall back to Flash-Lite, and a fallback answer is never cached.

### Cloud

- **GitHub Actions** runs the push pipeline on a schedule: free, and it has `poppler` and `tesseract`.
- **Vercel** serves the app and one Python function in Mumbai, close to the sources.
- **The phone** holds the network and does the join.

## Decisions and trade-offs

- **Measured priors over asserted ones.** The cost is honesty about what a small sample cannot tell you, shown as intervals.
- **XBRL over reading the results PDF.** Exact and free. The cost: comparatives are as first reported, not as later restated, and a company that files a non-standard layout fails the identity check and is flagged instead of shown.
- **Flag, never fix.** A failed check is displayed as unverified. FINN does not substitute a third party's number.
- **Network on the device.** The cost: no server-side push notification can mention a contact, and a new phone starts empty until sync exists.
- **Python for data, TypeScript for the network.** Each lives where it runs. The cost is two languages.
- **Static JSON for push.** The Brief opens instantly and costs nothing per view. The cost is a two-hour refresh, not real time.
- **Sales as the denominator for all three working-capital days**, so they add up to one cycle figure. Purists would use cost of goods for inventory and payables; screener's standardised lines do not carry it.

## Deliberately left out

- OS push notifications (needs a push service and stored subscriptions; thresholds and tiers are ready for it).
- Intraday prices. The brief asks for end of day.
- Accounts and sync.
- Investor presentations as a research source: they are management's framing; commitments go on record in calls and reports.
- News and broker views on the pull side, by the brief's rule.
- Scraping LinkedIn.

## Where next

- Grounded web lookup for the background of an incoming executive when the filing has no profile, kept on the push side.
- Measure the role and size terms once there is enough history (a wider universe than 20 stocks).
- Import adapters for the investor's own data exports; encrypted sync.
- A meeting log: after a call, one line of what you learned, attached to the company and the person.
- Route alerts through the network: "Dixon moved 9% and you last spoke to its largest customer's sourcing head in October."

## Run it

```bash
pip install -r requirements.txt numpy          # plus poppler and tesseract for the batch pipeline
npm ci
cp .env.example .env.local                     # add GEMINI_API_KEY (free)

set -a; . ./.env.local; set +a
python -m finn.digest 35                       # builds public/data/digest.json; log on stdout
python -m finn.research.dossier KAYNES PIIND   # precompute research dossiers
python -m finn.server &                        # local stand-in for the serverless function
npm run dev                                    # http://localhost:3000
npm test && npm run typecheck
```

Without a key the digest still builds from rules, XBRL and local document reading, and research pages show the computed fundamentals only.

**Deploy.** Import the repository in Vercel and set `GEMINI_API_KEY`. Add the same key as a GitHub Actions secret for the scheduled digest.

## Repo map

```
finn/                    Python: everything that touches public data
  http.py                polite cached client
  sources/               nse.py · prices.py · screener.py
  stats.py               abnormal returns, tail probabilities, ridge logistic
  materiality.py         the event study
  taxonomy.py            categories and rules
  results.py             XBRL results and identity checks
  docs.py                PDF text and OCR
  enrich.py              titles, amounts, people, facts (verified extraction)
  digest.py              the push pipeline and score
  llm.py                 Gemini routing, cache, fallback
  research/              fundamentals.py · documents.py · synthesis.py · dossier.py
api/research.py          serverless entry, one stage per request
lib/network/             TypeScript: the on-device network engine, query engine (search.ts) and tests
lib/client/              store, formatting, staged research client
app/ · components/       Brief, Ask, People, research page
scripts/make_network.py  the synthetic demo network
data/                    portfolio.json · materiality.json · last-run.log · cache/llm
public/data/             digest.json · market.json · network.seed.json · research/
```
