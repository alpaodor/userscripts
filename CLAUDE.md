# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single TamperMonkey userscript, `scx_pbs_analyzer.user.js` (~6,250 lines), that injects an analysis panel into NavBlue Blue PBS for Sun Country Airlines. It reads report text, parses KPIs out of it, persists them in `localStorage`, and checks the numbers against contractual limits (PWA/LOA) so a scheduler can tell at a glance whether a bid run is legal and where it falls short.

Since v5 it runs on **two pages** (`IS_RUN_LIST`, set at the top of the IIFE):

- **Report page** (`report.html`, the window a NavBlue report button opens) — since v5.2 a full-width bar across the top of the page, in the page flow, with three buttons on the left (Analyze, KPIs ▾, Validate) and the KPI box dropping down below it; it shares the `#ra-drawer` button styles and `setPane` with the run list. Analyze (`#load-report`, formerly Load & Run) scrapes the report on screen; the panel is a 750px sidebar.
- **Run list** (`main.cgi`, the PBS app itself) — a toolbar above the Completed runs box downloads Stats + Dynamic Stats + Unstacking for the selected run in one request and opens a full-width two-column panel. The Run Highlighter (formerly a separate userscript) is built in here. See *Run list page* below.

**The report page mode may be removed.** The user plans to ask the team whether the analyzer is still needed on individual report pages now that the run list does everything (Nov 2026). Until they decide, keep both modes working, and keep them on shared code so removing one is a deletion rather than an untangling.

There is no build, no bundler, no dependencies, and no test suite. The file *is* the deliverable: Tampermonkey installs it from GitHub and keeps it updated (see *Publishing*).

- **Matches:** `/class/report.html` and `/cgi-bin-xml/class/main.cgi*` on `scx.pbs.vmc.navblue.cloud` and the `scx-uat` host. `@run-at document-start`, so the run list's request capture is in place before NavBlue's scripts run; everything else waits for `DOMContentLoaded` inside `__raMain()`.
- **Report page scrapes:** `document.querySelector('#report_text p').innerText`. Both pages then go through one reader, `readReportText()`: `flattenReportText()` collapses every run of whitespace to one space (so every parser regex works against one long line, and a page and a download give identical text), `splitReports()` cuts several reports apart at their headers, and each goes to `parseReport()`. A single report — every report page — is parsed whole, as Analyze always did, so nothing above its header is lost.
- **Repo scope:** this folder is the git repo `alpaodor/userscripts` on GitHub (remote `origin`, **public**), branch `main`. It tracks `.gitignore`, `README.md`, `CLAUDE.md` and `scx_pbs_analyzer.user.js`. Whatever is pushed to `main` is what every install receives, so larger work goes on a feature branch and only finished versions are merged and pushed. The user pushes; Claude has no GitHub credentials.
- **History before v5.5.1** is in the sibling `../Run Analyzer/` folder, a local-only git repo kept as a read-only archive (its file is named `scx_pbs_analyzer.js`). Every commit hash in this file (`a095a01`, `238b006`, `c5e7377`, …) belongs to that repo: run `git -C "../Run Analyzer" show <hash>`. Don't edit there. Its history holds crew data and must never be pushed; that is why this repo started fresh.

**Do not get confused by the parent directories.** `SCX PBS Runs Tool/` above this folder holds an older, unrelated PyInstaller desktop app (`app_v1..v3.py`, `dist/`, `PBS Tool.dmg`) and a stale `README.md` describing a "Data Viewer" Python/PyQt app. None of that has anything to do with this userscript. The sibling `Run Analyzer/` folder is the archive of this script's history (see *Repo scope*). The sibling `Highlighter/` folder is its own git repo holding the **retired** standalone Run Highlighter; its code now lives here (see *Run Highlighter*), and its CLAUDE.md still has the detailed notes on NavBlue's run list DOM.

## Verification loop

There is nothing to run locally — the UI only exists inside the NavBlue page. In practice:

```bash
node --check scx_pbs_analyzer.user.js    # syntax gate; do this after every edit
```

Then the human pastes the file into TamperMonkey and reloads a report page.

**For logic you can test without a browser**, extract a function from the source and run it against stubs. This has caught real bugs and is much faster than a round trip through TamperMonkey:

```js
// Slice the function out of the file, supply the globals it closes over,
// stub `document.getElementById` to capture the innerHTML it writes,
// then assert against the captured HTML string.
const body = src.slice(src.indexOf("    function renderCompareGrid(reports) {"), src.indexOf("    // ****...INPUT"));
new Function(`${stubs}\n${body}\nrenderCompareGrid(REPORTS);\nreturn capturedHTML;`)();
```

Pure helpers (`resolveLineCount`, `isWeekend`, `buildInputDiff`, `computeMaxStack`, `expandTwoDigitYears`) extract cleanly this way. Say plainly in any summary that the *logic* was verified but the *rendering* was not — layout still needs the real page.

**For stateful UI flows** (KPI tabs, Analyze, anything spread across several functions and `localStorage`), run the *whole script* in jsdom instead of extracting. Install jsdom in the session scratchpad, never in this repo. The script runs fine against a stub page:

```js
const dom = new JSDOM(`<html><head><title>Run</title></head><body><div id="report_text"><p>
  Run Detail Report Name: RUN1 Start Date: 10/01/2026 Category: 73N-DOM-CA x</p></div></body></html>`,
  { runScripts: "outside-only", url: "https://scx.pbs.vmc.navblue.cloud/class/report.html" });
const w = dom.window;
Object.defineProperty(w.HTMLElement.prototype, "innerText", { get() { return this.textContent; } }); // jsdom lacks innerText
w.confirm = () => true; w.requestAnimationFrame = f => f();
w.eval(src);
// then set field values, dispatch clicks on #load-report / .kpi-tab-btn, and read
// the DOM and w.localStorage back. A 31-row "10/N/2026 1 2 3 4 10" grid parses cleanly.
```

That one-line report text is enough for `detectReportType` and the category pattern; the rest of the stats come back null. Toasts are the children of `document.body.lastElementChild`.

**The run list in jsdom** needs a bit more, all set on the window *before* `w.eval(src)`:

```js
const dom = new JSDOM(`<html><head></head><body><div id="completed_runs_groupbox_1">runs</div></body></html>`,
  { runScripts: "outside-only", url: "https://scx.pbs.vmc.navblue.cloud/cgi-bin-xml/class/main.cgi" });
// jsdom has no layout: give the Completed box a rect (placeDrawer hides the toolbar without one)
w.HTMLElement.prototype.getBoundingClientRect = function () {
  return this.id?.startsWith("completed_runs_groupbox_") ? { top: 300, left: 5, width: 1440, height: 180 } : { top: 0, left: 0, width: 0, height: 0 }; };
Object.defineProperty(w.HTMLElement.prototype, "offsetHeight", { get() { return 40; } });
Object.assign(w, { structuredClone, CompressionStream, DecompressionStream, Response, Blob }); // Node's
w.fetch = async (url, init) => ({ ok: true, status: 200, text: async () => `<name_undef><ReportText>…escaped report text…</ReportText><Status><Code>SUCCESS</Code><Message>ok</Message></Status></name_undef>` });
```

`fetch` must exist before the eval: the script binds `origFetch` at load. Select a run by sending a fake NavBlue request, `new w.XMLHttpRequest()` → `open("POST", "/cgi-bin-xml/class/class.cgi?getRunReport")` → `send("nws=" + encodeURIComponent("<Call>…<PeriodId>29</PeriodId><RunIdList><RunId>8659</RunId></RunIdList>…</Call>"))` (jsdom's network error after `send` is harmless). The panel is built on `DOMContentLoaded`, so wait a tick after the eval. A page reload is a second JSDOM seeded with the first one's `localStorage` values. Don't put a form feed or other control character in the fake reply: it makes the XML invalid. The script copes (`ReportText` is then cut out with a regex), but it is not the normal path.

## Architecture

Everything lives in one IIFE in one file. All state is closure-scoped module globals (`workingReport`, `currentKPI`, `activeKPICategory`, `kpiDraftOpen`, `kpiDraftFields`, `reserveCompareMode`, `compareReports`, `compareGridColumns`, `reserveGridFilters`, `celebrationDismissedKey`, `celebrationOutsideHandler`; `compareView`; on the run list also `capturedRun`, `pulledRuns`, `pullInFlight`, `openPane`, `hlPaintButton`, and the Compare picks `cmpItems` / `cmpState` / `cmpInFlight`). The Run Highlighter keeps its own state inside `startRunHighlighter()`. Section banner comments (`// ---------------- X ----------------`) are the navigation aid — grep for them.

### Data flow

```
Analyze button (report page), no download of this run
  → readPageRun() → readScreenReport()
      → getReportText()            scrape #report_text, flattenReportText()
      → readReportText(text)       SHARED with the run list: split at report headers (if several),
                                   detectReportType() + parseReport() per report, all one run
          → parseReport()          dispatches to parseRunDetail / parseDynamicStats / parseUnstacking
      → buildReport(name, partials)
          → applyUpdate(full, p)   merge onto a fresh defaultReport(); null/undefined values are SKIPPED
          → normalizeReport()      re-base onto defaultReport()
  → finishRun(updated)
      → resolveKPIForRun(category) locked saved KPI, or parse the fields and lock them (see KPI tabs)
      → renderPanel()              General / ALV / Open Time / Unstacking & SLG / Reserves / Coloring

Analyze / Validate on a report page, when the run list has downloaded the same run (readPageRun)
  → readScreenReport()             the page's report, read as above
  → findDownloadFor(report)        re-reads NBAnalyzerPulls (the run list writes it from another window);
                                   same name, and category / period agree where both print them; newest wins
  → reparseIfStale(key)            then the download's partials, with any type it lacks taken from the page
  → buildReport → finishRun()      toast says which reports were used; no download = the page's report only

Download Run / Analyze Run (run list)
  → pullAndAnalyze()               cached? reparseIfStale() then analyzePulled(); else downloadRun() (POST getRunReport)
      → readReportText(text)       the same reader as above
      → pulledRuns[key] + savePulls()
      → analyzePulled(key)         buildReport(name, partials) → finishRun()
```

The report is parsed *before* any KPI is saved, so a report that can't be read never creates or locks a tab. The category comes from the report (`updated.category`), falling back to the active tab.

`applyUpdate` skipping nulls is the load-bearing part of the whole design: **each report type contributes a different subset of stats, and they are layered onto one report object.** A run list download layers Stats → Dynamic → Unstacking. Until v5.2 they also accumulated across loads on a saved report (`NBAnalyzerReports`, the Save button); that store is gone, so a report page analyzes **its one report only** unless the run list has downloaded that run (see below), and every consumer has to cope with "this field is present, that one is not" — the fallback messages, and validators returning `default` "missing" rather than passing.

### Storage

`localStorage` keys, all plain JSON. Both pages are on one origin, so they share all of them (scx and scx-uat are separate origins):

- `NBAnalyzerReports` — **removed in v5.2** with the Save button. The script deletes the key on every load (`localStorage.removeItem`, cheap when absent), so old saves can't come back. Don't reuse the name.
- `NBAnalyzerKPI` — `{ [category]: kpiObject }`, category like `73N-DOM-CA`. Holds `alvTarget`, `gridText`, parsed `grid` (required reserves by date), and `defaultCompareMode`. `loadAllKPIs()` detects the pre-category flat format and discards it.
- `NBAnalyzerPulls` — run list downloads, see *Run list page*. The only store of report data.
- `NBRunHighlighterCache`, `NBRunHighlighterMarks`, `NBRunHighlighterTargets`, `NBRunHighlighterEnabled`, `NBRunHighlighterRoles`, `NBRunHighlighterColors`, `NBRunHighlighterPick`, `NBRunHighlighterSwatches` — the Run Highlighter's. Names kept from the standalone script so its data carries over.

Every analyzer write goes through `saveKPI` / `clearKPI` / `savePulls`, and each calls `updateStorageSize()` to refresh the Cache button (run list only; it returns early without one). A new write path must call it too. The Cache button counts KPIs and downloads; the highlighter's keys show only in the whole-site total.

### Which report gives which number

This distinction drives a large share of the logic and most of the recent bugs:

| Concept | Stats / Run Detail | Dynamic Stats | Unstacking |
|---|---|---|---|
| Line count | `totalAwardedSchedules` | `pairingLines` | — |
| Pairing unstack % | — | `pairingsUnstackedPercent` (estimate) | `highestPairingsUnstackedPercent` (official) |
| Reserve unstack % | — | `reserveLinesUnstackedPercent` | `reserveLinesUnstackedPercent` |
| SLG count | — | `pairingLinesWithSLG` (estimate) | `slgAboveTenPercent` (official) |
| RLL lines | `rllLines` | — | — |
| Bidders with No Line | `noLineBidders` + `noLineEmployees` | same fields | — |
| Reserve grid Min (requested) | `reserveGrid[date].minCoverage` | same field | — |
| Scheduler inputs | `inputs` (Options section) | — | — |

A few fields break the pattern of the rest:

- **`pairingUnstackEnabled` / `reserveUnstackEnabled`** — booleans from the Unstacking report's two always-printed lines, `[Reserve ]Unstacking was [NOT ]ENABLED for this run` (`PAIRING_UNSTACK_ENABLED` uses a `(?<!Reserve\s)` lookbehind; both capture `NOT ENABLED|ENABLED` so View Text always has a group to mark). `false` is checked **first**: the panel's Unstacking & SLG rows, the compare summary's two unstack columns and `validateUnstack` (status `default`) show `OFF` whatever the percentages say, including a Dynamic estimate. `null` (Unstacking not loaded) shows the numbers as before. Test with `=== false`, never truthiness. SLG rows are not affected.
- **`reserveLinesUnstackedPercent`** has no official/estimate pair — Dynamic Stats and Unstacking both write the same field, so whichever ran last wins and there is nothing to flag. Do not run it through `resolveUnstackStat`.
- **`noLineBidders` / `noLineEmployees`** work the same way between Stats and Dynamic Stats: `parseNoLineBidders()` is called from both parsers and the last load wins. The line reads `Bidders with No Line: 3 (10001, 10002, 10003)`; the bracketed list is absent at 0, so the count is a number and the employees an array of strings (`[]` at 0). If the line is missing from a report the fields are left unset rather than zeroed, so a report without it can't erase a count. As with `rllLines`, test with `typeof`, never truthiness — the General section shows `Check Stats or Dynamic` only when the count isn't a number.
- **`minCoverage`** is the reserve grid's Min column (Stats calls the grid ReserveStackHeight, Dynamic calls it Reserve Coverage; the row format is identical). It is the requested reserves for the day and is **not** the KPI's Required. Reports saved before v4.5 don't have it until they are loaded again.
- **`rllLines`** counts the employees in the Stats report's "Reduced Lower Limit Employees" table (`RLL_EMPLOYEE_BLOCK` captures between its two `-----` rules; `getReportText()` has already flattened newlines to spaces, so the pattern cannot lean on line structure). The section is absent when nobody bid RLL, so a parsed Stats report always sets a number — **`0` means none, `null` means Stats has not run**. Consumers must use `??` / a `typeof` check, never a truthiness test, or "none" reads as "unknown". Distinct from `stats.windows.rll` (the ReducedLowerLimit*Credit* window that `validateRLL` checks) — same acronym, unrelated number.

Two resolvers exist so callers never reach for the raw fields:

- **`resolveLineCount(stats)`** — prefers `pairingLines`, falls back to `totalAwardedSchedules`, else `null`. Every consumer goes through it (compare summary, side panel, both reserve grids, `validateMaxStack`, `alvToleranceFor`). Only the parser and the schema default touch `totalAwardedSchedules` directly. If you add a new consumer, use the resolver.
- **`resolveUnstackStat(stats, officialKey, dynamicKey)`** — official (Unstacking) wins; a Dynamic value comes back with `estimate: true`, which the UI renders yellow with a `*` and never as pass/fail.

## UI surfaces

Modals are pre-built hidden DOM; renderers overwrite `innerHTML` and **re-attach their own event handlers on every render**, because the re-render blows away the old nodes. Follow that pattern — don't add one-time listeners inside a render function's caller.

- **Side panel / analysis panel** (`renderPanel`) — per-report analysis, the reserve grid with Shortages Only / Compare Gross toggles. Sections: General (Bidders with No Line, RLL Lines, Min / Max Window Bidders Honored — `minCredits` / `maxCredits.honored` from Dynamic, `of N allowed` when Stats gave `allowed` — Total Trips, IOE on FO runs), ALV, Open Time, **Unstacking & SLG** (`renderUnstackSection`: pairing unstack %, SLG #, SLG %, and Reserve Lines Unstacked % with no indicator because it has no limit), **Reserves** (`renderReservesSection`: Max Stack Height with its %, Total Reserves, Required, 14LC; the header keeps only `(N days)`), **Reserve Grid** (`renderReserveGridSection`: the grid, with the Shortages Only / Compare Gross toggles in its section header, `.ra-reserve-toggles`, right-aligned to save space; the no-data stub has no toggles), Reserve Coloring. Before v5.2 Reserves and the grid were one section with those figures squeezed into its header; the user split them once the Notes box was gone. (Notes was removed in v5.2 with Save; the panel header shows only the run name and ✕.) Order: General, ALV, Open Time, Reserves, Unstacking & SLG, Reserve Grid, Reserve Coloring. On the report page that is one column; on the run list it is `.ra-columns` with two `.ra-col`s that scroll independently (left: General → Unstacking & SLG; right: Reserve Grid, Coloring), dropping to one column below 1100px. All the wide-panel CSS, including the compact sizing (13px banners, 13px section text, 12px grids), is scoped to `#ra-panel.ra-wide`, so the report page sidebar is unaffected.
- **Manage Reports** — **removed in v5.2** (modal, handlers and CSS), with saved reports. Compare is run list only; Validate is a toolbar button on both pages.
- **Compare modal** — run list only, opened only through `openCompare()`. An **Analysis / Inputs** switch in its header (`setCompareView`, `.ra-compare-view-btn`, handled in the delegated click listener) shows `#ra-compare-analysis` or `#ra-compare-inputs`; all three renderers run on open, so switching just toggles display. `COMPARE_MAX` is `REPORT_LABELS.length` (10). A toast warns when the reports' categories differ, since the reserve grid uses the first report's KPIs.
  - Analysis: `renderCompareSummary` (one row per report: ALV, OT%, Pairing Lines, RLL, CW, pairing/reserve unstack, SLG) plus `renderCompareGrid` (per-day reserve grid, one sub-column per report). Adding a summary column means a `<th>` and a `<td>` — nothing derives the count, so they have to be kept in step by hand.
  - Inputs: `renderInputCompare(reports)` — the Options section of every report that has one (`hasInputs`), one column each, keeping the report's letter from the whole comparison; reports without Stats inputs are named in a note above the table. `buildInputDiff(reports)` returns rows `{ section, label, values[], differs }`: `differs` when any two disagree (the row gets the `.ra-ic-diff` tint). There is no per-cell highlight: an amber "differs from A" mark was tried and removed (with Only differences on it just painted whole columns). Defaults to differing fields only. Before v5.2 this was a separate two-report modal (`#ra-input-compare-backdrop`), now gone.
- **Validation modal** — opened by the toolbar's Validate on both pages: run list, the selected download (`validateSelectedRun`); report page, the same run Analyze would use (`readPageRun()`: the run list download if there is one, else the report on screen), without needing Analyze, against `loadKPI(category) || {}`. Its title ends `· run list download` or `· Stats report only` (etc.) so it's clear which. The `validate*` family, each returning `{ label, status, message }` with status `green` / `red` / `yellow` / `default`. Missing data must return `default` with a "missing" message, never a green pass (v5.2 fixed the two PSD checks, which passed when the Stats Options were absent: `getPSDState().psdKnown`). Several older checks still return **red** for missing data (ALV, Open Time, Unstack, SLG, 14LC, Followed By); the user hasn't asked to change that.
- **Change log modal** — reads the `CHANGELOG` object, opened from the version badge.
- **Cache button** (`#storage-size`, far right of the run list toolbar; the report page has none, nor the version badge) — character count of the analyzer's storage keys, shown as KB (the data is ASCII JSON). Its hover title adds the whole-site total against a ~5M-character quota that is **shared with NavBlue's own page**; yellow at 75%, red at 90%.
- **Toasts** (`showToast`) — the container sits at max z-index *and* is re-appended last in `<body>` on every toast. Both are needed: the validation and change log backdrops are also at max z-index, so only DOM order puts toasts above them.

### KPI tabs

The KPI box's tab bar holds one tab per saved category plus at most one unsaved **draft** ("New"), shown while `activeKPICategory` is `null`. With no saved categories the draft is open implicitly and the bar shows a hint instead of tabs — that is the first-use path. The **+** tab (`openKPIDraft`) only shows when there are categories and no draft is open. Each tab's **✕** (`closeKPITab`) deletes that category's KPIs after a `confirm()`, or discards the draft. There is no Clear KPI button any more.

The KPI fields are one shared set of DOM inputs. `switchKPITab` stashes the draft's values into `kpiDraftFields` when leaving it and `preloadKPIFields` restores them, so a half-filled draft survives a look at another tab.

**Locking.** `isKPILocked(kpi)` — parsed `grid` present plus `alvTarget` and `gridText` — means a report has run against the category. Locked tabs get `.kpi-locked` on `#kpi-box` and `readOnly` on the `.kpi-input` fields, styled as plain text. Those input styles live in the stylesheet, not inline: inline styles would beat the locked rules. The **Reserve Default toggle stays live** on a locked tab — the toggle is a view default, not a KPI, and saves straight to the category (the user asked for this explicitly).

`resolveKPIForRun(category)` decides what a run uses:

| Report's category | Active tab | Result |
|---|---|---|
| locked | anything, fields empty or locked | switch to it, use saved KPI (an empty draft is closed) |
| locked | editable with values typed in | **refuse** — the values would be silently ignored |
| not locked / new | editable (draft or unparsed stub) | `buildKPIFromFields`, save, lock, close the draft |
| not locked / new | locked (a different category) | **refuse** and open a draft — never copy one category's KPIs into another |

**Grid years.** `parseKPIGrid` still requires a 4-digit year. `expandTwoDigitYears` rewrites a leading `M/D/YY` (or `-`) to `20YY` *in the textarea*, on paste, on `change` (blur), and at the start of `buildKPIFromFields`; not on every keystroke, so the caret isn't moved and a half-typed year isn't expanded.

### Side panel reserve grid specifics

**Min shortfall.** When `minCoverage > 0` and `minCoverage > actualCoverage`, the Actual cell gets `.reserve-short` (orange) and a `-N` tag. The tag is absolutely positioned inside an inline `.reserve-num` span so it adds no width and the columns stay put. The rule is written `.ra-reserve-table tr td.reserve-short` so it outranks the weekend row tint. A narrow panel with a two-digit shortfall could push the tag into the Open Trips column; the fallback is tooltip-only.

**Celebration.** `renderReserveGridSection` sets `allDaysMeetTolerance` for every date *before* the Shortages Only filter skips rows. Every day must have a numeric Diff at or above `LOA.NET_TOLERANCE`, and a day with no Required or no coverage blocks it. Diff follows the Compare Gross toggle, so the banner says NET or GROSS. `renderCelebration()` is an overlay inside `.ra-reserve-grid-wrap` (`pointer-events: none` except for the card); the confetti is generated inline and plays once. `wireCelebration()` runs at the end of every `renderPanel`: it removes the previous document-level `pointerdown`/`keydown` capture listener and attaches a new one. That listener dismisses the banner on a click outside the card or on Esc, and does not swallow the click. Dismissal is keyed on `name|lastUpdated` (only `applyUpdate` moves `lastUpdated`), so toggle re-renders don't replay it but the next Analyze does. It is the 1.x `celebrateNET()` banner (removed in v2) brought back with motion; `git -C "../Run Analyzer" show a095a01:scx_pbs_analyzer.js` has the original.

**Coloring grid.** `COLORING_GRID` matches a date, then any run of `AM|PM|RE|14LC <n> <n>` bands, then `TOTAL:`; `COLORING_BAND` reads each band (the second number is the actual). Bases print only the bands they use — AFW and CVG have no AM — so a band that isn't printed stays **absent**, not 0. `renderColoringSection` shows a band column only if some day has an actual for it or the KPI requires it (> 0); a cell with no actual renders `req | —` with no pass colour. Before v5 the pattern demanded all four bands in order, so no-AM bases parsed nothing and showed the "Load a Dynamic Stats report" fallback. Reports *saved* before v5 keep that empty coloring until their Dynamic Stats is loaded and saved again; downloads re-read themselves.

### Reserve grid comparison specifics

`renderCompareGrid` has three column *groups* — OT, NET/GROSS, DIFF — each spanning one sub-column per report. `visibleGroups` (from `compareGridColumns`, toggled by the Columns chips) drives four things that must stay in lockstep: the `<colgroup>`, the group headers, the per-report sub-headers, and the row cells. If you touch one, touch all four; the extraction harness above checks exactly this.

The coverage group renders `compareBase` — whichever of gross/net the Compare Gross toggle selects — so it always matches what DIFF was computed from, and its header text flips `NET`/`GROSS`. Each report's DIFF sub-header carries its own `Σ` total; days with no coverage data or no Required value are skipped rather than counted as zero.

## Run list page

Everything here runs only when `IS_RUN_LIST`. NavBlue's run list page is the whole PBS app (other screens too), and its widgets are absolutely positioned with generated ids (`completed_runs_groupbox_691`, `run_manager_tab_completed_dynamic_stats_button_797`) — select by id **prefix**, never the full id.

**Selecting a run.** The XHR/`fetch` hooks at the top of the IIFE (installed at `document-start`) watch NavBlue's own `class.cgi` POSTs. Any whose `nws` body names exactly one `<RunId>` and a `<PeriodId>` is a run selection — clicking a run name sends one. `capturedRun` keeps the identity fields (`ALC`, `LogPersonId`, `LogUserType`, `PeriodId`, `RunId`, `LanguageCode`), and `window.__raRunListOnCapture` refreshes the button. Our own requests use `origFetch`, so they are never captured.

**Downloading.** One POST to `/cgi-bin-xml/class/class.cgi?getRunReport`, form field `nws`:

```xml
<Call><Function>getRunReport</Function><Attributes><ALC>SCX</ALC><LogPersonId>…</LogPersonId><LogUserType>Scheduler</LogUserType>
<PeriodId>29</PeriodId><RunIdList><RunId>8659</RunId></RunIdList><LanguageCode>EN</LanguageCode>
<Reports><Report><ReportType>Statistics</ReportType><Options></Options></Report>
<Report><ReportType>DynamicStatistics</ReportType><Options></Options></Report>
<Report><ReportType>Unstacking</ReportType><Options><Reporting></Reporting></Options></Report></Reports></Attributes></Call>
```

That is exactly what NavBlue's report buttons send, one report each; NavBlue accepts all three in one call. Auth is the session cookie (`credentials: "same-origin"`). The reply is XML: `<name_undef><ReportText>` (all reports back to back, plain text, ~37K chars) and `<Status><Code>/<Message>`. `report.html` itself is a plain GET with no parameters that shows the session's "current report", which is why the analyzer never loads it. Untested: whether our call changes what a NavBlue report window shows next, and whether `<RunIdList>` with several runs works (that would allow a "pull several runs for Compare").

`readReportText()` (shared with the report page, see *What this is*) cuts the reply at each report's header with `REPORT_STARTS` and parses each segment. Cut first, then parse: `DYNAMIC_STATS_w_NAME` is greedy and would run across the whole reply. Every report must name the same run or nothing loads. A report missing from the reply (Unstacking not run yet) is listed in the toast and the rest still load. Partials are applied Stats → Dynamic → Unstacking onto a fresh report (`buildReport`).

**Downloads store** (`NBAnalyzerPulls`, `pulledRuns` in memory) — keyed `PeriodId:RunId`: `{ name, ts, missing, partials, textGz, parser }`. `textGz` is the report text gzipped (`CompressionStream`) as base64; plain `text` is memory only. `savePulls()` keeps the newest 40 and halves on a quota error. The button reads **Download Run** (`data-state="idle"`), **Analyze Run** when stored (`ready`, opens without a request), **Downloading… Ns (click to cancel)** (`busy`, 90s timeout via `AbortController`), **Select a run** (`none`); ↻ forces a new download. A failed or cancelled re-download keeps the earlier one.

**Re-reading stale downloads.** `PARSER_FINGERPRINT` is an FNV-1a hash of the source (`Function.prototype.toString`) of every parser and helper (including `flattenReportText` / `splitReports` / `readReportText`) plus the `PATTERNS`, `INPUT_SPEC` and `REPORT_STARTS` values. Each download records the fingerprint it was parsed with; `reparseIfStale()` re-parses from the stored text when it differs, saves, and toasts once. So **any parser change automatically reaches old downloads**: there is no version to bump. If a new parser depends on a helper not in that list, add the helper to the list.

**Toolbar** (`#ra-drawer`, the top bar `wrapper` restyled as a fixed box). `placeDrawer()` (on a 500ms timer plus resize/scroll) puts it right-aligned just above `[id^="completed_runs_groupbox_"]`, and sets `--ra-panel-top` so the panel starts under it. When that box isn't on screen (zero rect, `visibility:hidden`, or covered according to `elementsFromPoint`, ignoring our own layers) the toolbar hides and the panel closes; once a run has been analyzed, an **Analyzer** tab (`#ra-away-tab`, vertical, right edge, showing the run name) opens it full height (`.ra-away`) until ✕. Back on the list the panel is restored to how it was left there. (Before, the panel hid outright, so it was unreachable while the launcher was open.) Buttons, in this order (the user set it): Download/Analyze, ↻, **KPIs ▾**, **View Text**, **Compare ▾** (in Manage Reports' place, which the run list does not have), **Validate** (View Text and Validate are disabled until the selected run is downloaded; Validate runs `runAllValidations` on the run built as Analyze builds it, `buildReport`), **Highlight: ON ▾**, then the shared version / Cache. They are styled in the stylesheet (`#ra-drawer .ra-strip-btn`, `[data-state]`), not inline, so `:disabled` greys them. The report page uses the same `#ra-drawer` id and `setPane` (KPI pane only), but not fixed: an in-flow full-width bar at the top of the page (the user asked for it to sit on the page like the old KPI box, not float), so only the run list sets `--ra-panel-top`. The KPI box, the highlighter's `#ra-hl-pane` and Compare's `#ra-cmp-pane` drop down under the strip; `setPane("kpi" | "hl" | "cmp" | null)` keeps **only one open** (and calls `onPaneChange`). Download/Analyze Run (`pullAndAnalyze`, on the click) and the report page's Analyze close whatever pane is open (`setPane(null)`); `finishRun` then opens the KPI pane when a run needs KPIs. Compare picks survive that, picking just pauses. z-index: toolbar 2147483642, above the panel (…640) and below the modals (…645+). A press outside the toolbar (capture-phase `pointerdown`) closes the open pane; a press on a run row (`div.TableRow[id^="cr_table_"]`) keeps Highlight and Compare open, since marking and picking need it. Match the rows, never `completed_runs_groupbox_`: that box wraps the whole run manager, child runs table included.

**View Text** opens a blank window synchronously inside the click (popup blockers allow only that), then fills it, unpacking `textGz` if needed. `fillTextWindow()` highlights every line the analyzer reads: `traceReportText()` re-runs the real parsers on a `TracedText` (a `String` subclass whose `match` / `matchAll` / `slice` record match positions via the `d` flag), then `flattenWithMap()` maps flattened positions back to raw lines. Capture groups are marked; a match without groups is marked whole. `TRACE_SKIP` leaves out the reserve grids and the Stats Options inputs (the user asked for that); parseInputs' patterns aren't in `PATTERNS`, so they drop out too. A new `PATTERNS` entry that reads an Options input belongs in `TRACE_SKIP`. The parsers use only `match`, `matchAll`, `search`, `slice` and `length` on their text — a parser that calls another string method on it (`indexOf`, `split`, `includes`) is invisible to the trace until `TracedText` hooks it. Not traced: anything run on a substring *value* (the coloring bands inside a row, the Options per-day grids read with `RegExp.exec`), so those lines show only through their enclosing match.

**Compare picking.** Picking is active exactly while the Compare pane is open (`cmpPicking()`). `window.__raRunListOnCapture` then also calls `addComparePick(capturedRun, name)`, which de-duplicates by key — one click can send several one-RunId requests — and caps at `COMPARE_MAX`. The name shown before a download comes from a capture-phase **mousedown** on the run row (`lastRowClick`, used if under 3s old; mousedown because NavBlue may select before `click`); once downloaded, the download's name wins. Already-downloaded runs are used as they are (the user's normal flow is Download, analyze, then Compare). A pick that isn't downloaded gets `cmpState = "waiting"` and `pumpCompareDownloads()` fetches them **one at a time** through `downloadRun()` — the same function Download Run uses (`pullAndAnalyze` is now just the button's state and cancel around it) — with their own `AbortController` (`"timeout"`, or `"removed"` when ✕ takes the pick out mid-download). Failed picks show Retry and block Done. **Done** needs ≥ 2 picks, all in `pulledRuns`; it re-reads stale ones, builds each with `buildReport` and calls `openCompare`. The picks are memory only and survive closing the pane, so Compare again resumes them; Clear empties them. `+ Selected run` adds the run that was selected before the pane opened.

### Run Highlighter

`startRunHighlighter()` holds the former standalone "PBS Run Highlighter" userscript (v1.2, from the sibling `Highlighter/` repo), nearly verbatim. It colours each Completed run row green / yellow / red by its ALV against the category's published ALV (`NBAnalyzerKPI`, read-only here, or one typed into its pane), shows each run's `OT x%, R n` stats at the right of its Name cell (`setStats`, `.nbh-stats`: absolutely placed on solid white, so a long name runs under it rather than wrapping out of the 18px row; v5.1.1 took them off the rows and the team asked for them back) and the current run's again in orange at the left end of the toolbar (`#hl-run-stats`, only while highlighting is on and that run has captured stats), and ★/✕ marks on hover. It reads stats from NavBlue's own Statistics panel when a run is clicked, not from downloads. Its tolerances are `LOA.ALV_TOLERANCE_*` / `LOA.SMALL_POSITION_LINES`.

Changes from the standalone: its panel is a shadow DOM host (`#ra-hl-host`) inside `#ra-hl-pane`, without the floating header, fold or drag. The toolbar button shows `Highlight: ON/OFF ▾/▴`, green when on, with a red ring (`hl-warn`) instead of the panel opening itself for the no-ALV reminder. Its MutationObserver ignores changes inside `#ra-drawer` / `#ra-panel`. **If the standalone script is still installed** (its `#nbh-host` appears), the built-in one stands down: it hides its button, removes its pane and toasts once. The row classes (`nbh-green` etc.) are the same in both, so they never fight. The detailed NavBlue run list DOM notes (signature vs run rows by cell count, the selection-style quirk, the 2.5s guard after a signature switch, 18px clipped rows and `fitInCell`) are in `Highlighter/CLAUDE.md`. Its options get a clean-up later (the user said so).

**KPI run / ALPA run** (added in v5, not in the standalone): set from the options box, not the rows (chips in the 18px rows were too crowded, so the user moved them). **Mark KPI** (orange) and **Mark ALPA** (light blue) sit between the ON/OFF button and the clear buttons. Each holder's run name is under its button in 10px text that wraps, so long names don't overlap. They act on `selRunForButtons`: the selected run row (`selectedRunName()`), else `lastClickedName` if that run is still listed; with neither they are disabled. On the run that already holds the role the button reads **Unmark …** and clears it. Roles are stored in `NBRunHighlighterRoles` as `{ "CAT|Period": { kpi: runName, alpa: runName } }`, so there is at most one of each per signature + month; `toggleRole()` moves a role to the given run, and a run holds only one role (setting the other clears it). A role's row colour (`nbh-kpi` orange `#ffb74d`, `nbh-alpa` light blue `#90caf9`) **replaces** the ALV colour, even for a run with no captured stats, and its tooltip is prefixed `KPI run — …` / `ALPA run — …` with the ALV check kept. Clear marks clears the roles too, and they are hidden while highlighting is off.

**Custom colours** (v5.2): a **Mark Color** button, full width under Mark KPI / Mark ALPA, with an `<input type="color">` swatch joined to its right end. Unlike the roles, **any number of runs** can have one, each its own colour: `NBRunHighlighterColors` `{ 'CAT|Period|Run': '#rrggbb' }`, keyed like the ★/✕ marks; the picker's last colour is `NBRunHighlighterPick` (default `#ce93d8`). The button toggles the picker's colour on `selRunForButtons` (`toggleCustom`), reading **Unmark Color** on a run that has one, and wears that run's colour (else the picker's), with black or white text by luminance (`textOn`). The picker's `change` sets the next colour and, if the selected run has a custom colour, recolours it; `input` only previews on the button. Rows get `nbh-custom` plus two CSS variables set on the row (`--nbh-custom`, `--nbh-custom-fg`), cleared in `setRow` when the class goes. Under it, four quick-colour slots (v5.5, `NBRunHighlighterSwatches`, an array of `'#rrggbb'` or `null`): an empty `+` slot saves the picker's colour, a full one picks it through `setPick` (the same path as the picker's `change`), and its hover ✕ empties it. The slot matching the current pick gets a ring. Precedence: KPI/ALPA role, then custom, then ALV. Tooltip prefix `Custom highlight — …`; the status line counts them; Clear marks clears them for the signature + month.

### Paste Targets

`startPasteTargets()` (v5.3) replaces the retired **Paste Reserve Targets** Chrome extension (`../../NavBluePasteReserveTargets/`, v1.3). It shows a **Paste Targets** button on NavBlue's run setup screen, not in the toolbar (the toolbar is hidden there). The button is fixed-position, placed by `place()` on a 500ms timer just right of the last band's table (RE), level with its top. The user asked for it there, and bigger, after a first try on the group box's top-right border sat too far from the inputs. It stays in view while that screen is showing, wherever the Short Call Types group box (the nearest `.groupbox` holding all three tables, `shortCallBox()`) has been scrolled. NavBlue scrolls it inside its own pane, not the window, so `place()` works against the visible part of the nearest overflow-clipping ancestor (`scrollPane` / `visibleArea`). It behaves like CSS `position: sticky`: at its spot while that is in view, held at the pane's top once the tables scroll up past it, and hidden while the tables are still below the visible part. Pinning it to the bottom edge was tried, and the user didn't want it. It also hides when the box isn't laid out, or when `elementsFromPoint` says another screen covers it. A window-based check made it vanish whenever the box's top scrolled under the pane.

The screen (Dec 2026 probe): `reserve_short_call_parameters_table_{AM,PM,RE}_<n>`, one `.TableRow` per day, each holding a `Dec 1` label and one `.IntegerSpinner input.ValidatingText`. There's also `reserve_parameters_table_<n>` (Min / Max), which this feature doesn't touch. A band can be inactive: `fillable()` treats a disabled, read-only, hidden or `[disabled]`/`.disabled`-wrapped input as not fillable, and those cells are never written. That test is a guess, not yet checked against a real inactive band.

Sources: a saved KPI category's `grid` (ISO dates → `{ AM, PM, RE, LC, total }`), or a paste box run through `expandTwoDigitYears` + `parseKPIGrid`. Its day-count and bid-month errors are ignored, since rows are matched by date anyway; its line errors are shown. The source defaults to the screen's **Group** drop-down (`select[id^="add_run_to_queue_rungroups_"]`, read via its `.value` property; the `Select a RunGroup...` prompt counts as none) when that category has a saved grid. `autoFor` remembers the Group last applied, so a hand-picked source sticks until the Group changes or the pop-up is reopened; the messages warn when the source and Group differ or the Group has no KPIs. Matching is by month and day (`"12-1"`), because the labels have no year. `buildPlan()` drives both the preview and `fill()`, so the two can't disagree. Writes copy the extension's events (focus, set `value`, `input`, `change`, then blur the last field). **Never `new Event()` on the run list:** NavBlue replaces the global `Event` with its own, so it throws `Event is not a constructor`. The extension's isolated world never saw that, but a userscript shares the page's globals. `fire()` uses `document.createEvent("HTMLEvents")` instead, and any new synthetic event (mouse, keyboard) needs the same treatment. That throw was why the first live tries filled only one field. Input references are also never held across writes, in case NavBlue redraws: `applyWrites` looks each field up again by band and date (`cellNow`) right before writing it, writes one at a time with a 25ms pause, then reads every field back the same way, so a value that didn't take is reported. Undo keeps `{ band, md, prev }` and goes through the same path. There is no Zero all: NavBlue has its own button for that, so the user had it removed. The pop-up re-renders every 2s while open, except while focus is inside it, and `render()` skips the DOM write when the HTML is unchanged (`lastHTML`). Otherwise every refresh threw the scrolled date list back to the top. When it does rewrite, it restores `.pt-grid`'s `scrollTop`.

### Launch screen Diff

`startLaunchDiffs()` (v5.4) writes the analyzer panel's run (`workingReport` + `currentKPI`) reserve Diff into the right side of each Min cell of the run setup screen's `reserve_parameters_table_<n>` (Date / Min / Max), as a reference while typing new Mins: a signed Diff coloured like the panel (`ra-ld-pos/mid/neg`, its own classes because the panel's `diff-*` are `!important` and made for the dark panel), then `NET 12 / Req 10`. A caption beside the header's `Min` names the run and NET/GROSS, amber when the run's category isn't the screen's Group. The tags are `span.ra-ld-tag`s inside NavBlue's cell (`pointer-events: none`, `right: 22px`, clear of the spinner), so they scroll and clip with the table; a 500ms pass re-applies them after NavBlue redraws and writes only what changed. Rows match by month and day. The Diff comes from `reserveDayDiff()`, which the panel's Reserve Grid also uses, so it follows the Compare Gross toggle. Not yet seen live: whether NavBlue's header really has a leaf element reading `Min`, and whether its redraws leave the tags alone.

The same 500ms pass (`applyStacks`, v5.5) tags the **Max Stack Height** screen: one `.DayIntegerSpinner#daySpinner_Dec_1_<n>` per day (a `.Label` reading `Dec 1`, then an `.IntegerSpinner` holding the input), the tag going inside the `.IntegerSpinner`, starting at its middle (`ra-ld-stack`: `left: 50%`, left aligned; the box is ~1250px wide). It shows the panel run's `openTrips` for the day (the number alone, no `OT`), red (`ra-ld-neg`) when over `computeMaxStack`, as the Reserve Grid's Open Trips cell, then the max stack and the run name. It matches every `daySpinner_` on the page, on the guess that only that screen uses them.

## Conventions

- **Version:** `SCRIPT_VERSION` must match `@version` in the metadata block. Add a `CHANGELOG.releases` entry (newest first) for user-visible changes and **keep only the five most recent releases**: drop the oldest when adding one, across major versions too (not cleared on a major; the user changed this rule at v5). Set `CHANGELOG.major` to the current major. Notes are user-facing prose, not commit summaries.
- **Publishing (Tampermonkey auto-update, since v5.5.1):** `@updateURL` / `@downloadURL` point at `https://raw.githubusercontent.com/alpaodor/userscripts/main/scx_pbs_analyzer.user.js`. To release: bump `@version` and `SCRIPT_VERSION` (Tampermonkey only updates when `@version` goes up), add the change log entry, commit on `main`, and the user pushes. Installs check about daily, or at once with Tampermonkey's Check for userscript updates. **The repo is public:** never put crew data in the script or this file, not even in comments. Example report rows (No Line, IOE, RLL) use made-up employee numbers like `10001`; before v5.5.1 they were real ones copied from reports. Test scripts and probes (the `test_*.user.js` kind, which carry a LogPersonId and other identity fields) stay untracked or in the scratchpad, never committed here.
- **Commits:** `type: summary` subject (`feature:`, `fix:`, `improvement:`), then wrapped prose explaining *why* and what was load-bearing. Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. History runs straight on `main`; branch only for larger work.
- **Dates:** ISO `YYYY-MM-DD` everywhere except the scheduler `inputs` grids, which keep the raw `YYYYMMDD` and must go through `formatDate()` before `isWeekend()` will read them. `isWeekend` parses via `Date.UTC` so local time can't shift the day.
- **Shared classes:** `weekend` (row tint + orange date), `diff-green` / `diff-red` / `diff-neutral`, `stack-red`. Weekend CSS is scoped per table (`.ra-reserve-table`, `.ra-compare-grid-table`, `.ra-ic-table`) — a new date table needs its own rule.
- **Style:** indentation is inconsistent (tabs and stray outdented blocks, especially inside `renderCompareGrid`); match the surrounding lines rather than reformatting, so diffs stay readable.

## State of play (Nov 2026)

`v5.5.1` is the current version, the first in this repo (auto-update, and placeholder employee numbers in the example rows). Everything below happened in the archive repo `../Run Analyzer/`, so its hashes and branch names are there. `v5.5` was the last version there (5.3.1–5.3.3, 5.4 and 5.5 were committed straight on its `main`): `feature/compare` → `feature/no-save` → `feature/reserve-targets` were merged in on 2026-11-09 (`238b006`); the feature branches are kept but have nothing left to merge. The no-save work ships as part of 5.2 (the user folded an earlier planned 5.3 into it, with one combined change log entry); Paste Targets is the 5.3 that now exists. Commits on top of v4.0:

1. `c5e7377` — `resolveLineCount()`; every line-count consumer routed through it (fixes the compare summary showing "Save Stats" on a Dynamic-only report); reserve grids switched from Stats-first to Dynamic-first; `validateMaxStack` no longer reports green when it has no line count; coverage column follows the Compare Gross toggle; Columns show/hide chips.
2. `5912459` — per-report `Σ` totals in the compare grid DIFF headers.
3. `e6e021b` — weekend tinting in the Input Compare per-day grids.
4. **v4.2** — IOE trip count. Since v5.2 there is no button in the KPI box: on a report page showing the **IOE Pairings** report, the toolbar's **Validate** runs this check instead of the CBA checks (`pairingsReportInfo()` → `validatePairingsReport()`, two rows in the validation modal): **IOE Trips** and **Max IOE Withheld (8%)**, the count against `computeMaxIOE(totalTrips)` — the same 8% figure the panel shows for FO runs. Total Trips is the report category's saved `totalTrips`, else the field while it shows that category or the draft. The Reserve Default toggle now sits beside Total Trips. Analyze on that page toasts a pointer to Validate.

   The report is a plain list, **one trip per line**: `Employee  Pairing Number  Start Date` headings, a `-----` rule, rows like `10001  M0101  2026-11-05`, a rule, `End of IOE Pairing List`. `countIOETrips()` counts the `IOE_LIST_ROW` matches between `Start Date` and the end line, and doesn't lean on newlines; the same employee and pairing on several dates are separate trips. An empty month (only the two rules) is 0 trips, green; no end line means the report isn't whole (`default`). Checked against a real Nov 2026 MSP-737-CA report (76 trips, 16 employees) and an empty Dec one. The first v5.2 attempt (and v4.2's Validate Pairings button) counted day numbers in per-pairing `<pre>` calendars from a different report; that code is gone.

   Header `IOE Pairings Period: Nov_2026 Category: MSP-737-CA`. The text is read first from the raw copy NavBlue keeps in the hidden `#report_hidden_nws` field (a `saveReport` call, `<ReportText><![CDATA[…]]>`, newlines intact). Fallback: `textContent` finds the innermost element holding the header, then its `innerText` is read. The visible lines are split by `<br>`, which `textContent` drops (`IOE PairingsPeriod: Dec_2026Category: MSP-737-CAEmployee…`), so the separators are `\s*` and the category stops at whitespace or `Employee`; `\s+` there was the first version's live bug ("Report type not recognized"). Don't commit a real list: it is crew data.

   Style that button (and anything else needing a `:disabled` look) from the stylesheet, never inline: an inline `background` beats any selector, which is exactly why the first version never greyed out.

5. **v4.3** — Reserve Unstack % column in the compare summary (the pairing column is now labelled Pairing Unstack %), and RLL line counting: parsed in `parseRunDetail`, shown as the first line item in the General section's left column (`0` when none, `Check Stats` when Stats has not run), and as an `RLL` column in the compare summary.
6. **v4.3.1** — Priority Stack Date check no longer fails every November date.
7. **v4.3.2** — 14LC requirement is tiered (1–4 reserves → 1, 5–10 → 2, above 10 → 20%) in `computeRequiredLC()`, which both the validation modal and the side panel call.
8. **v4.4** (`4467b84`) — the KPI tabs (draft / + / ✕ / locking, see *KPI tabs* above), replacing Clear KPI; Load & Run parses the report before touching KPIs; 2-digit grid years expanded to `20YY`; the Cache button; toasts above every layer.
9. **v4.5** — Bidders with No Line at the top of the General section (Stats or Dynamic); the reserve grid's Min column parsed and an orange Actual cell with a `-N` shortfall when Min outruns Actual; the reserve grid celebration restored (see *Side panel reserve grid specifics*).
10. **v5.0** — the run list page: run capture, one-call download of all three reports, stored downloads with automatic re-reading, the toolbar with KPI/Highlight panes, the full-width two-column panel, and the built-in Run Highlighter (see *Run list page*). Also for both pages: the Unstacking & SLG section, and the coloring grid fix for bases without AM. It was prototyped as separate test userscripts (a request-capture probe, then a generated copy of the analyzer for `main.cgi`), which the user tested live before the merge.
    Within 5.0 (uncommitted, the user keeps the version at 5.0 until the commit): one reader for both pages (`readReportText`, `flattenReportText`, `mergeIntoSaved`), so Load & Run flattens whitespace exactly like a download; `origFetch` tolerates a window without `fetch` (jsdom); the highlighter's options box is centred in its pane.
11. **v5.1** — View Text highlights the lines the analyzer reads (see *Run list page*), except the reserve grids and the Stats Options inputs. Verified in jsdom against a hand-built three-report download; not yet seen on the real page or against a real ~37K-character download.

12. **v5.2** (branch `feature/compare`) — on the run list Manage Reports became **Compare** (pick runs in the list, Done), and **Validate** joined the toolbar; the compare window gained the Analysis / Inputs switch, with Inputs comparing 2–10 reports instead of exactly two. (v5.2 then removed Manage Reports from the report page too.) Also: the Unstacking OFF check (see *Which report gives which number*), the pick pane's button reads `Compare N` (no Done), Highlight ON is pale yellow, Validate white. Verified in jsdom on both pages; not yet seen live: the OFF lines against a real Unstacking report, the pane in the dark toolbar, whether a real run click sends one or several captured requests, the mousedown name grab against NavBlue's rows, and the Inputs table at 10 columns.
13. **v5.2, continued** (branch `feature/no-save`) — Save, saved reports (`NBAnalyzerReports`, deleted on load), Manage Reports and the Notes box removed everywhere; `mergeIntoSaved` became `buildReport` (fresh object each time). The report page got the three-button widget (Analyze, KPIs ▾, Validate) with no version badge or Cache, at the user's request. PSD checks no longer pass on missing data. The panel's Reserves section is split from the Reserve Grid (summary left, grid right). Verified in jsdom on both pages; not yet seen live: the bar and the KPI drop-down on a real report page.
14. **v5.2, more** (branch `feature/no-save`) — Highlight and Compare panes solid like the KPI box, the highlighter's options straight on the dark pane (no card) with its status on the right; Validate on the IOE Pairings report (see item 4), replacing the KPI box's Validate Pairings button; Mark Color custom highlights (see *Run Highlighter*); Download/Analyze closes open panes. Verified in jsdom, the IOE count against a real Nov 2026 list; not yet seen live: the restyled panes, the Mark Color swatch and the native colour picker inside the shadow DOM.
15. **v5.3** (branch `feature/reserve-targets`) — Paste Targets, replacing the Paste Reserve Targets Chrome extension (see *Paste Targets*). Also on `feature/no-save` before it: drop-downs close on a click off the toolbar. Tested live by the user: KPI and paste sources, inactive bands, the preview, Fill, Undo, saving in NavBlue, the button's position and scrolling.

16. **v5.4** — the launch screen's Min cells show the panel run's reserve Diff (see *Launch screen Diff*). Verified in jsdom against a copy of the real Min/Max row markup; not yet seen live.
17. **v5.5** — open trips on the Max Stack Height screen's day boxes (see *Launch screen Diff*), and four saved quick colours under Mark Color (see *Run Highlighter*). Verified in jsdom (the stack tags against the pasted spinner markup); not yet seen live.

**Unfinished: run ranking** (`feature/ranking` in the archive). The work is a stash there (`stash@{0}`, on top of v5.3.1) plus untracked test scripts; see the ranking-design memory. To pick it up, export the stash's diff of `scx_pbs_analyzer.js` (`git -C "../Run Analyzer" stash show -p stash@{0} -- scx_pbs_analyzer.js`), apply it here on a new `feature/ranking` branch, and resolve against 5.3.2–5.5.1. Leave the test scripts out of this repo.

Known rough edges, none urgent:

- **KPI tabs at scale.** `#kpi-tab-bar` wraps; at ~120px a tab, the 760px run list KPI box fits about 6 a row, and the folder-tab look only reads right on the bottom row. Discussed for 15+ categories; the user chose to wait. If it comes back, the preferred fix was a category drop-down (with ✕ / +) above ~6 categories.

- The Gross/Net ordering change means max stack height and required reserves now resolve Dynamic-first where they used to be Stats-first. If both values are present and disagree, a borderline Max Stack Height result can differ from what an older run showed. Not yet spot-checked against a known-good report in the browser.
- Everything since v4.0 has been verified by logic extraction only. The actual rendering — column chips, Σ placement in a 34px column, weekend tint against the red diff tint — has not been looked at in a real browser.
- v4.4 was verified in jsdom only. Not yet seen on the real page: the ✕ inside the tab buttons, the locked fields' read-only look (including the hidden number spinner on Total Trips), the Cache button's alignment at the far right, and toasts over an open side panel.
- v4.5 was verified by logic extraction and jsdom only: the No Line parser against the two sample lines from the real reports, the Min shortfall render, and the celebration's show / dismiss / no-replay flow. Not yet seen on the real page: the No Line row wrapping a long employee list, the `-N` tag's fit beside the number, and the confetti and card over the grid.
- v5.0 as merged was verified in jsdom only, on both pages. Its run list pieces were tried live by the user as test scripts *before* the merge: capture, combined download, splitting, the toolbar position, the panel layout and sizes. Not yet seen live: the merged script as a whole, the built-in highlighter in the toolbar (its pane keeps the light standalone look inside the dark toolbar), View Text's greyed look, the one-pane rule, and the coloring fix against a real AFW/CVG report.
- `rllLines` was tested against a hand-built sample of the RLL table, not a real Stats report. The first run against one that actually used RLL is the real test of `RLL_EMPLOYEE_BLOCK`.
