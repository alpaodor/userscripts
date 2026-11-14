// ==UserScript==
// @name         PBS Analyzer 5
// @namespace    reserve-analyzer
// @version      5.5.2
// @description  Used to analyse a NavBlue Blue PBS Run for Sun Country Airlines. On report pages it reads the Stats/Dynamic Stats/Unstacking report on screen; on the PBS run list it downloads all three for the selected run, and colors the run list (Run Highlighter). It persists KPI data and compares output to the CBA. Co-authored by Ryan Odorizzi, OpenAI, and ClaudeAI.
// @match        https://scx.pbs.vmc.navblue.cloud/class/report.html
// @match        https://scx-uat.pbs.vmc.navblue.cloud/class/report.html
// @match        https://scx.pbs.vmc.navblue.cloud/cgi-bin-xml/class/main.cgi*
// @match        https://scx-uat.pbs.vmc.navblue.cloud/cgi-bin-xml/class/main.cgi*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/alpaodor/userscripts/main/scx_pbs_analyzer.user.js
// @downloadURL  https://raw.githubusercontent.com/alpaodor/userscripts/main/scx_pbs_analyzer.user.js
// ==/UserScript==
(function() {
    'use strict';

    // Two pages share this script (CLAUDE.md, "Run list page"). The report page mode may be
    // removed once the user has consulted the team; until then both must keep working.
    //   report.html — NavBlue's report window: Load & Run reads the report on screen, sidebar panel.
    //   main.cgi    — the PBS app itself, run list included: Download Run fetches Stats + Dynamic Stats
    //                 + Unstacking for the selected run, full-width panel, built-in Run Highlighter.
    const IS_RUN_LIST = /\/main\.cgi$/i.test(location.pathname);
    if (IS_RUN_LIST && window.top !== window.self) return; // the app may use frames; top page only
    console.info(`[PBS Analyzer] loaded (${IS_RUN_LIST ? "run list" : "report page"})`);

    // ---------------- Run capture (installed before the page's own scripts run) ----------------
    // Any class.cgi request that names exactly one RunId and a PeriodId is a run selection.
    // The rest of the call's identity fields are kept so our own request matches NavBlue's.
    let capturedRun = null; // { ALC, LogPersonId, LogUserType, PeriodId, RunId, LanguageCode, ts, fn }
    const origFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null; // our own requests, never captured

    function xmlField(xml, tag) {
        const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
        return m ? m[1] : null;
    }

    function nwsFromBody(body) {
        if (body == null) return null;
        try {
            if (typeof FormData !== "undefined" && body instanceof FormData) return body.get("nws");
            if (body instanceof URLSearchParams) return body.get("nws");
            if (typeof body === "string") {
                if (body.trim().startsWith("<")) return body;
                return new URLSearchParams(body).get("nws");
            }
        } catch (e) { /* not a body we understand */ }
        return null;
    }

    function noteRequest(url, body) {
        if (!/class\.cgi/i.test(String(url))) return;
        const nws = nwsFromBody(body);
        if (!nws) return;
        const runIds = nws.match(/<RunId>[^<]*<\/RunId>/g) || [];
        const periodId = xmlField(nws, "PeriodId");
        if (runIds.length !== 1 || !periodId) return;
        capturedRun = {
            ALC: xmlField(nws, "ALC") || "SCX",
            LogPersonId: xmlField(nws, "LogPersonId"),
            LogUserType: xmlField(nws, "LogUserType"),
            PeriodId: periodId,
            RunId: xmlField(nws, "RunId"),
            LanguageCode: xmlField(nws, "LanguageCode") || "EN",
            fn: xmlField(nws, "Function"),
            ts: Date.now(),
        };
        console.info("[PBS Analyzer] run selected:", capturedRun);
        if (typeof window.__raRunListOnCapture === "function") window.__raRunListOnCapture();
    }

    if (IS_RUN_LIST) {
        const _xOpen = XMLHttpRequest.prototype.open;
        const _xSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this.__raUrl = url;
            return _xOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body) {
            try { noteRequest(this.__raUrl, body); } catch (e) { console.warn("[PBS Analyzer] run capture failed", e); }
            return _xSend.apply(this, arguments);
        };
        window.fetch = function (input, init) {
            try { noteRequest(typeof input === "string" ? input : input?.url, init?.body); } catch (e) { /* ignore */ }
            return origFetch.apply(this, arguments);
        };
    }

    const PULLS_KEY = "NBAnalyzerPulls"; // downloaded runs: { "PeriodId:RunId": { name, ts, missing, partials, textGz, parser } }

    // Everything below needs <body>; @run-at document-start (for the run capture) gets here before it exists.
    function __raMain() {

    // ---------------- Version & Change Log ----------------
    // Keep SCRIPT_VERSION in sync with the @version metadata above.
    const SCRIPT_VERSION = "5.5.2";

    // Change log: the five most recent releases, newest first. When adding a release, drop the
    // oldest so five remain — across major versions too (it is not cleared on a major bump).
    // `major` is the current major version.
    const CHANGELOG = {
        major: 5,
        releases: [
            {
                version: "5.5.2",
                notes: [
                    "The Open Time section now shows the run's Open Time Credit in hours (for example 412:30), just above the 2% limit. It comes from the Stats report; until Stats has run it reads Check Stats.",
                ],
            },
            {
                version: "5.5.1",
                notes: [
                    "The analyzer now updates itself. Tampermonkey checks GitHub for a new version (about once a day, or straight away with Check for userscript updates in its menu) and installs it, so there is no more pasting in a new copy.",
                ],
            },
            {
                version: "5.5",
                notes: [
                    "On the Max Stack Height screen, each day's box shows that day's open trips for the run open in the analyzer, in the middle of the box: red when they are over the run's max stack height, as in the Reserve Grid's Open Trips column, followed by the max stack height and the run's name.",
                    "Run Highlighter: four slots under Mark Color save colours for quick picking. Click an empty slot (+) to save the current colour there, click a saved colour to pick it, and use the ✕ on a saved colour to empty its slot.",
                ],
            },
            {
                version: "5.4",
                notes: [
                    "On the run setup screen, each day's Min box now shows that day's reserve Diff on its right, for the run open in the analyzer, as a reference while you type new Mins: the Diff in green, grey or red as in the Reserve Grid, then the coverage and Required it came from (NET 9 / Req 12, for example). It follows the panel's Compare Gross toggle.",
                    "A caption beside the Min heading names the run and says NET or GROSS. It turns amber when that run's category isn't the Group selected on the screen.",
                ],
            },
            {
                version: "5.3.3",
                notes: [
                    "Run Highlighter: a run whose Statistics show convergence as not used is now green when its ALV is within tolerance, as intended. Runs whose stats were saved by the old standalone highlighter before it knew about Not Used stay yellow until you click them once.",
                    "The General section now lists Min Window Bidders Honored and Max Window Bidders Honored, under RLL Lines. The counts come from Dynamic Stats; when Stats has run too, each shows how many were allowed (for example 3 of 5 allowed).",
                    "In the Unstacking & SLG section, SLG Pairing # is renamed SLG's above 10%.",
                    "Unstack Pairing % now reads 0.00% when the Unstacking report prints (None), instead of falling back to the yellow Dynamic Stats estimate.",
                    "When unstacking is turned off for a run, the Unstacking report has no SLG figures, so both SLG rows (and Validate's 10% SLG check) now use Dynamic Stats instead of staying yellow. 0 lines with SLG is green; SLG Pairing % is checked against its limit; a count above 0 stays yellow, since Dynamic can't tell how many lines are above 10%.",
                    "Run Highlighter: the OT % and reserve days are back on every run row, at the right of the run name, on a white tag so a long name can't push them out of sight. The selected run's figures still show at the left end of the toolbar too.",
                ],
            },
        ],
    };

    // ---------------- Configuration Constants ----------------
    const LOA = {
        NORM_WINDOW_FLOOR: 4200, //mins = 70:00 hours
        MIN_WINDOW_FLOOR: 4170, // mins = 69:30 hours
        LOWEST_THRESHOLD_MIN_WINDOW: 4200, //mins = 70:00 hours
        RLL_WINDOW_FLOOR: 3600, // mins = 60:00 hours
        MAX_MIN_OFFSET: 14 * 60, // alv +/- 14 for min low, max high
        NORM_OFFSET: 7 * 60, // +/- 7 hours
        MAX_FOLLOWED_BY: 1110, // mins = 18:30 hours
        NET_TOLERANCE: -2,
        OPEN_TIME_LIMIT: 2.0,
        IOE_LIMIT: 0.08,
        ALV_TOLERANCE_MINUTES: 60,
        ALV_TOLERANCE_SMALL_MINUTES: 120,
        SMALL_POSITION_LINES: 75,
        ALV_LOW: 72 * 60,
        ALV_HIGH: 88 * 60,
        DAILY_STACK_LIMIT: 0.05,
        DAILY_STACK_LIMIT_HIGH_OT: 0.06, // allowed when open time > OPEN_TIME_LIMIT
        LC_PERCENT: 0.20,
        UNSTACKING_NORMAL: 30.0,
        UNSTACKING_HOLIDAY: 50.0,
        SLG_PERCENT: 0.1,
        HOLIDAY_MONTHS: { 1: 'jan', 7: 'jul', 11: 'nov', 12: 'dec' }
    };

    // Max stack height = round(lineCount * limit), true rounding to nearest whole.
    // Limit is 5% normally, or 6% when open time exceeds the open-time limit (2%).
    function computeMaxStack(lineCount, openTimePercent) {
        if (typeof lineCount !== "number" || Number.isNaN(lineCount)) return null;
        const limit = (typeof openTimePercent === "number" && openTimePercent > LOA.OPEN_TIME_LIMIT)
            ? LOA.DAILY_STACK_LIMIT_HIGH_OT
            : LOA.DAILY_STACK_LIMIT;
        return Math.round(lineCount * limit);
    }

    // Unstacking and SLG numbers come from two places. The Unstacking report carries the
    // official (contractual) numbers; Dynamic Stats only gives an early estimate of where
    // they will land. Official always wins, and a Dynamic-sourced value is flagged
    // "estimate" so the UI can show it as yellow rather than pass/fail it.
    function resolveUnstackStat(stats, officialKey, dynamicKey) {
        const official = stats?.[officialKey];
        if (typeof official === "number" && !Number.isNaN(official)) {
            return { value: official, estimate: false };
        }
        const dynamic = stats?.[dynamicKey];
        if (typeof dynamic === "number" && !Number.isNaN(dynamic)) {
            return { value: dynamic, estimate: true };
        }
        return { value: null, estimate: false };
    }

    // SLG figures. With unstacking turned off the Unstacking report prints no SLG lines, so
    // Dynamic Stats is the only source and its numbers are final rather than a preview:
    // they come back with estimate: false and fromDynamic: true.
    function resolveSLGStat(stats, officialKey, dynamicKey) {
        const r = resolveUnstackStat(stats, officialKey, dynamicKey);
        if (r.estimate && stats?.pairingUnstackEnabled === false) {
            return { value: r.value, estimate: false, fromDynamic: true };
        }
        return r;
    }

    // Pairing (regular) line count. Dynamic Stats reports it as "Pairing Lines",
    // Stats as "Total Awarded Schedules" — either one answers the question, so
    // prefer Dynamic and fall back to Stats. Returns null when neither has run.
    function resolveLineCount(stats) {
        const lines = stats?.pairingLines ?? stats?.totalAwardedSchedules;
        return (typeof lines === "number" && !Number.isNaN(lines)) ? lines : null;
    }

    // Unstacking limit for the report's bid month (holiday months allow more)
    function unstackLimitFor(isHoliday) {
        return isHoliday ? LOA.UNSTACKING_HOLIDAY : LOA.UNSTACKING_NORMAL;
    }

    // ORIGINAL SIMPLE REPORT TYPE VALUES
    const REPORT_TYPES = {
        RUN_DETAIL: 'run-detail',
        DYNAMIC_STATS: 'dynamic-stats',
        UNSTACKING: 'unstacking',
        UNKNOWN: 'unknown'
    };

    const PATTERNS = {
        //Report Headers
        RUN_DETAIL_w_NAME: /(Run Detail Report)\b.+?Name:?\s+(.+?)\s+Start/i,
        DYNAMIC_STATS_w_NAME: /(\s*Dynamic\s+Stats\s+Report).+Name:?\s+(.+)\b\s+Start/i,
        UNSTACKING_REPORT_w_NAME: /(Unstacking Report).+?Run:?\s+(.+?)\s+Unstacking/i,
        CATEGORY: /Category:\s+(\w\w\w-\w\w\w-\w\w)/i,
        PERIOD: /Period:\s*(.+?)\s*Category/i,

        //Stats
        AVG_LINE_VALUE: /Average\s+Line\s+Value\s+\(ALV\):\s+(\d{2,3}):([0-5]\d)/i,
        FOLLOWED_BY: /Followed\s?By[\s\S]{0,50}?Time\s*=\s*(\d{2}):(\d{2})/i,
        NORM_WINDOW_LOW: /\bNormalSkedCredit\b.+?Low = (\d{1,3}):(\d\d)/i,
        NORM_WINDOW_HIGH: /\bNormalSkedCredit\b.+?High = (\d{1,3}):(\d\d)/i,
        MAX_CREDITS_ALLOWED: /MaxCreditsHonoured\s+Max\s*=\s*(\d{1,4})/i, // stats
        MAX_CREDITS_HONORED: /Max-Credits Honored\/Allowed:?\s+(\d{1,4})\/\d{1,4}/i,
        MAX_CW_HIGH: /\bMaxSkedCredit\b.+?High = (\d{1,3}):(\d\d)/i,
        MAX_CW_LOW: /\bMaxSkedCredit\b.+?Low = (\d{1,3}):(\d\d)/i,
        MIN_CREDITS_ALLOWED: /MinCreditsHonoured\s+Max\s*=\s*(\d{1,4})/i, // stats
        MIN_CREDITS_HONORED: /Min-Credits Honored\/Allowed:?\s+(\d{1,4})\/\d{1,4}/i,
        MIN_CW_HIGH: /\bMinSkedCredit\b.+?High = (\d{1,3}):(\d\d)/i,
        MIN_CW_LOW: /\bMinSkedCredit\b.+?Low = (\d{1,3}):(\d\d)/i,
        MIN_CW_THRESH: /\bMinSkedCredit\b.+?Threshold = (\d{1,3}):(\d\d)/i,
        // The RLL employee table, captured between its two rules. Distinct from the
        // ReducedLowerLimitCredit window patterns below — this is who bid RLL, not the window.
        RLL_EMPLOYEE_BLOCK: /Reduced\s+Lower\s+Limit\s+Employees\b[\s\S]{0,80}?-{5,}([\s\S]*?)-{5,}/i,
        RLL_CW_LOW: /\bReducedLowerLimitCredit\b.+?Low = (\d{1,3}):(\d\d)/i,
        RLL_CW_THRESH: /\bReducedLowerLimitCredit\b.+?Threshold = (\d{1,3}):(\d\d)/i,
        BLOCKED_IOE: /Total Number of Blocked IOE Trips:?\s+(\d{1,})/i, // dynamic
        INELIGIBLE: /\s*Statistics.+Ineligible Bidders:\s*(\d{1,})/i,
        OPEN_TIME_CREDIT: /Eligible Bidders Excluding Shadows:.+?Open Time Credit:\s+(\d{1,5}):(\d{2})/i,
        OPEN_TIME_PERCENT: /Open\s+Time\s+Credit\s*%:\s*([0-9]+(?:\.[0-9]+)?)\s*%/i, // dynamic
        TOTAL_CREW: /\s*Statistics\s*Total Crew Members:?\s*(\d{1,})/i,
        // "Bidders with No Line:   3 (10001, 10002, 10003)" — the list is absent when the count is 0.
        NO_LINE_BIDDERS: /Bidders\s+with\s+No\s+Line:?\s*(\d+)(?:\s*\(([\d,\s]*)\))?/i, // stats or dynamic
        TOTAL_SCHEDULES: /Total\s+Schedules\s+Awarded:\s+(\d+)/i,
        PAIRING_LINES: /Pairing\s+Lines:\s+(\d+)/i,
        TRIP_CREDIT: /Eligible Bidders Excluding Shadows:.+?Trip Credit:\s+(\d{1,5}):(\d{2})/i,

        //Reserve
        // Coloring ON = two cols/band; 2nd col = actual; -? tolerates negative net. Bases print only
        // the bands they use (AFW and CVG have no AM), so a row is a date, any run of bands, TOTAL:.
        COLORING_GRID: /(\d{8})((?:\s+(?:AM|PM|RE|14LC)\s+-?\d+\s+-?\d+)+)\s+TOTAL:/ig,
        COLORING_BAND: /(AM|PM|RE|14LC)\s+(-?\d+)\s+(-?\d+)/ig,
        RESERVE_GRID: /\d{8}\s+RES\s+\d{1,4}\s+\d{1,4}\s+\d{1,3}\s+\d{1,3}\s+\d{1,2}\s+-?\d{1,3}/ig, // stats or dynamic
        MAX_14LC: /LongCall_14LC\s+MaxBidders\s*=\s*(\d{1,2})\s*Use\s*=\s*(\d)/i,
        MAX_14LC_DYNAMIC: /14LC\s+Reserve\s+Lines:\s+(\d+)/i, // Dynamic Stats reports lack the MaxBidders line; fall back to this
        TOTAL_RESERVES: /Total\s+Reserves:\s+(\d+)/i,
        TOTAL_RESERVE_DAYS: /(?:Total\s+)?Reserve\s+Days\s+On\s+Awarded:\s+(\d+)/i,
        RESERVE_LINES: /Reserve\s+Lines:\s+(\d+)/i,
        AM_COLOR: /ShortCall_AM\s+Use\s*=\s*(\d)/i,
        PM_COLOR: /ShortCall_PM\s+Use\s*=\s*(\d)/i,
        RE_COLOR: /ShortCall_RE\s+Use\s*=\s*(\d)/i,

        //Unstacking and SLG
        PRIORITY_STACK_DATE: /(?<!Secondary)Priority ?Stack ?Date ?[:=]\s+(\d{4}-?\d{2}-?\d{2})/i, // stats or dynamic	
		SECONDARY_PRIORITY_STACK_DATE: /SecondaryPriorityStackDate\s*=\s*(\d{8})/i,
		USE_PRIORITY_STACK_DATE: /UsePriorityStackDate\s*=\s*(\d)/i,
		USE_SECONDARY_PRIORITY_STACK_DATE: /UseSecondaryPriorityStackDate\s*=\s*(\d)/,
        SLG_ABOVE_TEN_PERCENT: /# SLG Above 10% Threshold:?\s+(\d{1,3})/i,
        SLG_LINES: /# Lines with SLG:?\s+(\d{1,3})/i,
        PAIRING_LINES_WITH_SLG: /(?<!% )Pairing Lines with SLG:?\s+(\d+)/i,
        PCT_PAIRING_LINES_WITH_SLG: /% Pairing Lines with SLG:?\s+([\d\.]{1,6})%/i,
        PCT_PAIRINGS_UNSTACKED: /(?:Total )?% Pairing Lines Unstacked:?\s+([\d\.]{1,6})%/i,
        // Official (contractual) numbers — Unstacking report only
        HIGHEST_PCT_PAIRINGS_UNSTACKED: /Highest\s+%\s+of\s+Pairing\s+Lines\s+Unstacked:?\s+(?:\(None\)|([\d\.]{1,6})\s*%)/i, // "(None)" means 0%
        HIGHEST_PCT_PAIRING_LINES_SLG: /Highest\s+%\s+of\s+Pairing\s+Lines\s+Assigned\s+SLG:?\s+(?:\(None\)|([\d\.]{1,6})\s*%)/i, // "(None)" means 0%
        PCT_RESERVE_LINES_UNSTACKED: /(?:Total )?% Reserve Lines Unstacked:?\s+([\d\.]{1,6})%/i,
        // Unstacking report: "[Reserve ]Unstacking was [NOT ]ENABLED for this run." — both lines always
        // print. The group always matches (NOT ENABLED | ENABLED) so View Text can mark it either way.
        PAIRING_UNSTACK_ENABLED: /(?<!Reserve\s)Unstacking\s+was\s+(NOT\s+ENABLED|ENABLED)\s+for\s+this\s+run/i,
        RESERVE_UNSTACK_ENABLED: /Reserve\s+Unstacking\s+was\s+(NOT\s+ENABLED|ENABLED)\s+for\s+this\s+run/i,
        FORCE_PSD: /SLGForcePriorityStackDate = (\d)/i,
        USE_UNSTACKING: /Unstacking.+?Use\s*=\s*(\d)/i,
        HHMM: /(\d{1,3}):([0-5]\d)/ // may not need  
    };
    const REPORT_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];


    // ---------------- Storage Logic ----------------
    let workingReport = null; // stored in memory only - vanishes with window close
    let currentKPI = null; // last KPI object we used
    let reserveGridFilters = { // UI filters for reserve grid
        onlyViolations: false
    };

    // Reserve grid celebration (every day's Diff at or above LOA.NET_TOLERANCE). Once
    // dismissed it stays gone for that load of that report — keyed on name + lastUpdated,
    // which only applyUpdate moves — so re-renders from the toggles don't replay it.
    let celebrationDismissedKey = null;
    let celebrationOutsideHandler = null; // document listener, swapped out on every render

    // Which column groups the reserve grid comparison shows. Hiding one drops its
    // header, its per-report sub-columns, and its cells, so the table narrows.
    // View-only state: it lives for the session and is never saved with a report.
    let compareGridColumns = {
        ot: true,
        coverage: true,
        diff: true
    };

// Reserve grid comparison mode: "net" (default) or "actual" (gross).
// Each seat category carries its own default in its KPI entry (defaultCompareMode); loading
// or showing a report applies that default, and the Compare Gross toggles override it for
// the current view without changing the saved default.
let reserveCompareMode = "net";

function defaultCompareModeFor(kpi) {
    return kpi?.defaultCompareMode === "actual" ? "actual" : "net";
}

// Reports currently shown in the compare modal, so its toggle can re-render.
let compareReports = null;

let activeKPICategory = null; // which category tab is active

    // Saved reports (and the Save button that wrote them) were removed in v5.2: each run is now
    // built only from its own download or the report on screen. The old store is deleted once,
    // so earlier saves can't seep into a new analysis and their space goes back to the site.
    try { localStorage.removeItem("NBAnalyzerReports"); } catch (e) { /* storage blocked */ }

    // Delegated clicks: KPI tabs, modal backdrops and close buttons, the compare view switch
    document.addEventListener("click", (e) => {
        const target = e.target;
        const { id, classList } = target;

        const kpiTab = target.closest?.(".kpi-tab-btn");
        if (kpiTab) {
            const cat = kpiTab.dataset.cat ?? null; // the draft tab carries no data-cat
            if (classList.contains("kpi-tab-close")) closeKPITab(cat);
            else if (kpiTab.classList.contains("kpi-tab-new")) openKPIDraft();
            else if (cat !== activeKPICategory) switchKPITab(cat);
            return;
        }

        if (classList.contains("ra-backdrop")) {
            const modal = target.querySelector(".ra-modal, .ra-compare-modal");
            if (modal && modal.contains(target)) return;
            closeAllModals();
            return;
        }

        if (id === "ra-compare-close" ||
            id === "ra-modal-validate-close" ||
            id === "ra-changelog-close") {
            closeAllModals();
            return;
        }

        const viewBtn = target.closest?.(".ra-compare-view-btn");
        if (viewBtn) {
            setCompareView(viewBtn.dataset.view);
            return;
        }

    });

    // ---------------- Compare (run list) ----------------
    // One window, two views: Analysis (summary + reserve grid) and Inputs (scheduler options).
    // Opened by the run list's Compare with downloaded runs.
    const COMPARE_MAX = REPORT_LABELS.length; // 10
    let compareView = "analysis"; // "analysis" | "inputs"

    function openCompare(reports, view) {
        compareReports = reports;
        inputCompareDiffsOnly = true;
        renderCompareSummary(reports);
        renderCompareGrid(reports);
        renderInputCompare(reports);
        const title = raCompareBackdrop.querySelector(".ra-compare-title");
        if (title) title.textContent = `Report Comparison — ${reports.length} runs`;
        setCompareView(view || "analysis");
        closeAllModals();
        raCompareBackdrop.classList.add("visible");

        // The reserve grid's dates and Required come from the first report's category
        const cats = [...new Set(reports.map(r => r.category).filter(Boolean))];
        if (cats.length > 1) {
            showToast(`These runs are from different categories (${cats.join(", ")}).\nThe reserve grid uses ${reports[0].category || cats[0]}'s KPIs.`, "info");
        }
    }

    function setCompareView(view) {
        compareView = view === "inputs" ? "inputs" : "analysis";
        const analysis = document.getElementById("ra-compare-analysis");
        const inputs = document.getElementById("ra-compare-inputs");
        if (analysis) analysis.style.display = compareView === "analysis" ? "" : "none";
        if (inputs) inputs.style.display = compareView === "inputs" ? "" : "none";
        raCompareBackdrop.querySelectorAll(".ra-compare-view-btn").forEach(b => {
            const on = b.dataset.view === compareView;
            b.classList.toggle("on", on);
            b.setAttribute("aria-pressed", on ? "true" : "false");
        });
    }

    ///////////// Top Half of compare modal

    function renderCompareSummary(reports) {
        const container = document.getElementById("ra-compare-summary");
        if (!container) return;

        // Build header row
        let html = `
    <table class="ra-compare-summary-table">
      <thead>
        <tr>
          <th>Label</th>
          <th>Report</th>
          <th>ALV</th>
          <th>OT%</th>
          <th>Pairing Lines</th>
          <th>RLL</th>
          <th>Max CW</th>
          <th>Min CW</th>
          <th>Pairing Unstack %</th>
          <th>Reserve Unstack %</th>
          <th>SLG Lines</th>
        </tr>
      </thead>
      <tbody>
  `;

        reports.forEach((rep, idx) => {
            const label = REPORT_LABELS[idx] || "?";
            const s = rep.stats || {};
            // Fallbacks name the report a value comes from, when the run's download lacks it
            const saveStats = "No Stats";
            const saveDynamic = "No Dynamic";
            const saveUnstack = "No Unstacking";

            // Convert ALV to HH:MM
            const alv = typeof s.alv === "number" ?
                minutesToHHMM(s.alv) :
                saveStats;

            const ot = (s.openTimePercent != null) ?
                `${s.openTimePercent}%` :
                saveStats;

            // Pairing lines come from either report, so only prompt when neither has run
            const sched = resolveLineCount(s) ?? "No Stats or Dynamic";

            // RLL is Stats-only; 0 is a real answer here, so ?? (not ||) does the work
            const rll = s.rllLines ?? saveStats;

            const maxHon = s.maxCredits?.honored ?? saveDynamic;
            const minHon = s.minCredits?.honored ?? saveDynamic;

            const unstackStat = resolveUnstackStat(s, "highestPairingsUnstackedPercent", "pairingsUnstackedPercent");
            const unstack = s.pairingUnstackEnabled === false ? "OFF" :
                unstackStat.value != null ?
                `${unstackStat.value.toFixed(2)}${unstackStat.estimate ? "*" : ""}` :
                saveUnstack;

            // Reserve lines have one figure, written by whichever of Dynamic Stats or
            // Unstacking ran last — there is no separate official/estimate pair for it.
            const resUnstack = s.reserveUnstackEnabled === false ? "OFF" :
                typeof s.reserveLinesUnstackedPercent === "number" ?
                s.reserveLinesUnstackedPercent.toFixed(2) :
                saveDynamic;

            // Unstacking off prints no SLG lines; Dynamic's count is then the figure
            const slg = s.slgLines ??
                (s.pairingUnstackEnabled === false && typeof s.pairingLinesWithSLG === "number" ? s.pairingLinesWithSLG : null) ??
                saveUnstack;

            html += `
      <tr>
        <td>${label}</td>
        <td>${rep.name}</td>
        <td>${alv}</td>
        <td>${ot}</td>
        <td>${sched}</td>
        <td>${rll}</td>
        <td>${maxHon}</td>
        <td>${minHon}</td>
        <td>${unstack}</td>
        <td>${resUnstack}</td>
        <td>${slg}</td>
      </tr>
    `;
        });

        html += `</tbody></table>`;

        const anyEstimate = reports.some(rep => rep.stats?.pairingUnstackEnabled !== false &&
            resolveUnstackStat(rep.stats, "highestPairingsUnstackedPercent", "pairingsUnstackedPercent").estimate);
        if (anyEstimate) {
            html += `<div class="ra-compare-note">* Dynamic Stats estimate — load the Unstacking report for the official number.</div>`;
        }

        container.innerHTML = html;
    }


    //////////// Bottom half
    function renderCompareGrid(reports) {
        compareReports = reports; // keep ref so the gross/net toggle can re-render
        const container = document.getElementById("ra-compare-grid");
        const kpi = loadKPI(reports[0]?.category) || {};
        const kpiGrid = kpi.grid || {};

        // Master date list from KPI (best source)
        const dates = Object.keys(kpiGrid).sort();
        
		const lineCount = resolveLineCount(reports[0]?.stats);
        const maxStack = computeMaxStack(lineCount, reports[0]?.stats?.openTimePercent);

        // Header for the coverage group, which tracks the Compare Gross toggle
        const coverageLabel = reserveCompareMode === "actual" ? "GROSS" : "NET";

        // Column groups in display order, minus any the user has hidden
        const groupLabels = { ot: "OT", coverage: coverageLabel, diff: "DIFF" };
        const visibleGroups = ["ot", "coverage", "diff"].filter(k => compareGridColumns[k]);

        // Running Σ of each report's DIFF column, shown in its sub-header
        const diffTotals = reports.map(() => ({ sum: 0, hasValue: false }));
            
        const rows = dates.map(date => {
            const required = kpiGrid[date]?.total ?? "—";

            const isWeekendDay = isWeekend(date);

            const weekendClass = isWeekendDay ? "weekend" : "";

            // Build columns. The coverage group follows the Compare Gross toggle:
            // gross (actual) coverage when on, net when off — so it always shows the
            // raw numbers the DIFF column is computed from.
            const otCells = [];
            const coverageCells = [];
            const diffCells = [];

            reports.forEach((r, idx) => {
                const day = r.stats.reserveGrid?.[date] || {};
                const actual = day.actualCoverage ?? null;
                const net = day.netCoverage ?? null;
                const openTrips = day.openTrips ?? null;

const compareBase =
    reserveCompareMode === "actual"
        ? actual
        : net;

let diff = null;
if (compareBase != null && required != null && required !== "—") {
    diff = compareBase - required;
    diffTotals[idx].sum += diff;
    diffTotals[idx].hasValue = true;
}


                const otClass = (openTrips != null && maxStack != null && openTrips > maxStack) ?
                    "stack-red" :
                    "";

                const diffClass =
                    diff == null ? "" :
                    diff >= 0 ? "diff-green" :
                    diff < LOA.NET_TOLERANCE ? "diff-red" :
                    "diff-neutral";

                otCells.push(`<td class="${otClass}">${openTrips ?? "—"}</td>`);
                coverageCells.push(`<td>${compareBase ?? "—"}</td>`);
                diffCells.push(`<td class="${diffClass}">${diff ?? "—"}</td>`);
            });

            const cellsByGroup = { ot: otCells, coverage: coverageCells, diff: diffCells };

            return `
      <tr class="${weekendClass}">
        <td>${date}</td>
        <td>${required}</td>
        ${visibleGroups.map(k => cellsByGroup[k].join("")).join("")}
      </tr>
    `;
        }).join("");

const subCols = reports.map(() => `<col style="width:34px">`).join("");
// Per-report sub-headers; the DIFF group also carries that report's Σ
const subHeaderCols = (group) => reports.map((_, i) => {
    const total = diffTotals[i];
    const sum = (group === "diff" && total.hasValue) ?
        `<span class="ra-col-sum ${total.sum >= 0 ? "diff-green" : "diff-red"}">Σ ${total.sum}</span>` :
        "";
    return `<th class="sub-col">${REPORT_LABELS[i]}${sum}</th>`;
}).join("");
container.innerHTML = `
  <div class="ra-section-header">
    Reserve Grid Comparison
    <label class="switch">
      <input type="checkbox" id="ra-compare-gross-toggle" ${reserveCompareMode === "actual" ? "checked" : ""}>
      <span class="slider"></span>
      <span class="switch-label">Compare Gross</span>
    </label>

    <span class="ra-col-toggles">
      <span class="ra-col-toggles-label">Columns</span>
      ${["ot", "coverage", "diff"].map(k => `
        <button type="button"
          class="ra-col-toggle ${compareGridColumns[k] ? "on" : ""}"
          data-col="${k}"
          aria-pressed="${compareGridColumns[k] ? "true" : "false"}"
          title="Show or hide the ${groupLabels[k]} columns">${groupLabels[k]}</button>
      `).join("")}
    </span>
  </div>

  ${visibleGroups.length ? `
  <table class="ra-compare-grid-table">
    <colgroup>
      <col style="width:88px">
      <col style="width:40px">
      ${visibleGroups.map(() => subCols).join("")}
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2">Date</th>
        <th rowspan="2">Req</th>

        ${visibleGroups.map(k => `<th class="group-head" colspan="${reports.length}">${groupLabels[k]}</th>`).join("")}
      </tr>

      <tr>
        ${visibleGroups.map(subHeaderCols).join("")}
      </tr>
    </thead>

    <tbody>${rows}</tbody>
  </table>
  ` : `<div class="ra-compare-empty">All columns hidden — use the Columns buttons above to bring back OT, ${coverageLabel}, or DIFF.</div>`}
`;

    const grossToggle = document.getElementById("ra-compare-gross-toggle");
    if (grossToggle) {
        grossToggle.onchange = (e) => {
            reserveCompareMode = e.target.checked ? "actual" : "net";
            renderCompareGrid(compareReports);
        };
    }

    container.querySelectorAll(".ra-col-toggle").forEach(btn => {
        btn.onclick = () => {
            const col = btn.dataset.col;
            compareGridColumns[col] = !compareGridColumns[col];
            renderCompareGrid(compareReports);
        };
    });

    }

    // **************** INPUT (OPTIONS) COMPARE MODAL **************

    // The Inputs view of the comparison window: every report that carries a Stats Options
    // section, side by side. A row whose values disagree gets the diff tint.
    let inputCompareReports = null; // shown in the Inputs view, so its toggle can re-render
    let inputCompareDiffsOnly = true; // default: show only fields that differ

    const hasInputs = (r) => !!r?.inputs?.scalars?.length;

    // Union several per-day grids by date into ordered [{ date, values: [...] }] using `field`.
    function unionInputGrids(grids, field) {
        const maps = grids.map(g => new Map((g || []).map(r => [r.date, r[field]])));
        const dates = Array.from(new Set(maps.flatMap(m => [...m.keys()]))).sort();
        return dates.map(date => ({
            date,
            values: maps.map(m => m.has(date) ? m.get(date) : "—"),
        }));
    }

    // Build the ordered diff rows for several reports' inputs. A row differs when any two
    // reports disagree.
    function buildInputDiff(reports) {
        const ins = reports.map(r => r.inputs || {});
        const rows = [];
        const row = (section, label, values, extra) => {
            const differs = new Set(values.map(String)).size > 1;
            rows.push({ section, label, values, differs, ...extra });
        };

        // Scalars — union of keys, in first-seen order across the reports.
        const maps = ins.map(i => new Map((i.scalars || []).map(s => [s.key, s.value])));
        const keys = [];
        const seen = new Set();
        for (const i of ins) for (const s of (i.scalars || [])) {
            if (!seen.has(s.key)) { seen.add(s.key); keys.push(s.key); }
        }
        for (const k of keys) {
            row("Scheduler Options", k, maps.map(m => m.has(k) ? m.get(k) : "—"));
        }

        // Unstacking Max per day
        for (const g of unionInputGrids(ins.map(i => i.unstackGrid), "max")) {
            const date = formatDate(g.date);
            row("Unstacking — Max / Day", date, g.values, { weekend: isWeekend(date) });
        }

        // ReserveStackHeight Min coverage per day
        for (const g of unionInputGrids(ins.map(i => i.rshGrid), "min")) {
            const date = formatDate(g.date);
            row("Reserve — Min Coverage / Day", date, g.values, { weekend: isWeekend(date) });
        }

        return rows;
    }

    function renderInputCompare(reports) {
        inputCompareReports = reports;
        const container = document.getElementById("ra-compare-inputs");
        if (!container) return;

        // Letters stay those of the whole comparison, so B is the same run in both views
        const cols = reports.map((r, i) => ({ r, label: REPORT_LABELS[i] || "?" })).filter(c => hasInputs(c.r));
        const left = reports.filter(r => !hasInputs(r));
        const leftNote = left.length
            ? `<div class="ra-compare-note">No scheduler options for ${left.map(r => r.name).join(", ")} — only the Stats report has them; ↻ downloads the run again.</div>`
            : "";

        if (cols.length < 2) {
            container.innerHTML = `<div class="ra-section-header">Input Compare</div>
  <div class="ra-ic-empty">Input compare needs at least two runs with a Stats report.</div>${leftNote}`;
            return;
        }

        const allRows = buildInputDiff(cols.map(c => c.r));
        const diffCount = allRows.filter(r => r.differs).length;
        const visibleRows = inputCompareDiffsOnly ? allRows.filter(r => r.differs) : allRows;
        const span = cols.length + 1;

        // Group visible rows by section, emitting a sub-header when the section changes.
        let bodyHtml = "";
        let lastSection = null;
        for (const r of visibleRows) {
            if (r.section !== lastSection) {
                bodyHtml += `<tr class="ra-ic-section"><td colspan="${span}">${r.section}</td></tr>`;
                lastSection = r.section;
            }
            const rowClass = [r.differs ? "ra-ic-diff" : "", r.weekend ? "weekend" : ""]
                .filter(Boolean).join(" ");
            bodyHtml += `
      <tr class="${rowClass}">
        <td class="ra-ic-field">${r.label}</td>
        ${r.values.map(v => `<td>${v}</td>`).join("")}
      </tr>`;
        }

        if (!visibleRows.length) {
            bodyHtml = `<tr><td colspan="${span}" class="ra-ic-empty">${
                inputCompareDiffsOnly ? "No input differences between these runs." : "No inputs found."
            }</td></tr>`;
        }

        container.innerHTML = `
  <div class="ra-section-header">
    ${diffCount} field${diffCount === 1 ? "" : "s"} differ
    <label class="switch">
      <input type="checkbox" id="ra-ic-diffs-toggle" ${inputCompareDiffsOnly ? "checked" : ""}>
      <span class="slider"></span>
      <span class="switch-label">Only differences</span>
    </label>
  </div>
  ${leftNote}

  <div class="ra-ic-scroll">
  <table class="ra-ic-table">
    <thead>
      <tr>
        <th>Field</th>
        ${cols.map(c => `<th class="ra-ic-run" title="${c.r.name}">${c.label}<span class="ra-ic-name">${c.r.name}</span></th>`).join("")}
      </tr>
    </thead>
    <tbody>${bodyHtml}</tbody>
  </table>
  </div>
`;

        const toggle = document.getElementById("ra-ic-diffs-toggle");
        if (toggle) {
            toggle.onchange = (e) => {
                inputCompareDiffsOnly = e.target.checked;
                renderInputCompare(inputCompareReports);
            };
        }
    }

    // **************** VALIDATE MODAL **************

    function renderValidationModal(results, reportName) {
        const container = document.getElementById("ra-validation-content");
        const header = raValidateBackdrop.querySelector(".ra-modal-title");

        header.textContent = `Validation — ${reportName}`;

        container.innerHTML = results.map(r => `
    <div class="ra-validation-row">
      <div class="ra-validation-indicator ${r.status}"></div>
      <div class="ra-validation-label">${r.label}</div>
      <div class="ra-validation-output">${r.message}</div>
    </div>
  `).join("");
    }


    const KPI_KEY = "NBAnalyzerKPI"; // KPI OBJECT STORAGE — keyed by category

    function loadAllKPIs() {
        const raw = localStorage.getItem(KPI_KEY);
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            // Migrate: old flat format had alvTarget at the top level
            if (parsed && parsed.alvTarget !== undefined) return {};
            return parsed || {};
        } catch { return {}; }
    }

    function loadKPI(category) {
        if (!category) return null;
        return loadAllKPIs()[category] || null;
    }

    function saveKPI(category, obj) {
        if (!category) return;
        const all = loadAllKPIs();
        all[category] = obj;
        localStorage.setItem(KPI_KEY, JSON.stringify(all));
        updateStorageSize();
    }

    function clearKPI(category) {
        if (!category) return;
        const all = loadAllKPIs();
        delete all[category];
        localStorage.setItem(KPI_KEY, JSON.stringify(all));
        updateStorageSize();
    }

    // ---------------- Storage Size ----------------
    // Shown as the Cache button at the far right of the top bar. localStorage stores strings, and browsers cap it at roughly
    // 5 million characters per site (Chrome and Firefox both), shared with NavBlue's own page —
    // so characters are counted, and shown as KB since this data is plain ASCII JSON.
    const STORAGE_BUDGET_CHARS = 5 * 1024 * 1024;

    function storedChars(key) {
        const v = localStorage.getItem(key);
        return v == null ? 0 : key.length + v.length;
    }

    function formatStorageSize(chars) {
        if (chars < 1024) return `${chars} B`;
        if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(chars < 10 * 1024 ? 1 : 0)} KB`;
        return `${(chars / (1024 * 1024)).toFixed(2)} MB`;
    }

    function updateStorageSize() {
        const el = document.getElementById("storage-size");
        if (!el) return; // top bar not built yet
        const kpis = storedChars(KPI_KEY);
        const pulls = storedChars(PULLS_KEY);
        let site = 0;
        for (let i = 0; i < localStorage.length; i++) site += storedChars(localStorage.key(i));
        const pct = (site / STORAGE_BUDGET_CHARS) * 100;

        el.textContent = `Cache: ${formatStorageSize(kpis + pulls)}`;
        el.title = `KPIs: ${formatStorageSize(kpis)}\n`
            + `Downloaded runs: ${formatStorageSize(pulls)}\n`
            + `Whole site (incl. NavBlue): ${formatStorageSize(site)} of ~5 MB (${pct.toFixed(1)}%)`;
        // Warn before the browser starts refusing saves
        el.style.color = pct >= 90 ? "#f87171" : pct >= 75 ? "#eab308" : "";
    }

    // ----------------  Helpers ----------------
    const scrapeNum = (n) =>
        n == null ? 0 : Number(String(n).replace(/[^0-9.-]/g, "")) || 0;

    const toMinutes = (hhmm) => {
        if (!hhmm || typeof hhmm !== "string") return 0;
        const [h, m] = hhmm.split(":").map(Number);
        return (h || 0) * 60 + (m || 0);
    };

    function minutesToHHMM(mins) {
        if (mins == null || isNaN(mins)) return "—";
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${h}:${String(m).padStart(2, "0")}`;
    }

    function getReportText() {
        const el = document.querySelector('#report_text p');
        if (!el) {
            console.warn("No #report_text element or <p> inside said element.");
            return "";
        }

        // innerText gives correct newline behavior; flattened exactly like a run list download
        return flattenReportText(el.innerText);
    }

    // The IOE Pairings report is a separate CLASS report run onto the same page. It opens with
    //   IOE Pairings   Period: Nov_2026   Category: MSP-737-CA
    // which is how we know that report — and not a Stats/Dynamic/Unstacking run — is on screen,
    // and which category's Total Trips to check.
    //
    // The header's lines are split by <br>, which textContent drops ("IOE PairingsPeriod:
    // Dec_2026Category: MSP-737-CAC0001 …"), so the separators are \s* and the period is lazy.
    // innerText keeps the breaks, so it is what the category is read from; textContent only
    // finds the element (innerText on every element would force a layout each time).
    const IOE_PAIRINGS_FIND = /IOE\s*Pairings\s*Period:/i;
    // The category stops at whitespace or the "Employee" heading that follows it.
    const IOE_PAIRINGS_HEADER = /IOE\s*Pairings\s*Period:\s*(\S+?)\s*Category:\s*([A-Z0-9][A-Z0-9-]*?)(?=\s|Employee|$)/i;

    // The page also carries the report's raw text, newlines intact, in the hidden Save field:
    // <input id="report_hidden_nws" value="<Call>…<ReportText><![CDATA[IOE Pairings …]]></ReportText>…">
    function rawReportText() {
        const v = document.getElementById("report_hidden_nws")?.value || "";
        const m = /<ReportText>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/ReportText>/.exec(v);
        return m ? m[1] : null;
    }

    function pairingsReportInfo() {
        const raw = rawReportText();
        if (raw != null) {
            const m = IOE_PAIRINGS_HEADER.exec(raw);
            if (m) return { period: m[1], category: m[2].toUpperCase(), raw };
        }
        // The innermost element holding the header (an outer one also holds the pairings)
        let best = null;
        for (const el of document.body ? document.body.querySelectorAll("*") : []) {
            if (el.closest("#ra-drawer, #ra-panel, .ra-backdrop, script, style")) continue;
            const t = el.textContent || "";
            if (best && t.length >= best.textContent.length) continue;
            if (IOE_PAIRINGS_FIND.test(t)) best = el;
        }
        if (best) {
            const text = typeof best.innerText === "string" && best.innerText ? best.innerText : best.textContent;
            const m = IOE_PAIRINGS_HEADER.exec(text);
            return { period: m ? m[1] : null, category: m ? m[2].toUpperCase() : null, raw: text };
        }
        return null;
    }

    // The list itself: one trip per line, between the column headings and the end line.
    //   Employee      Pairing Number     Start Date
    //   ------------------------------------------
    //   10001            M0101           2026-11-05
    //   1002             M0102           2026-11-13
    //   ------------------------------------------
    //   End of IOE Pairing List
    // The same employee and pairing can appear on several dates; each line is its own trip.
    // The row pattern doesn't lean on newlines, so a flattened or <br>-glued text counts the same.
    const IOE_LIST_SECTION = /Start\s*Date([\s\S]*?)End\s+of\s+IOE\s+Pairing\s+List/i;
    const IOE_LIST_ROW = /(\d{2,8})\s+([A-Z0-9]{2,10})\s+(\d{4}-\d{2}-\d{2})/g;

    function countIOETrips(text) {
        const section = IOE_LIST_SECTION.exec(text || "");
        if (!section) return null; // not the whole report
        const employees = new Set();
        let trips = 0;
        for (const m of section[1].matchAll(IOE_LIST_ROW)) {
            trips++;
            employees.add(m[1]);
        }
        return { trips, employees: employees.size };
    }

    function formatDate(yyyymmdd) {
        return yyyymmdd.slice(0, 4) + "-" + yyyymmdd.slice(4, 6) + "-" + yyyymmdd.slice(6, 8);
    }

function isHolidayPeriod(period) {
    if (!period) return null; // unknown
    const lower = period.toLowerCase();
    return Object.values(LOA.HOLIDAY_MONTHS).some(m => lower.startsWith(m));
}

function isWeekend(isoDate) {
  // isoDate: "YYYY-MM-DD"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate));
  if (!m) return false;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  // Use UTC so local timezone can't shift the day
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0=Sun ... 6=Sat
  return dow === 0 || dow === 6;
}

    // Extract data from each row of the reserve grid
    function parseReserveRow(row) {
        const parts = row.trim().split(/\s+/);

        const dateStr = parts[0]; // "20251201"
        const minSetting = parts[2];
        const maxSetting = parts[3];
        const actualCoverage = Number(parts[4]); //same as total
        const totalCoverage = Number(parts[5]);
        const openTrips = Number(parts[6]);
        const netCoverage = Number(parts[7]);

        return {
            date: formatDate(dateStr),
            minCoverage: Number(minSetting), // the Min column: reserves requested for the day
            actualCoverage,
            openTrips,
            netCoverage
        };
    }

    // Reserve Coloring Data
    function parseDynamicStatsColoring(txt, partial) {
        const matches = txt.matchAll(PATTERNS.COLORING_GRID);
        for (const m of matches) {
            const rawDate = m[1];
            const date = formatDate(rawDate);

            // A band the report didn't print stays absent — not reported, which is not the same as 0
            const colors = {};
            for (const b of m[2].matchAll(PATTERNS.COLORING_BAND)) {
                colors[b[1].toUpperCase() === "14LC" ? "LC" : b[1].toUpperCase()] = Number(b[3]);
            }

            // ensure date entry exists
            if (!partial.stats.reserveGrid[date]) {
                partial.stats.reserveGrid[date] = {};
            }

            // ensure colors sub-object exists
            if (!partial.stats.reserveGrid[date].colors) {
                partial.stats.reserveGrid[date].colors = {};
            }

            // assign actuals only
            Object.assign(partial.stats.reserveGrid[date].colors, colors);
        }
    }

    // KPI Parsing
function parseKPIGrid(text) {
  const lines = text.trim().split(/\n+/).filter(Boolean);

  const out = {
    grid: {},
    errors: [],
    meta: {
      bidMonth: null,
      bidYear: null,
      expectedDays: null,
      monthCounts: {},   // { "1": 2, "2": 28, "3": 1 }
      datesSeen: new Set(),
    }
  };

  const is31DayBidMonth = (m) => [5, 7, 8, 10, 12].includes(m); // May, Jul, Aug, Oct, Dec
  const expectedDaysForBidMonth = (m) => {
    if (m === 2) return 30;              // February bid period special rule
    return is31DayBidMonth(m) ? 31 : 30; // your bid-period rule
  };

  // Only allow MM/DD/YYYY or MM-DD-YYYY (NOT 2-digit year)
  const dateRe = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/;

  // First pass: parse rows + collect month frequency
  const parsedRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const parts = line.split(/\s+/);

    if (parts.length < 6) {
      out.errors.push(`Line ${i + 1}: Not enough columns (need: date AM PM RE LC TOTAL) → "${line}"`);
      continue;
    }

    const [dateRaw, lc, am, pm, re, total] = parts;

    const m = dateRaw.match(dateRe);
    if (!m) {
      out.errors.push(`Line ${i + 1}: Date must be MM/DD/YYYY or MM-DD-YYYY (4-digit year). Got "${dateRaw}".`);
      continue;
    }

    const mm = Number(m[1]);
    const dd = Number(m[2]);
    const yyyy = Number(m[3]);

    if (!(mm >= 1 && mm <= 12)) {
      out.errors.push(`Line ${i + 1}: Invalid month "${m[1]}" in "${dateRaw}".`);
      continue;
    }
    if (!(dd >= 1 && dd <= 31)) {
      out.errors.push(`Line ${i + 1}: Invalid day "${m[2]}" in "${dateRaw}".`);
      continue;
    }

    const nums = [am, pm, re, lc, total].map(v => Number(String(v).replace(/[^0-9.-]/g, "")));
    if (nums.some(n => Number.isNaN(n))) {
      out.errors.push(`Line ${i + 1}: Non-numeric AM/PM/RE/LC/TOTAL → "${line}"`);
      continue;
    }

    out.meta.monthCounts[mm] = (out.meta.monthCounts[mm] || 0) + 1;

    parsedRows.push({
      lineNo: i + 1,
      dateRaw,
      mm, dd, yyyy,
      AM: nums[0],
      PM: nums[1],
      RE: nums[2],
      LC: nums[3],
      total: nums[4]
    });
  }

  if (!parsedRows.length) return out;

  // Determine bidMonth as the most common month in the data
  let bidMonth = null;
  let bidCount = -1;
  for (const [mStr, cnt] of Object.entries(out.meta.monthCounts)) {
    const mNum = Number(mStr);
    if (cnt > bidCount) {
      bidCount = cnt;
      bidMonth = mNum;
    }
  }

  // Determine bidYear as the most common year within the bidMonth
  const yearCounts = {};
  for (const r of parsedRows) {
    if (r.mm !== bidMonth) continue;
    yearCounts[r.yyyy] = (yearCounts[r.yyyy] || 0) + 1;
  }
  let bidYear = null;
  let yCount = -1;
  for (const [yStr, cnt] of Object.entries(yearCounts)) {
    const yNum = Number(yStr);
    if (cnt > yCount) {
      yCount = cnt;
      bidYear = yNum;
    }
  }

  out.meta.bidMonth = bidMonth;
  out.meta.bidYear = bidYear;
  out.meta.expectedDays = expectedDaysForBidMonth(bidMonth);

  // Helpers for ISO normalization
  const isoOf = (yyyy, mm, dd) =>
    `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;

  const jan31ISO = isoOf(bidYear, 1, 31);
  const mar01ISO = isoOf(bidYear, 3, 1);

  // Second pass: validate + build grid
  for (const r of parsedRows) {
    const iso = isoOf(r.yyyy, r.mm, r.dd);

    if (out.meta.datesSeen.has(iso)) {
      out.errors.push(`Line ${r.lineNo}: Duplicate date "${r.dateRaw}" (${iso}).`);
      continue;
    }
    out.meta.datesSeen.add(iso);

    // Keep bidYear consistent for the main month
    if (r.mm === bidMonth && r.yyyy !== bidYear) {
      out.errors.push(
        `Line ${r.lineNo}: Mixed year for bid month. Bid month inferred as ${bidMonth}/${bidYear}, but got ${r.mm}/${r.yyyy}.`
      );
      continue;
    }

    if (bidMonth !== 2) {
      // Non-Feb: must be entirely within the bid month/year
      if (r.mm !== bidMonth || r.yyyy !== bidYear) {
        out.errors.push(
          `Line ${r.lineNo}: Dates must all be in the bid month ${bidMonth}/${bidYear}. Got "${r.dateRaw}".`
        );
        continue;
      }
    } else {
      // Feb special: allow ONLY Jan/Feb/Mar of bidYear
      if (![1, 2, 3].includes(r.mm) || r.yyyy !== bidYear) {
        out.errors.push(
          `Line ${r.lineNo}: Feb bid period allows only Jan/Feb/Mar of ${bidYear}. Got "${r.dateRaw}".`
        );
        continue;
      }
    }

    out.grid[iso] = { AM: r.AM, PM: r.PM, RE: r.RE, LC: r.LC, total: r.total };
  }

  // Final validation: day count
  const uniqueCount = Object.keys(out.grid).length;
  const expected = out.meta.expectedDays;

  if (uniqueCount !== expected) {
    out.errors.push(
      `KPI grid day count mismatch: expected ${expected} days for bid month ${bidMonth}/${bidYear}, got ${uniqueCount}.`
    );
  }

  // Final validation: Feb must include Jan 31 and Mar 1 (to make it a 30-day period)
  if (bidMonth === 2) {
    const hasJan31 = Object.prototype.hasOwnProperty.call(out.grid, jan31ISO);
    const hasMar01 = Object.prototype.hasOwnProperty.call(out.grid, mar01ISO);

    if (!hasJan31 || !hasMar01) {
      out.errors.push(
        `Feb bid period must include ${jan31ISO} (Jan 31) and ${mar01ISO} (Mar 1). Missing: ` +
        `${!hasJan31 ? jan31ISO : ""}${(!hasJan31 && !hasMar01) ? ", " : ""}${!hasMar01 ? mar01ISO : ""}`
      );
    }
  }

  return out;
}


    function parseKPIALV(value) {
        if (!value) return null;

        // must be exactly HHH:MM where MM is 00–59
        const match = /^(\d{1,3}):([0-5]\d)$/.test(value);
        if (!match) return null;

        const [h, m] = value.split(":").map(Number);
        return h * 60 + m;
    }

    // ALV tolerance: ±60 min normally, ±120 min for small positions
    // (75 or fewer regular lines).
    function alvToleranceFor(stats) {
        const lines = resolveLineCount(stats);
        return (lines != null && lines <= LOA.SMALL_POSITION_LINES)
            ? LOA.ALV_TOLERANCE_SMALL_MINUTES
            : LOA.ALV_TOLERANCE_MINUTES;
    }

    function evaluateALV(report, KPI) {
        const reportALV = report?.stats?.alv ?? null;
        const kpiALV = KPI?.alvTarget ?? null;

        if (reportALV == null || kpiALV == null) {
            return {
                status: "default",
                message: "Missing ALV data."
            };
        }

        const diff = reportALV - kpiALV;
        const ok = Math.abs(diff) <= alvToleranceFor(report?.stats);

        if (ok) {
            return {
                status: "green",
                message: `(${diff} mins)`
            };
        }

        return {
            status: "red",
            message: `(${diff} mins)`
        };
    }

    function evaluateOpenTime(report) {
        const ot = report?.stats?.openTimePercent;

        // No data?
        if (ot == null) {
            return {
                status: "default",
                message: "Run Stats or Dynamic Stats"
            };
        }

        if (ot <= LOA.OPEN_TIME_LIMIT) {
            return {
                status: "green",
                message: `Open Time (${ot}%) is within allowed limit (≤ ${LOA.OPEN_TIME_LIMIT}%).`
            };
        }

        return {
            status: "red",
            message: `Open Time (${ot}%) exceeds allowed limit of ${LOA.OPEN_TIME_LIMIT}%.`
        };
    }
    // ---------------- Default Report Object ----------------
    function defaultReport(name) {
        return {
            name,
            category: null,
            lastUpdated: Date.now(),
            type: null,
            period: null,
            stats: {
                totalCrew: null,
                ineligibleBidders: null,
                eligibleBidders: null,
                totalReserves: null,
                totalReserveDays: null,
                totalAwardedSchedules: null,
                pairingLines: null,
                rllLines: null,
                noLineBidders: null,
                noLineEmployees: null,
                alv: null,
                tripCredit: null,
                openTimeCredit: null,
                openTimePercent: null,
                minCredits: {
                    allowed: null,
                    honored: null
                },
                maxCredits: {
                    allowed: null,
                    honored: null
                },
                followedBy: null,
                blockedIOETrips: null,
                pairingsUnstackedPercent: null,
                reserveLinesUnstackedPercent: null,
                slgAboveTenPercent: null,
                slgLines: null,
                pairingLinesWithSLG: null,
                pairingLinesWithSLGPercent: null,
                highestPairingsUnstackedPercent: null, // official — Unstacking report
                highestPairingLinesSLGPercent: null, // official — Unstacking report
                pairingUnstackEnabled: null, // Unstacking report: false = "Unstacking was NOT ENABLED"
                reserveUnstackEnabled: null, // Unstacking report: false = "Reserve Unstacking was NOT ENABLED"
                max14LC: null,
                priorityStackDate: null,
                usePriorityStackDate: null,
				useSecondaryPriorityStackDate: null,
				secondaryPriorityStackDate: null,
                forcePsdSlg: null,
                useUnstacking: null,
                windows: {
                    normal: {
                        low: null,
                        high: null,
                    },
                    min: {
                        low: null,
                        high: null,
                        threshold: null,
                    },
                    max: {
                        low: null,
                        high: null,
                    },
                },
                amColor: null,
                pmColor: null,
                reColor: null,
                lcColor: null,
                reserveGrid: {}
            },
        };
    }
    
    function normalizeReport(report) {
	  if (!report || !report.name) return report;
	  const base = defaultReport(report.name);
	  
		  return {
		...base,
		...report,
		stats: {
		  ...base.stats,
		  ...report.stats,
	
		  minCredits: {
			...base.stats.minCredits,
			...report.stats?.minCredits
		  },
	
		  maxCredits: {
			...base.stats.maxCredits,
			...report.stats?.maxCredits
		  },
	
		  windows: {
			...base.stats.windows,
			...report.stats?.windows,
	
			normal: {
			  ...base.stats.windows.normal,
			  ...report.stats?.windows?.normal
			},
	
			min: {
			  ...base.stats.windows.min,
			  ...report.stats?.windows?.min
			},
	
			max: {
			  ...base.stats.windows.max,
			  ...report.stats?.windows?.max
			},
	
			rll: {
			  low: report.stats?.windows?.rll?.low ?? null,
			  threshold: report.stats?.windows?.rll?.threshold ?? null
			}
		  },
	
		  reserveGrid: {
			...base.stats.reserveGrid,
			...report.stats?.reserveGrid
		  }
		}
	  };
	}

    // ---- Toast Notification System ----
    let _toastContainer = null;
    function getToastContainer() {
        if (!_toastContainer || !document.body.contains(_toastContainer)) {
            _toastContainer = document.createElement("div");
            Object.assign(_toastContainer.style, {
                position: "fixed",
                top: "20px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: "2147483647", // max — ties with the top modals, so DOM order below decides
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
                pointerEvents: "none"
            });
        }
        // Re-append every time: at equal z-index the later sibling paints on top, so keeping
        // the container last in <body> puts toasts above the side panel and every modal.
        if (document.body.lastElementChild !== _toastContainer) document.body.appendChild(_toastContainer);
        return _toastContainer;
    }

    function showToast(msg, type = "info") {
        const container = getToastContainer();
        const toast = document.createElement("div");
        toast.textContent = msg;
        Object.assign(toast.style, {
            background: type === "error" ? "#b91c1c" : type === "success" ? "#065f46" : "#1e3a8a",
            color: "white",
            padding: "10px 20px",
            borderRadius: "6px",
            fontSize: "14px",
            opacity: "0",
            transition: "opacity 0.3s ease",
            whiteSpace: "pre-line",
            pointerEvents: "auto"
        });
        container.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = "1"; });
        setTimeout(() => {
            toast.style.opacity = "0";
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ---------------- UI (Top Bar) ----------------
    // Both pages: a toolbar with drop-down panes (the KPI box; on the run list also Highlight and
    // Compare), sharing the #ra-drawer button styles. Run list: a fixed box that placeDrawer() keeps
    // right-aligned just above the Completed runs box. Report page: a full-width bar across the top
    // of the page, in the page flow (buttons on the left), with the KPI box opening below it.
    const wrapper = document.createElement('div');
    wrapper.id = "ra-drawer";
    Object.assign(wrapper.style, {
        background: 'rgba(0,0,0,.85)',
        color: '#f1f1f1',
        borderBottom: '1px solid #333',
        font: '13px/1.3 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        zIndex: 2147483000,
    });
    if (IS_RUN_LIST) {
        // The run list page is absolutely positioned, so an in-flow bar would sit over NavBlue's controls
        Object.assign(wrapper.style, {
            position: 'fixed',
            top: '0',
            right: '12px',
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: '85vh',
            overflowY: 'auto',
            borderRadius: '8px',
            boxShadow: '0 6px 20px rgba(0,0,0,.5)',
            zIndex: 2147483642, // above the analysis panel (…640), below the modals (…645+)
        });
    }

    const ctrl = document.createElement('div'); // Holds the buttons
    Object.assign(ctrl.style, {
        padding: '8px 12px',
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        borderBottom: '1px solid #333'
    });

    // Run list toolbar buttons are styled from the stylesheet (#ra-drawer rules), so :disabled works.
    const firstButtons = IS_RUN_LIST ? `
    <span id="hl-run-stats" style="display:none;"></span>
    <button id="pull-report" class="ra-strip-btn" type="button" disabled>Select a run</button>
    <button id="repull-report" class="ra-strip-btn" type="button" title="Download this run again from NavBlue" style="display:none;">↻</button>
    <button id="kpi-drawer-toggle" class="ra-strip-btn" type="button">KPIs ▾</button>
    <button id="view-report-text" class="ra-strip-btn" type="button" disabled title="Open the downloaded report text in a new window">View Text</button>
    <button id="compare-runs" class="ra-strip-btn" type="button" title="Pick runs from the list to compare">Compare ▾</button>
    <button id="validate-run" class="ra-strip-btn" type="button" disabled title="Check the selected run against the CBA">Validate</button>
    <button id="hl-toggle" class="ra-strip-btn" type="button" style="display:none;">Highlight ▾</button>
    ` : `
    <button id="load-report" class="ra-strip-btn" type="button" title="Analyze the report on this page">Analyze</button>
    <button id="kpi-drawer-toggle" class="ra-strip-btn" type="button">KPIs ▾</button>
    <button id="validate-run" class="ra-strip-btn" type="button" title="Check the report on this page against the CBA">Validate</button>`;

    // The version badge and Cache are run list only: the report page widget is just its three buttons
    const tailButtons = IS_RUN_LIST ? `
  <button id="changelog-btn" title="View change log"
  style="padding:6px 10px;border:0;border-radius:6px;background:#334155;color:#cbd5e1;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:6px;">
  <span style="font-size:13px;">📋</span> v${SCRIPT_VERSION}
</button>

  <button id="storage-size" type="button"></button>` : "";

    ctrl.innerHTML = `
    ${firstButtons}
    ${tailButtons}
  `;

    document.body.prepend(wrapper);
    wrapper.appendChild(ctrl);

    // ----------------UI (KPI INPUT) ----------------
    const kpiBox = document.createElement("div");
    kpiBox.id = "kpi-box";
    Object.assign(kpiBox.style, {
        background: "#1d1d1d",
        color: "#eee",
        borderBottom: "1px solid #333",
        font: "13px/1.3 system-ui, sans-serif"
    });

    kpiBox.innerHTML = `
  <div id="kpi-tab-bar"></div>
  <div id="kpi-lock-note">🔒 KPIs are locked once a report has run. Open a new tab (+) to enter different values.</div>
  <div id="kpi-fields" style="display:flex; gap:20px; padding:12px; align-items:flex-start;">
    <div style="display:flex; flex-direction:column; gap:6px; width:280px;">
      <label style="font-size:13px; font-weight:600;">ALV (HH:MM):</label>
      <input id="kpi-alv" class="kpi-input" type="text" placeholder="e.g. 81:30">
      <div style="display:flex; gap:16px; margin-top:8px; align-items:flex-start;">
        <div style="display:flex; flex-direction:column; gap:6px; flex:1; min-width:0;">
          <label style="font-size:13px; font-weight:600;">Total Trips:</label>
          <input id="kpi-trips" class="kpi-input" type="number" placeholder="e.g. 840" title="Validate on the IOE Pairings report checks its trips against 8% of this">
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:13px; font-weight:600;">Reserve Default:</label>
          <label class="switch" title="Which column this seat category compares against Required by default. The side panel toggle still overrides it for the current view.">
            <input type="checkbox" id="kpi-default-gross">
            <span class="slider"></span>
            <span class="switch-label" id="kpi-default-gross-label">NET</span>
          </label>
        </div>
      </div>
    </div>
    <div style="display:flex; flex-direction:column; flex:1;">
      <label style="font-size:13px; font-weight:600;">Paste KPI Grid from Excel:</label>
      <textarea id="kpi-grid" class="kpi-input" rows="8" placeholder="1/1/2026 5 12 7 2 for example"></textarea>
    </div>
  </div>
`;

    wrapper.appendChild(kpiBox);

    // ---------------- Run list toolbar: drop-down panes ----------------
    // The KPI box and the Run Highlighter's options drop down under the toolbar; only one is open
    // at a time. The report page has only the KPI pane.
    const hlPane = document.createElement("div");
    hlPane.id = "ra-hl-pane";
    const cmpPane = document.createElement("div"); // the runs picked for Compare (see "Compare picking")
    cmpPane.id = "ra-cmp-pane";
    let openPane = null;      // null | "kpi" | "hl" | "cmp"
    let onPaneChange = null;  // set by Compare picking, which is active while its pane is open
    let hlPaintButton = null; // set by the Run Highlighter so the pane state shows on its button
    function setPane(name) {
        openPane = name;
        kpiBox.style.display = name === "kpi" ? "" : "none";
        hlPane.style.display = name === "hl" ? "" : "none";
        cmpPane.style.display = name === "cmp" ? "" : "none";
        const t = document.getElementById("kpi-drawer-toggle");
        if (t) t.textContent = name === "kpi" ? "KPIs ▴" : "KPIs ▾";
        if (hlPaintButton) hlPaintButton();
        if (onPaneChange) onPaneChange();
    }

    // Our own layers, ignored when checking whether NavBlue has covered one of its widgets.
    const isOurs = (el) => !!(el && el.closest && el.closest('#ra-drawer, #ra-panel, [id^="ra-"]'));

    // The rect of a NavBlue widget if it is really showing: laid out, not hidden, and not drawn
    // over by another screen of the app (NavBlue stacks its screens). Else null.
    function boxOnScreen(box) {
        if (!box) return null;
        const r = box.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return null;           // display:none / other tab
        if (getComputedStyle(box).visibility === "hidden") return null;
        if (r.bottom <= 0 || r.top >= window.innerHeight) return null;   // scrolled right out of view
        if (typeof document.elementsFromPoint === "function") {
            // Sample inside the part that is in view, so a box scrolled half off still counts
            const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
            const y = Math.min(window.innerHeight - 1, r.bottom - 1, Math.max(0, r.top) + 20);
            const top = document.elementsFromPoint(x, y).find(el => !isOurs(el));
            if (top && !box.contains(top)) return null;
        }
        return r;
    }

    setPane(null);
    document.getElementById("kpi-drawer-toggle").addEventListener("click", () => setPane(openPane === "kpi" ? null : "kpi"));

    // A press anywhere outside the toolbar and its panes closes the open pane. Clicks on a run row
    // leave the Highlight and Compare panes open: Mark KPI / ALPA / Color act on the run just
    // selected, and Compare picks runs by clicking them. Match the rows, not the Completed group
    // box: that box wraps the whole run manager (child runs table and all). Capture phase, so
    // NavBlue stopping propagation can't hide the press; the press itself goes through untouched.
    // A shadow DOM click (the highlighter's options) reaches us retargeted to its host, inside
    // the toolbar.
    document.addEventListener("pointerdown", (e) => {
        if (!openPane) return;
        const t = e.target;
        if (!t || !t.closest || wrapper.contains(t)) return;
        if ((openPane === "hl" || openPane === "cmp") && t.closest('div.TableRow[id^="cr_table_"]')) return;
        setPane(null);
    }, true);

    if (IS_RUN_LIST) {
        kpiBox.style.width = "760px"; // report page: the bar's full width, as before
        kpiBox.style.maxWidth = "100%";
        wrapper.insertBefore(hlPane, kpiBox);
        wrapper.insertBefore(cmpPane, kpiBox);
        document.getElementById("hl-toggle").addEventListener("click", () => setPane(openPane === "hl" ? null : "hl"));

        // Sit just above the Completed runs group box, right-aligned to the window. The box's id
        // ends in a widget counter (completed_runs_groupbox_691), so match the prefix. NavBlue
        // builds and moves it after load, and it is hidden on other tabs — so re-measure on a
        // timer as well as on resize/scroll, and fall back to the top of the window.
        // Off the run list (another screen, e.g. the launcher, covers it) the toolbar hides, but the
        // analysis panel stays reachable: it closes, and an "Analyzer" tab on the right edge opens it
        // full height (.ra-away) until ✕. Back on the list, the panel is as it was left there.
        const awayTab = document.createElement("button");
        awayTab.id = "ra-away-tab";
        awayTab.type = "button";
        awayTab.style.display = "none";
        document.body.appendChild(awayTab);
        let away = false, openOnList = false;
        awayTab.addEventListener("click", () => {
            const panel = document.getElementById("ra-panel");
            if (panel) panel.classList.toggle("visible");
        });
        function placeDrawer() {
            const r = boxOnScreen(document.querySelector('[id^="completed_runs_groupbox_"]'));
            const want = r ? "" : "none";
            if (wrapper.style.display !== want) wrapper.style.display = want;
            // The panel is looked up, not referenced: it is built after this code first runs.
            const panel = document.getElementById("ra-panel");
            if (panel && !r !== away) {
                away = !r;
                if (away) {
                    openOnList = panel.classList.contains("visible");
                    panel.classList.remove("visible");
                } else {
                    panel.classList.toggle("visible", openOnList);
                }
                panel.classList.toggle("ra-away", away);
            }
            // The tab shows only while away and once a run has been analyzed
            const name = panel && document.getElementById("ra-report-name")?.textContent.trim();
            const tabWant = away && name ? "" : "none";
            if (awayTab.style.display !== tabWant) awayTab.style.display = tabWant;
            if (tabWant === "" && awayTab.dataset.name !== name) {
                awayTab.dataset.name = name;
                awayTab.textContent = `◂ Analyzer · ${name}`;
                awayTab.title = `Open the analysis of ${name}`;
            }
            if (!r) return;
            const strip = ctrl.offsetHeight || 40;
            const top = Math.max(0, Math.round(r.top - strip - 4));
            if (wrapper.style.top !== `${top}px`) wrapper.style.top = `${top}px`;
            // The analysis panel starts just under the button strip
            document.documentElement.style.setProperty("--ra-panel-top", `${top + strip + 6}px`);
        }
        window.addEventListener("resize", placeDrawer);
        window.addEventListener("scroll", placeDrawer, true); // capture: NavBlue scrolls inner panes
        setInterval(placeDrawer, 500);
        placeDrawer();
    }

    updateStorageSize();
    // Another tab on this site saving a download or KPIs changes the total too
    window.addEventListener("storage", updateStorageSize);
    // Clicking re-reads it, in case NavBlue's own page has stored more since the last save
    document.querySelector("#storage-size")?.addEventListener("click", updateStorageSize);

    // ---------- KPI Tab Helpers ----------
    // A tab is either a saved category (keyed in NBAnalyzerKPI) or the one unsaved "New" draft,
    // shown while activeKPICategory is null. The draft only becomes a category tab when a report
    // loads, because the category comes from the report. With no saved categories at all the
    // draft is open implicitly and the bar shows a hint instead of tabs.
    let kpiDraftOpen = false;
    let kpiDraftFields = null; // the draft's field values while another tab is showing

    // Locked = a report has run against it: the same condition the load path uses to take the
    // saved KPI as-is instead of re-reading the fields. A stub without a parsed grid stays editable.
    function isKPILocked(kpi) {
        return !!(kpi && kpi.alvTarget != null && kpi.gridText
            && kpi.grid && Object.keys(kpi.grid).length);
    }

    function isDraftVisible() {
        return kpiDraftOpen || !Object.keys(loadAllKPIs()).length;
    }

    function renderKPITabs() {
        const bar = document.getElementById("kpi-tab-bar");
        if (!bar) return;
        const cats = Object.keys(loadAllKPIs()).sort();
        if (!cats.length) {
            bar.innerHTML = '<span class="kpi-no-tabs">Fill in the KPIs and Analyze to create a category tab</span>';
            return;
        }
        const tab = (cat, label) => {
            const active = cat === activeKPICategory;
            return `<button class="kpi-tab-btn${active ? " active" : ""}${cat == null ? " draft" : ""}"${cat == null ? "" : ` data-cat="${cat}"`}>`
                + `${label}<span class="kpi-tab-close" title="Close tab">✕</span></button>`;
        };
        bar.innerHTML = cats.map(c => tab(c, c)).join("")
            + (kpiDraftOpen
                ? tab(null, "New")
                : '<button class="kpi-tab-btn kpi-tab-new" title="New category tab">+</button>');
    }

    // parseKPIGrid() still insists on a 4-digit year. As a convenience, a 2-digit year at the
    // start of a grid row (1/1/26) is rewritten in the textarea to 20YY, so the saved and
    // locked grid text carries the full year too.
    function expandTwoDigitYears(text) {
        return text.replace(/^(\s*\d{1,2}[\/-]\d{1,2}[\/-])(\d{2})(?=\s|$)/gm, "$120$2");
    }

    function expandKPIGridYears() {
        const el = document.querySelector("#kpi-grid");
        if (!el || el.readOnly) return;
        const expanded = expandTwoDigitYears(el.value);
        if (expanded !== el.value) el.value = expanded;
    }

    // On blur and on paste rather than on every keystroke, so the caret isn't thrown around
    // mid-typing — and a year that is still being typed isn't expanded halfway.
    const kpiGridEl = document.querySelector("#kpi-grid");
    kpiGridEl.addEventListener("change", expandKPIGridYears);
    kpiGridEl.addEventListener("input", (e) => {
        if (e.inputType === "insertFromPaste") expandKPIGridYears();
    });

    function readKPIFields() {
        return {
            alv: document.querySelector("#kpi-alv").value,
            trips: document.querySelector("#kpi-trips").value,
            gridText: document.querySelector("#kpi-grid").value,
            mode: readDefaultGrossField(),
        };
    }

    function writeKPIFields(f) {
        document.querySelector("#kpi-alv").value   = f?.alv ?? "";
        document.querySelector("#kpi-trips").value = f?.trips ?? "";
        document.querySelector("#kpi-grid").value  = f?.gridText ?? "";
        setDefaultGrossField(f?.mode === "actual" ? "actual" : "net");
    }

    function kpiFieldsHaveData() {
        const f = readKPIFields();
        return !!(f.alv.trim() || f.trips.trim() || f.gridText.trim());
    }

    function preloadKPIFields() {
        if (activeKPICategory == null) {
            writeKPIFields(kpiDraftFields);
        } else {
            const kpi = loadKPI(activeKPICategory);
            writeKPIFields({
                alv: kpi?.alvTarget != null
                    ? `${Math.floor(kpi.alvTarget / 60)}:${String(kpi.alvTarget % 60).padStart(2, "0")}`
                    : "",
                trips: kpi?.totalTrips ?? "",
                gridText: kpi?.gridText || "",
                mode: defaultCompareModeFor(kpi),
            });
        }
        applyKPILockState();

        // A count was checked against the previous tab's Total Trips — don't leave it standing
    }

    // Locked tabs show their KPIs as read-only text. The Reserve Default toggle stays usable —
    // it is a view default, not a KPI, and saves to the tab straight away.
    function applyKPILockState() {
        const locked = isKPILocked(loadKPI(activeKPICategory));
        kpiBox.classList.toggle("kpi-locked", locked);
        kpiBox.querySelectorAll(".kpi-input").forEach(el => { el.readOnly = locked; });
    }

    // The KPI toggle reads "gross when on, NET when off"
    function setDefaultGrossField(mode) {
        const chk = document.querySelector("#kpi-default-gross");
        const lbl = document.querySelector("#kpi-default-gross-label");
        if (chk) chk.checked = mode === "actual";
        if (lbl) lbl.textContent = mode === "actual" ? "Gross" : "NET";
    }

    function readDefaultGrossField() {
        return document.querySelector("#kpi-default-gross")?.checked ? "actual" : "net";
    }

    // On a saved tab (locked or not) the default is saved straight away. On the draft it just
    // sits in the field until a report loads and buildKPIFromFields() reads it.
    document.querySelector("#kpi-default-gross").addEventListener("change", () => {
        const mode = readDefaultGrossField();
        setDefaultGrossField(mode);

        if (!activeKPICategory) return;

        const kpi = loadKPI(activeKPICategory) || {};
        kpi.defaultCompareMode = mode;
        saveKPI(activeKPICategory, kpi);

        // Reflect it immediately if the panel is showing a report from this category
        if (workingReport && workingReport.category === activeKPICategory) {
            currentKPI = kpi;
            reserveCompareMode = mode;
            renderPanel(workingReport, kpi);
        }

        showToast(`${activeKPICategory} now defaults to ${mode === "actual" ? "Gross" : "NET"}.`, "success");
    });

    // ---------- IOE Pairings: IOE trips vs the 8% cap (the report page's Validate) ----------
    // On an IOE Pairings report Validate counts the trips listed (countIOETrips) and checks them
    // against Max IOE Withheld — 8% of the category's Total Trips KPI (computeMaxIOE, the figure
    // the panel shows for FO runs) — instead of running the CBA checks. The saved KPI for the
    // report's category wins; the field is used only while it shows that category (or the draft).
    // A month with no IOE pairings lists no rows: that is 0 trips.
    function validatePairingsReport(info) {
        const category = info.category || activeKPICategory;
        const counted = countIOETrips(info.raw);
        const results = [];

        let count = null;
        if (counted) {
            count = counted.trips;
            results.push({ label: "IOE Trips", status: "green", message: count
                ? `${count} trips (${counted.employees} employee${counted.employees === 1 ? "" : "s"})`
                : "0 — no IOE pairings on this report" });
        } else {
            results.push({ label: "IOE Trips", status: "default", message: "Couldn't find the list's end (End of IOE Pairing List) — is the whole report loaded?" });
        }

        let totalTrips = loadKPI(category)?.totalTrips ?? null;
        if (totalTrips == null && (activeKPICategory == null || activeKPICategory === category)) {
            const text = (document.querySelector("#kpi-trips")?.value ?? "").trim();
            totalTrips = text === "" ? null : Number(text);
        }
        const maxIOE = Number.isFinite(totalTrips) ? computeMaxIOE(totalTrips) : null;
        const capLabel = "Max IOE Withheld (8%)";

        if (maxIOE == null) {
            results.push({ label: capLabel, status: "default", message: `No Total Trips KPI${category ? ` for ${category}` : ""} — set it in the KPI box` });
        } else if (count == null) {
            results.push({ label: capLabel, status: "default", message: `Max ${maxIOE} (8% of ${totalTrips}) — no trip count to check` });
        } else {
            const ok = count <= maxIOE;
            results.push({ label: capLabel, status: ok ? "green" : "red",
                message: `${count} of max ${maxIOE} (8% of ${totalTrips} Total Trips)${ok ? "" : ` — ${count - maxIOE} over`}` });
        }
        return { category, results };
    }

    // null switches to the draft tab
    function switchKPITab(category) {
        if (activeKPICategory == null && category != null) kpiDraftFields = readKPIFields();
        activeKPICategory = category;
        renderKPITabs();
        preloadKPIFields();
    }

    function openKPIDraft() {
        if (!kpiDraftOpen) {
            kpiDraftOpen = true;
            kpiDraftFields = null;
        }
        switchKPITab(null);
    }

    function closeKPIDraft() {
        kpiDraftOpen = false;
        kpiDraftFields = null;
    }

    // ✕ on a tab. Closing a category deletes its KPIs (what Clear KPI used to do); closing the
    // draft discards whatever was typed into it.
    function closeKPITab(category) {
        if (category == null) {
            closeKPIDraft();
            if (activeKPICategory == null) {
                // The draft tab only shows beside category tabs, so there is always one to land on
                switchKPITab(Object.keys(loadAllKPIs()).sort()[0] ?? null);
                kpiDraftFields = null; // switchKPITab stashed the discarded draft
            } else {
                renderKPITabs();
            }
            return;
        }

        if (!confirm(`Close the ${category} tab and delete its KPIs?`)) return;
        clearKPI(category);
        if (activeKPICategory === category) {
            const remaining = Object.keys(loadAllKPIs()).sort();
            if (kpiDraftOpen || !remaining.length) {
                // Land on the draft; the implicit one starts empty, not with the deleted values
                if (!kpiDraftOpen) kpiDraftFields = null;
                activeKPICategory = null;
                renderKPITabs();
                preloadKPIFields();
            } else {
                switchKPITab(remaining[0]);
            }
        } else {
            renderKPITabs();
        }
        showToast(`Closed ${category} — its KPIs were deleted.`, "info");
    }

    // Initialise tabs from any previously saved KPI data
    const _savedCats = Object.keys(loadAllKPIs()).sort();
    if (_savedCats.length) switchKPITab(_savedCats[0]);
    else { renderKPITabs(); applyKPILockState(); }

    // ---------------- UI (Analysis Panel) ----------------
    const raPanel = document.createElement("div");
    raPanel.id = "ra-panel";
    if (IS_RUN_LIST) raPanel.classList.add("ra-wide"); // full width, two columns (stylesheet: #ra-panel.ra-wide)

    raPanel.innerHTML = `
  <header>
    <div style="display:flex; align-items:center; gap:10px;">
      <span id="ra-report-name" style="font-size:15px; font-weight:600; color:#e2e8f0;"></span>
    </div>
    <button id="ra-close">✕</button>
  </header>

  <div id="ra-content"></div>
`;

    document.body.appendChild(raPanel);

    // ---------------- Compare Modal ----------------
    const raCompareBackdrop = document.createElement("div");
    raCompareBackdrop.id = "ra-compare-backdrop";
    raCompareBackdrop.classList.add("ra-backdrop");
    raCompareBackdrop.innerHTML = `
  <div class="ra-compare-modal">
    <header class="ra-compare-header">
      <div class="ra-compare-title">Report Comparison</div>
      <div class="ra-compare-views" role="group" aria-label="Compare view">
        <button type="button" class="ra-compare-view-btn on" data-view="analysis" aria-pressed="true">Analysis</button>
        <button type="button" class="ra-compare-view-btn" data-view="inputs" aria-pressed="false">Inputs</button>
      </div>
      <button id="ra-compare-close" class="ra-modal-close">✕</button>
    </header>

    <div class="ra-compare-body">
      <div id="ra-compare-analysis">
        <div id="ra-compare-summary" class="ra-compare-summary">
          <!-- summary rows injected -->
        </div>

        <div id="ra-compare-grid" class="ra-compare-grid">
          <!-- grid comparison injected -->
        </div>
      </div>

      <div id="ra-compare-inputs" class="ra-compare-grid" style="display:none;">
        <!-- input diff injected -->
      </div>
    </div>
  </div>
`;
    document.body.appendChild(raCompareBackdrop);

    // ---------------- Validation Modal ----------------
    const raValidateBackdrop = document.createElement("div");
    raValidateBackdrop.id = "ra-modal-validate-backdrop";
    raValidateBackdrop.classList.add("ra-backdrop");

    raValidateBackdrop.innerHTML = `
  <div class="ra-modal" id="ra-modal-validate">
    <header class="ra-modal-header">
      <div class="ra-modal-title">Validation</div>
      <button id="ra-modal-validate-close" class="ra-modal-close">✕</button>
    </header>

    <div class="ra-modal-body">
      <div id="ra-validation-content"></div>
    </div>
  </div>
`;

    document.body.appendChild(raValidateBackdrop);

    // ---------------- Change Log Modal ----------------
    function renderChangelog() {
        const intro = `<div class="ra-changelog-major">Latest ${CHANGELOG.releases.length} releases</div>`;
        const body = CHANGELOG.releases.map(rel => `
      <div class="ra-changelog-release">
        <div class="ra-changelog-version">v${rel.version}</div>
        <ul class="ra-changelog-notes">
          ${rel.notes.map(n => `<li>${n}</li>`).join("")}
        </ul>
      </div>
    `).join("");
        return intro + body;
    }

    const raChangelogBackdrop = document.createElement("div");
    raChangelogBackdrop.id = "ra-changelog-backdrop";
    raChangelogBackdrop.classList.add("ra-backdrop");
    raChangelogBackdrop.innerHTML = `
  <div class="ra-modal">
    <header class="ra-modal-header">
      <div class="ra-modal-title">Change Log — v${SCRIPT_VERSION}</div>
      <button id="ra-changelog-close" class="ra-modal-close">✕</button>
    </header>

    <div class="ra-modal-body">
      <div id="ra-changelog-content" class="ra-changelog">${renderChangelog()}</div>
    </div>
  </div>
`;

    document.body.appendChild(raChangelogBackdrop);

    // HTML functions for each section

	// general section
	function renderGeneralSection(report, kpi) {
    const stats = report?.stats || {};
    kpi = kpi || {};

    // First Officer run? (category ends in -FO, e.g. "73N-DOM-FO")
    const isFO = /-FO$/i.test(report?.category || "");

    // Holiday determination from period string (e.g. "Nov_2026")
    const holiday = isHolidayPeriod(report.period);
    const holidayLabel = holiday === null
        ? "Unknown"
        : holiday ? "Holiday 🦃🎄🥂🇺🇸" : "Non-Holiday";

    // Lines — from Stats or Dynamic; prompt the user if only Unstacking has been run
    const linesDisplay = resolveLineCount(stats) ?? "Run Stats or Dynamic";

    // RLL lines — Stats only. A parsed Stats report always answers this (0 when nobody bid
    // RLL), so a missing value means Stats has not run rather than "none".
    const rllDisplay = typeof stats.rllLines === "number" ? stats.rllLines : "Check Stats";

    // Bidders with No Line — Stats or Dynamic. 0 is a real answer, so test the type.
    const noLineEmployees = Array.isArray(stats.noLineEmployees) ? stats.noLineEmployees : [];
    const noLineDisplay = typeof stats.noLineBidders !== "number"
        ? "Check Stats or Dynamic"
        : stats.noLineBidders + (noLineEmployees.length ? ` (${noLineEmployees.join(", ")})` : "");

    // Min / Max window bidders honored — Dynamic Stats ("Min-Credits Honored/Allowed: 3/5"); the
    // allowed count comes from the Stats Options (MinCreditsHonoured Max = 5) when Stats has run.
    // 0 is a real answer, so test the type.
    const honoredDisplay = (c) => typeof c?.honored !== "number"
        ? "Check Dynamic"
        : c.honored + (typeof c.allowed === "number" ? ` of ${c.allowed} allowed` : "");
    const minHonoredDisplay = honoredDisplay(stats.minCredits);
    const maxHonoredDisplay = honoredDisplay(stats.maxCredits);

    // Total Trips — from the KPI box
    const totalTrips = kpi.totalTrips ?? null;
    const tripsDisplay = totalTrips != null ? totalTrips : "Set in KPI box";

    // IOE trips withheld vs max allowed (8% of total trips) — FO runs only
    const maxIOE = computeMaxIOE(totalTrips);
    let ioeStatus = "default";
    let ioeWithheldDisplay;
    if (stats.blockedIOETrips == null) {
        ioeWithheldDisplay = "Check Dynamic Report";
    } else if (maxIOE == null) {
        ioeWithheldDisplay = `${stats.blockedIOETrips} (set Total Trips)`;
    } else {
        ioeStatus = stats.blockedIOETrips <= maxIOE ? "green" : "red";
        ioeWithheldDisplay = `${stats.blockedIOETrips}`;
    }

    const spacer = `<div class="ra-status" style="background:transparent;"></div>`;
    const ioeBlock = isFO ? `
      <div style="display:flex; align-items:center; gap:8px;">
        ${spacer}
        <strong>Max IOE Withheld:</strong>&nbsp;${maxIOE != null ? maxIOE : "Set Total Trips"}
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="ra-status ${ioeStatus}"></div>
        <strong>IOE Trips Withheld:</strong>&nbsp;${ioeWithheldDisplay}
      </div>` : "";

return `
    <div class="ra-section-header">
      General${typeof linesDisplay === "number" ? ` (${linesDisplay} lines)` : ""}
      <span class="ra-header-subtle" style="margin-left:auto;">${holidayLabel}</span>
    </div>
    <div class="ra-section" style="display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; align-items:flex-start; gap:8px;">
        ${spacer}
        <strong style="white-space:nowrap;">Bidders with No Line:</strong>
        <span style="flex:1; min-width:0; overflow-wrap:anywhere;">${noLineDisplay}</span>
      </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${spacer}
          <strong>RLL Lines:</strong>&nbsp;${rllDisplay}
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${spacer}
          <strong>Min Window Honored:</strong>&nbsp;${minHonoredDisplay}
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${spacer}
          <strong>Max Window Honored:</strong>&nbsp;${maxHonoredDisplay}
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${spacer}
          <strong>Total Trips:</strong>&nbsp;${tripsDisplay}
        </div>
        ${ioeBlock}
    </div>
  `;
}

    // Unstacking & SLG — moved out of General (pairing figures) and Reserves (reserve lines %).
    function renderUnstackSection(report) {
    const stats = report?.stats || {};
    const holiday = isHolidayPeriod(report.period);

    // Unstack % — official number is the Unstacking report's highest %; a Dynamic Stats
    // value is only a preview of where it will land, so it stays yellow (never pass/fail).
    const unstackLimit = unstackLimitFor(holiday);
    const unstack = resolveUnstackStat(stats, "highestPairingsUnstackedPercent", "pairingsUnstackedPercent");

    let unstackStatus = "default";
    let unstackDisplay;
    if (stats.pairingUnstackEnabled === false) {
        unstackDisplay = "OFF"; // turned off for this run: no limit to check, whatever the numbers say
    } else if (unstack.value != null) {
        unstackStatus = unstack.estimate
            ? "yellow"
            : (unstack.value <= unstackLimit ? "green" : "red");
        unstackDisplay = `${unstack.value.toFixed(2)}% (Limit ${unstackLimit}%)` +
            (unstack.estimate ? " — Estimated" : "");
    } else {
        unstackDisplay = "Check Unstack Report";
    }

    // SLG count — official number is the Unstacking report's "# SLG Above 10% Threshold",
    // which must be 0. Dynamic only knows how many lines carry SLG at all.
    const slgCount = resolveSLGStat(stats, "slgAboveTenPercent", "pairingLinesWithSLG");

    let slgCountStatus = "default";
    let slgCountDisplay;
    if (slgCount.fromDynamic) {
        // Unstacking off: Dynamic's lines-with-SLG count. 0 proves none are above 10%;
        // more than 0 can't say how many are, so it stays yellow.
        slgCountStatus = slgCount.value === 0 ? "green" : "yellow";
        slgCountDisplay = slgCount.value === 0
            ? "0 (Must be 0) — from Dynamic"
            : `${slgCount.value} lines with SLG — from Dynamic, can't tell how many are above 10%`;
    } else if (slgCount.value != null) {
        slgCountStatus = slgCount.estimate
            ? "yellow"
            : (slgCount.value === 0 ? "green" : "red");
        slgCountDisplay = slgCount.estimate
            ? `${slgCount.value} — Estimated`
            : `${slgCount.value} (Must be 0)`;
    } else {
        slgCountDisplay = "Check Unstack Report";
    }

    // SLG % — informational; official number is the Unstacking report's highest %
    const slgLimit = LOA.SLG_PERCENT * 100;
    const slgPct = resolveSLGStat(stats, "highestPairingLinesSLGPercent", "pairingLinesWithSLGPercent");

    let slgPctStatus = "default";
    let slgPctDisplay;
    if (slgPct.value != null) {
        slgPctStatus = slgPct.estimate
            ? "yellow"
            : (slgPct.value <= slgLimit ? "green" : "red");
        slgPctDisplay = `${slgPct.value.toFixed(2)}% (Limit ${slgLimit}%)` +
            (slgPct.estimate ? " — Estimated" : slgPct.fromDynamic ? " — from Dynamic" : "");
    } else {
        slgPctDisplay = "Check Unstack Report";
    }

    // Reserve lines unstacked — Dynamic Stats and Unstacking both write it; no limit, so no indicator
    const reserveUnstackDisplay = stats.reserveUnstackEnabled === false ? "OFF"
        : typeof stats.reserveLinesUnstackedPercent === "number"
        ? `${stats.reserveLinesUnstackedPercent.toFixed(2)}%`
        : "Check Dynamic or Unstack Report";

    const spacer = `<div class="ra-status" style="background:transparent;"></div>`;
    const row = (status, label, value) => `
        <div style="display:flex; align-items:center; gap:8px;">
          ${status == null ? spacer : `<div class="ra-status ${status}"></div>`}
          <strong>${label}:</strong>&nbsp;${value}
        </div>`;

    return `
    <div class="ra-section-header">Unstacking &amp; SLG</div>
    <div class="ra-section" style="display:flex; flex-direction:column; gap:6px;">
      ${row(unstackStatus, "Unstack Pairing %", unstackDisplay)}
      ${row(slgCountStatus, "SLG's above 10%", slgCountDisplay)}
      ${row(slgPctStatus, "SLG Pairing %", slgPctDisplay)}
      ${row(null, "Unstack Reserve Lines %", reserveUnstackDisplay)}
    </div>
  `;
}


    // alv
    function renderALVSection(report, KPI) {
        const {
            status,
            message
        } = evaluateALV(report, KPI);

        const reportALV = minutesToHHMM(report?.stats?.alv);
        const kpiALV = minutesToHHMM(KPI?.alvTarget);

        return `
    <div class="ra-section-header">
      <div class="ra-status ${status}"></div>
      ALV
      <div>${reportALV}</div>
      <div style="color:#94a3b8;">${message}</div>
    </div>

    <div class="ra-section">
      <div><strong>Published ALV:</strong> ${kpiALV}</div>
    </div>
  `;
    }

    // open time
    function renderOpenTimeSection(report) {
        const {
            status,
            message
        } = evaluateOpenTime(report);

        const ot = report?.stats?.openTimePercent;
        const formattedOT = ot == null ? "—" : `${ot}%`;
        const otCredit = report?.stats?.openTimeCredit; // minutes, from the Stats report only

        return `
    <div class="ra-section-header">
      <div class="ra-status ${status}"></div>
      Open Time
      <div> ${formattedOT}</div>
    </div>

    <div class="ra-section">
      <div><strong>Credit:</strong> ${typeof otCredit === "number" ? minutesToHHMM(otCredit) : "Check Stats"}</div>
      <div><strong>Limit:</strong> ${LOA.OPEN_TIME_LIMIT}%</div>
    </div>
  `;
    }

    // Calc required reserves
    function computeRequiredReserves(totalSchedules) {
        if (!totalSchedules) return null;

        // First 48 schedules → 1 reserve per 8
        const first48 = Math.min(totalSchedules, 48);
        const rem = Math.max(0, totalSchedules - 48);

        const reservesFirst = Math.round(first48 / 8);
        const reservesRest = Math.round(rem / 10);

        return reservesFirst + reservesRest;
    }

    // Required long call lines: 1-4 reserves → 1, 5-10 → 2, above 10 → 20% rounded down.
    // Never 0 while there is at least one reserve.
    function computeRequiredLC(totalReserves) {
        if (!totalReserves) return null;
        if (totalReserves <= 4) return 1;
        if (totalReserves <= 10) return 2;
        return Math.floor(totalReserves * LOA.LC_PERCENT);
    }

    // Max IOE trips that may be withheld = 8% of total trips, true rounding to nearest whole trip
    function computeMaxIOE(totalTrips) {
        if (!totalTrips) return null;
        return Math.round(totalTrips * LOA.IOE_LIMIT);
    }

    // Reserve Grid
    // Reserves summary: the figures that used to ride in the reserve grid's header, plus 14LC.
    // Sits in the left column (run list) between Open Time and Unstacking; the grid has its own section.
    function renderReservesSection(report) {
        const stats = report?.stats || {};
        const lineCount = resolveLineCount(stats);
        const maxStack = computeMaxStack(lineCount, stats.openTimePercent);
        const stackLimitPct = (typeof stats.openTimePercent === "number" && stats.openTimePercent > LOA.OPEN_TIME_LIMIT)
            ? Math.round(LOA.DAILY_STACK_LIMIT_HIGH_OT * 100)
            : Math.round(LOA.DAILY_STACK_LIMIT * 100);

        const line = (label, value) => `<div><strong>${label}:</strong>&nbsp;${value}</div>`;
        return `
    <div class="ra-section-header">Reserves${stats.totalReserveDays != null ? ` (${stats.totalReserveDays} days)` : ""}</div>
    <div class="ra-section" style="display:flex; flex-direction:column; gap:6px;">
      ${line("Max Stack Height", `${maxStack ?? "—"}${maxStack != null ? ` (${stackLimitPct}%)` : ""}`)}
      ${line("Total Reserves", `${stats.totalReserves ?? "—"} (${computeRequiredReserves(lineCount) ?? "—"} Required)`)}
      ${line("14LC", `${stats.max14LC ?? "Ⓧ Not Set"} (${computeRequiredLC(stats.totalReserves) ?? "—"} Required)`)}
    </div>
  `;
    }

    // One day of the reserve grid against the KPI's Required: coverage (gross or net, as the
    // Compare Gross toggle says) minus Required. Shared by the panel's Reserve Grid and the
    // launch screen's Min column, so the two always show the same Diff.
    function reserveDayDiff(dayData, k) {
        const num = (n) => (typeof n === "number" && !Number.isNaN(n)) ? n : null;
        const required = num(k?.total);
        const base = num(reserveCompareMode === "actual" ? dayData?.actualCoverage : dayData?.netCoverage);
        return { required, base, diff: required != null && base != null ? base - required : null };
    }
    function diffClassFor(diff) {
        if (typeof diff !== "number") return "";
        return diff >= 0 ? "diff-green" : diff >= LOA.NET_TOLERANCE ? "diff-neutral" : "diff-red";
    }

    function renderReserveGridSection(report, kpi) {
        const stats = (report && report.stats) || {};
        const grid = stats.reserveGrid || {};
        const kpiGrid = (kpi && kpi.grid) || {};

        const dates = Object.keys(grid).sort(); // YYYY-MM-DD

        // For the Open Trips cells; the figure itself is shown in the Reserves section
        const maxStack = computeMaxStack(resolveLineCount(stats), stats.openTimePercent);

        // If no grid data at all, just show a stub message
        if (!dates.length) {
            return `
      <div class="ra-section-header">
        Reserve Grid
      </div>
      <div class="ra-section">
        No reserve grid data found. Make sure the Run Detail (and optionally Dynamic Stats) report has been loaded.
      </div>
    `;
        }

        let rowsHtml = "";
        let diffTotal = 0;
        let diffTotalHasValue = false;
        // Celebrate only when EVERY day has a Diff and none is below tolerance — a day
        // missing Required or coverage is unknown, not a pass.
        let allDaysMeetTolerance = true;

        for (const date of dates) {
            const dayData = grid[date] || {};
            const k = kpiGrid[date] || {};

            const required = (typeof k.total === "number" && !Number.isNaN(k.total)) ? k.total : null;
            const actual = (typeof dayData.actualCoverage === "number" && !Number.isNaN(dayData.actualCoverage)) ? dayData.actualCoverage : null;
            const openTrips = (typeof dayData.openTrips === "number" && !Number.isNaN(dayData.openTrips)) ? dayData.openTrips : null;
            const netFromStats = (typeof dayData.netCoverage === "number" && !Number.isNaN(dayData.netCoverage)) ? dayData.netCoverage : null;
            const minCoverage = (typeof dayData.minCoverage === "number" && !Number.isNaN(dayData.minCoverage)) ? dayData.minCoverage : null;

            // The report's own Min column (ReserveStackHeight / Reserve Coverage): reserves
            // requested for the day. Short when a nonzero request outruns Actual coverage.
            const minShort = (minCoverage != null && minCoverage > 0 && actual != null && minCoverage > actual)
                ? minCoverage - actual
                : null;

// Coverage (per the Compare Gross toggle) against Required
const { diff } = reserveDayDiff(dayData, k);


            if (typeof diff !== "number" || diff < LOA.NET_TOLERANCE) {
                allDaysMeetTolerance = false;
            }

            // Filter: only show days below NET_TOLERANCE, if toggle is on
            if (reserveGridFilters.onlyViolations) {
                if (typeof diff !== "number" || diff >= LOA.NET_TOLERANCE) {
                    continue;
                }
            }

            if (typeof diff === "number") {
                diffTotal += diff;
                diffTotalHasValue = true;
            }

            const weekend = isWeekend(date);
            const rowClass = weekend ? "weekend" : "";

            const diffClass = diffClassFor(diff); // green ≥ 0, neutral down to NET_TOLERANCE, red below

            const fmt = (n) =>
                typeof n === "number" && !Number.isNaN(n) ? n.toString() : "—";

            // main row
            rowsHtml += `
      <tr class="${rowClass}">
        <td>${date}</td>
        <td>${fmt(required)}</td>
        ${minShort != null
            ? `<td class="reserve-short" title="Min ${minCoverage}, Actual ${actual}: ${minShort} short"><span class="reserve-num">${fmt(actual)}<span class="reserve-short-amt">-${minShort}</span></span></td>`
            : `<td>${fmt(actual)}</td>`}
		<td class="${(openTrips != null && maxStack != null && openTrips > maxStack) ? "stack-red" : ""}">${fmt(openTrips)}</td>
        <td>${fmt(netFromStats)}</td>
        <td class="${diffClass}">${fmt(diff)}</td>
      </tr>
    `;

        }

        const celebrationKey = `${report?.name}|${report?.lastUpdated}`;
        const celebrationHtml = (allDaysMeetTolerance && celebrationDismissedKey !== celebrationKey)
            ? renderCelebration(celebrationKey, reserveCompareMode === "actual" ? "GROSS" : "NET")
            : "";

        // Nothing survived filters (e.g. onlyViolations on and no violators)
const emptyMessage = reserveGridFilters.onlyViolations
  ? `No days are below the NET tolerance (${LOA.NET_TOLERANCE}).`
  : "No rows to display.";
return `
  <div class="ra-section-header">Reserve Grid
<span class="ra-reserve-toggles">
  <label class="switch">
    <input type="checkbox" id="ra-reserve-only-violations"
      ${reserveGridFilters.onlyViolations ? "checked" : ""}>
    <span class="slider"></span>
    <span class="switch-label">Shortages Only</span>
  </label>

  <label class="switch">
    <input type="checkbox" id="ra-reserve-compare-actual"
      ${reserveCompareMode === "actual" ? "checked" : ""}>
    <span class="slider"></span>
    <span class="switch-label">Compare Gross</span>
  </label>
</span>
  </div>

  <div class="ra-section">
    <div class="ra-reserve-grid-wrap${celebrationHtml ? " celebrating" : ""}">
    ${celebrationHtml}
    ${
      rowsHtml
        ? `
          <table class="ra-reserve-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Required</th>
                <th>Actual</th>
                <th>Open Trips</th>
                <th>Net</th>
                <th>Diff (${reserveCompareMode === "actual" ? "Gross" : "NET"})${diffTotalHasValue ? `<br><span class="${diffTotal >= 0 ? "diff-green" : "diff-red"}">Σ ${diffTotal}</span>` : ""}</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        `
        : `
          <div class="ra-empty-message">
            ${emptyMessage}
          </div>
        `
    }
    </div>
  </div>
`;
}  

    // The 1.x "NET COVERAGES ACHIEVED" banner, brought back as an overlay on the reserve
    // grid with a one-shot confetti burst. Dismissed by a click outside the card (wired
    // in wireCelebration after each render).
    function renderCelebration(key, basis) {
        const colors = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#f97316"];
        let confetti = "";
        for (let i = 0; i < 48; i++) {
            const left = Math.round(Math.random() * 100);
            const delay = (Math.random() * 0.6).toFixed(2);
            const dur = (2.2 + Math.random() * 1.6).toFixed(2);
            const drift = Math.round(Math.random() * 80 - 40);
            const spin = Math.round(Math.random() * 720 - 360);
            const w = 5 + Math.round(Math.random() * 4);
            confetti += `<i style="left:${left}%; width:${w}px; height:${Math.round(w * 1.6)}px;
                background:${colors[i % colors.length]}; animation-delay:${delay}s;
                animation-duration:${dur}s; --drift:${drift}px; --spin:${spin}deg;"></i>`;
        }
        const tol = LOA.NET_TOLERANCE;
        return `
      <div class="ra-celebration" id="ra-celebration" data-key="${key}">
        <div class="ra-confetti">${confetti}</div>
        <div class="ra-celebration-card" title="Click outside to dismiss">
          <div class="ra-celebration-title">🎉 ${basis} COVERAGES ACHIEVED 🎉</div>
          <div class="ra-celebration-sub">All days meet or exceed ${tol} ${basis} coverage.</div>
        </div>
      </div>
    `;
    }

    function wireCelebration() {
        if (celebrationOutsideHandler) {
            document.removeEventListener("pointerdown", celebrationOutsideHandler, true);
            document.removeEventListener("keydown", celebrationOutsideHandler, true);
            celebrationOutsideHandler = null;
        }
        const el = document.getElementById("ra-celebration");
        if (!el) return;
        const card = el.querySelector(".ra-celebration-card");

        celebrationOutsideHandler = (e) => {
            if (e.type === "keydown" && e.key !== "Escape") return;
            if (e.type === "pointerdown" && card && card.contains(e.target)) return;
            celebrationDismissedKey = el.dataset.key;
            document.removeEventListener("pointerdown", celebrationOutsideHandler, true);
            document.removeEventListener("keydown", celebrationOutsideHandler, true);
            celebrationOutsideHandler = null;
            el.classList.add("leaving");
            const wrap = el.parentElement;
            setTimeout(() => {
                el.remove();
                if (wrap) wrap.classList.remove("celebrating");
            }, 250);
        };
        // Capture phase, and the click is NOT swallowed: clicking a toggle both dismisses
        // the celebration and flips the toggle.
        document.addEventListener("pointerdown", celebrationOutsideHandler, true);
        document.addEventListener("keydown", celebrationOutsideHandler, true);
    }

	// Coloring Grid
	function renderColoringSection(report, kpi) {
    const stats = report?.stats || {};
    const grid = stats.reserveGrid || {};
    const kpiGrid = kpi?.grid || {};

    const dates = Object.keys(grid)
        .filter(d => grid[d]?.colors)
        .sort();

    if (!dates.length) {
        return `
      <div class="ra-section-header">
        Reserve Coloring
      </div>
      <div class="ra-section">
        No coloring data found. Load a Dynamic Stats report with coloring enabled.
      </div>
    `;
    }

    const fmt = (n) =>
        typeof n === "number" && !Number.isNaN(n) ? n.toString() : "—";

    const fmtCell = (label, date) => {
        const req = kpiGrid[date]?.[label];
        const act = grid[date]?.colors?.[label];
        const reqFmt = fmt(typeof req === "number" ? req : null);
        const low = typeof req === "number" && typeof act === "number" && act < req;
        // No actual for this band on this day: neutral, never a green pass
        const actClass = typeof act !== "number" ? "" : low ? "color-low" : "color-ok";
        return `<td>${reqFmt} | <span class="${actClass}">${fmt(act)}</span></td>`;
    };

    // A band this base doesn't use (AFW/CVG: no AM) is left out — unless the KPI requires it,
    // in which case the column stays so the missing actuals show as "—".
    const BANDS = ["LC", "AM", "PM", "RE"];
    const shownBands = BANDS.filter(b =>
        dates.some(d => typeof grid[d]?.colors?.[b] === "number") ||
        dates.some(d => (kpiGrid[d]?.[b] ?? 0) > 0));

    const rows = dates.map(date => {
        const weekend = isWeekend(date);
        const rowClass = weekend ? "weekend" : "";
        return `
      <tr class="${rowClass}">
        <td>${date}</td>
        ${shownBands.map(b => fmtCell(b, date)).join("")}
      </tr>
    `;
    }).join("");

    return `
    <div class="ra-section-header">
      Reserve Coloring
    </div>
    <div class="ra-section">
      <table class="ra-reserve-table">
        <thead>
          <tr>
            <th>Date</th>
            ${shownBands.map(b => `<th>${b}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}
	
    // Fill the panel with sections
    function renderPanel(report, kpi) {
        if (!report) return;

        // Report Name shown next to save button
        const nameEl = document.getElementById("ra-report-name");
        if (nameEl) nameEl.textContent = report.name || "";

        // keep a reference so toggles can re-render
        currentKPI = kpi || currentKPI || null;

        const content = document.getElementById("ra-content");
        const kpiToUse = currentKPI || {};

// Run list: two columns, summaries | reserve grids. Report page sidebar: one column.
content.innerHTML = IS_RUN_LIST ? `
  <div class="ra-columns">
    <div class="ra-col">
      ${renderGeneralSection(report, kpiToUse)}
      ${renderALVSection(report, kpiToUse)}
      ${renderOpenTimeSection(report, kpiToUse)}
      ${renderReservesSection(report)}
      ${renderUnstackSection(report)}
    </div>
    <div class="ra-col">
      ${renderReserveGridSection(report, kpiToUse)}
      ${renderColoringSection(report, kpiToUse)}
    </div>
  </div>
  ` : `
    ${renderGeneralSection(report, kpiToUse)}
    ${renderALVSection(report, kpiToUse)}
    ${renderOpenTimeSection(report, kpiToUse)}
    ${renderReservesSection(report)}
    ${renderUnstackSection(report)}
    ${renderReserveGridSection(report, kpiToUse)}
    ${renderColoringSection(report, kpiToUse)}
  `;

        // wire up reserve grid toggles
const chkViol = document.getElementById("ra-reserve-only-violations");
if (chkViol) {
    chkViol.onchange = (e) => {
        reserveGridFilters.onlyViolations = e.target.checked;
        renderPanel(workingReport, currentKPI);
    };
}

const chkActual = document.getElementById("ra-reserve-compare-actual");
if (chkActual) {
    chkActual.onchange = (e) => {
        reserveCompareMode = e.target.checked ? "actual" : "net";
        renderPanel(workingReport, currentKPI);
    };
}

        wireCelebration();

        showPanel();
    }

    // ***************************************
    // VALIDATION MODAL
    // ***************************************

    function validateKPIALV(kpi) {
        const alv = kpi?.alvTarget;
        if (alv == null) {
            return {
                label: "Published ALV Range",
                status: "red",
                message: "Missing Published ALV"
            };
        }
        const ok = alv >= LOA.ALV_LOW && alv <= LOA.ALV_HIGH;

        return {
            label: "Published ALV Range",
            status: ok ? "green" : "red",
            message: `${minutesToHHMM(alv)} (Must be 72:00–88:00)`
        };
    }

    function validateReportALV(report, kpi) {
        const rep = report?.stats?.alv ?? null;
        const tgt = kpi?.alvTarget ?? null;

        if (rep == null || tgt == null) {
            return {
                label: "ALV",
                status: "red",
                message: "Missing ALV data"
            };
        }

        const tolerance = alvToleranceFor(report?.stats);
        const diff = rep - tgt;
        const ok = Math.abs(diff) <= tolerance;

        return {
            label: "ALV",
            status: ok ? "green" : "red",
            message: `${diff >= 0 ? "+" : ""}${diff} mins (Allowed ±${tolerance})`
        };
    }

    function validateOpenTime(report) {
        const ot = report?.stats?.openTimePercent;

        if (ot == null) return {
            label: "Open Time %",
            status: "red",
            message: "Missing"
        };

        const ok = ot <= LOA.OPEN_TIME_LIMIT;

        return {
            label: "Open Time %",
            status: ok ? "green" : "red",
            message: `${ot}% (Limit 2%)`
        };
    }

    function validateMinCW(report, kpi) {
        const alv = kpi?.alvTarget;
        if (!alv) return {
            label: "MIN Credit Window",
            status: "red",
            message: "Missing ALV"
        };

        const minLow = Math.max(alv - LOA.MAX_MIN_OFFSET, LOA.MIN_WINDOW_FLOOR);
        const minHigh = alv;

        const repLow = report?.stats?.windows?.min?.low ?? null;
        const repHigh = report?.stats?.windows?.min?.high ?? null;
        const repThresh = report?.stats?.windows?.min?.threshold ?? null;

        const ok = (repLow === minLow) && (repHigh === minHigh) && (repThresh >= LOA.LOWEST_THRESHOLD_MIN_WINDOW);

        return {
            label: "MIN Credit Window",
            status: ok ? "green" : "red",
            message: `Set: ${minutesToHHMM(repLow)} – ${minutesToHHMM(repHigh)}<br>Req: ${minutesToHHMM(minLow)} – ${minutesToHHMM(minHigh)}<br>Thresh: ${minutesToHHMM(repThresh)} >= 70`
        };
    }

    function validateMaxCW(report, kpi) {
        const alv = kpi?.alvTarget;
        if (!alv) return {
            label: "MAX Credit Window",
            status: "red",
            message: "Missing ALV"
        };

        const maxLow = alv;
        const maxHigh = alv + LOA.MAX_MIN_OFFSET;

        const repLow = report?.stats?.windows?.max?.low ?? null;
        const repHigh = report?.stats?.windows?.max?.high ?? null;

        const ok = (repLow === maxLow) && (repHigh === maxHigh);

        return {
            label: "MAX Credit Window",
            status: ok ? "green" : "red",
            message: `Set: ${minutesToHHMM(repLow)} – ${minutesToHHMM(repHigh)}<br>Req: ${minutesToHHMM(maxLow)} – ${minutesToHHMM(maxHigh)}`
        };
    }

    function validateNormalCW(report, kpi) {
        const alv = kpi?.alvTarget;
        if (!alv) return {
            label: "Normal Credit Window",
            status: "red",
            message: "Missing ALV"
        };

        const normLow = Math.max(alv - LOA.NORM_OFFSET, LOA.NORM_WINDOW_FLOOR)
        const normHigh = alv + LOA.NORM_OFFSET;

        const repLow = report?.stats?.windows?.normal?.low ?? null;
        const repHigh = report?.stats?.windows?.normal?.high ?? null;

        const ok = (repLow === normLow) && (repHigh === normHigh);

        return {
            label: "Normal Credit Window",
            status: ok ? "green" : "red",
            message: `Set: ${minutesToHHMM(repLow)} – ${minutesToHHMM(repHigh)}<br>Req: ${minutesToHHMM(normLow)} – ${minutesToHHMM(normHigh)}`
        };
    }

    function validateRLL(report) {
        const rllLow = report?.stats?.windows?.rll?.low ?? null;
        const rllThresh = report?.stats?.windows?.rll?.threshold ?? null;

        if (rllLow == null || rllThresh == null) {
            return {
                label: "RLL Floor",
                status: "default",
                message: "Missing RLL Data"
            };
        }
        const ok = (rllLow >= LOA.RLL_WINDOW_FLOOR) && (rllThresh >= LOA.RLL_WINDOW_FLOOR);

        return {
            label: "RLL Floor",
            status: ok ? "green" : "red",
            message: `Low: ${minutesToHHMM(rllLow)} (Must be ≥ 60:00)<br> Threshold: ${minutesToHHMM(rllThresh)}`
        };
    }

    function validateMaxStack(report, kpi) {
        const lineCount = resolveLineCount(report?.stats);
        const maxStack = computeMaxStack(lineCount, report?.stats?.openTimePercent);

        const grid = report?.stats?.reserveGrid || {};

        // Without a line count there is no limit to check against — say so rather
        // than reporting a green "No violations" the data does not support.
        if (maxStack == null) {
            return {
                label: "Max Stack Height",
                status: "default",
                message: "Missing line count — load the Stats or Dynamic Stats report"
            };
        }

        const viol = Object.entries(grid)
            .filter(([d, v]) => v.openTrips > maxStack)
            .map(([d]) => d);

        const ok = viol.length === 0;

        return {
            label: "Max Stack Height",
            status: ok ? "green" : "red",
            message: ok ? "No violations" : `Violations: ${viol.join(", ")}`
        };
    }

function validateUnstack(report, kpi) {
  if (report?.stats?.pairingUnstackEnabled === false) return {
    label: "Unstack %",
    status: "default",
    message: "OFF — unstacking was not enabled for this run"
  };

  const unstack = resolveUnstackStat(report?.stats, "highestPairingsUnstackedPercent", "pairingsUnstackedPercent");
  const pct = unstack.value;

  if (pct == null) return {
    label: "Unstack %",
    status: "red",
    message: "Missing — load the Unstacking report"
  };

  const bidMonth = kpi?.meta?.bidMonth ?? null;

  // If KPI is missing, fall back to old behavior (period string)
  let isHoliday = false;

  if (bidMonth != null) {
    // Holiday bid months: Jan(1), Jul(7), Nov(11), Dec(12)
    isHoliday = Number(bidMonth) in LOA.HOLIDAY_MONTHS;
  } else {
    const period = report?.period?.toLowerCase();
    if (!period) {
      return { label: "Unstack %", status: "default", message: "Missing KPI bid month" };
    }
    isHoliday = Object.values(LOA.HOLIDAY_MONTHS).some(m => period.includes(m));
  }

  const limit = unstackLimitFor(isHoliday);

  // A Dynamic Stats value only previews the official number — flag it instead of passing it
  if (unstack.estimate) {
    return {
      label: "Unstack %",
      status: "yellow",
      message: `${pct}% (Limit ${limit}%) — Dynamic estimate, load the Unstacking report`
    };
  }

  const ok = pct <= limit;

  return {
    label: "Unstack %",
    status: ok ? "green" : "red",
    message: `${pct}% (Limit ${limit}%)`
  };
}


    function validateSLG(report) {
        const slgCount = resolveSLGStat(report?.stats, "slgAboveTenPercent", "pairingLinesWithSLG");

        if (slgCount.value == null) return {
            label: "10% SLG",
            status: "red",
            message: "Missing — load the Unstacking report"
        };

        // Unstacking off: Dynamic is the only source. 0 lines with SLG means none above 10%.
        if (slgCount.fromDynamic) return slgCount.value === 0 ? {
            label: "10% SLG",
            status: "green",
            message: "0 (Must be 0) — from Dynamic, unstacking was off"
        } : {
            label: "10% SLG",
            status: "yellow",
            message: `${slgCount.value} lines with SLG — from Dynamic (unstacking was off), can't tell how many are above 10%`
        };

        // Dynamic only counts lines carrying SLG, not lines above the 10% threshold
        if (slgCount.estimate) return {
            label: "10% SLG",
            status: "yellow",
            message: `${slgCount.value} lines with SLG — Dynamic estimate, load the Unstacking report`
        };

        return {
            label: "10% SLG",
            status: slgCount.value === 0 ? "green" : "red",
            message: `${slgCount.value} (Must be 0)`
        };
    }

function getPSDState(report, kpi) {
    const usePsd = report?.stats?.usePriorityStackDate;
    const useSec = report?.stats?.useSecondaryPriorityStackDate;
    const psdEnabled = (usePsd === true) || (useSec === true);
    const bidMonth = kpi?.meta?.bidMonth ?? null;
    const psdRequired = bidMonth != null ? Number(bidMonth) in LOA.HOLIDAY_MONTHS : false;
    // The PSD switches come from the Stats report's Options; without them nothing can pass
    const psdKnown = usePsd != null || useSec != null;
    return { psdRequired, psdEnabled, psdKnown };
}

function validatePSD(report, kpi) {
  const { psdRequired, psdEnabled, psdKnown } = getPSDState(report, kpi);
  if (!psdKnown) return {
    label: "Priority Stack Date",
    status: "default",
    message: "Missing — load the Stats report"
  };

  // Only treat a PSD date as "present" if PSD is enabled
  const raw = psdEnabled
    ? (report?.stats?.priorityStackDate ?? report?.stats?.secondaryPriorityStackDate ?? null)
    : null;

// If not required and PSD is disabled => OK (even if a date value exists in config)
if (!psdRequired && !psdEnabled) {
  return {
    label: "Priority Stack Date",
    status: "green",
    message: "Not required for this bid month (PSD disabled)"
  };
}

// If not required but PSD is enabled => fail (it should be OFF)
if (!psdRequired && psdEnabled) {
  return {
    label: "Priority Stack Date",
    status: "red",
    message: "PSD is enabled but not required for this bid month (should be OFF)"
  };
}

  // If required but missing => fail
  if (psdRequired && !raw) {
    return {
      label: "Priority Stack Date",
      status: "red",
      message: "Missing PSD (required for holiday bid month)"
    };
  }

  // If PSD is present, validate that it matches the expected holiday date
  const cleaned = String(raw).replace(/-/g, ""); // YYYYMMDD
  const reportYear = Number(cleaned.slice(0, 4));
  const mm = cleaned.slice(4, 6);

  function thanksgiving(yr) {
    // UTC throughout: `new Date("YYYY-11-01")` is UTC midnight, which is still
    // October 31 in US time zones, so local getters never see November.
    const d = new Date(Date.UTC(yr, 10, 1));
    let th = 0;
    while (d.getUTCMonth() === 10) {
      if (d.getUTCDay() === 4) th++;
      if (th === 4) return d.toISOString().slice(0, 10);
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return null;
  }

  const expectedISO = {
    "01": `${reportYear}-01-01`,
    "07": `${reportYear}-07-04`,
    "11": thanksgiving(reportYear),
    "12": `${reportYear}-12-25`
  }[mm];

  // If it's some other month, we don't enforce a specific PSD date
  if (!expectedISO) {
    return {
      label: "Priority Stack Date",
      status: psdRequired ? "red" : "default",
      message: psdRequired ? `${raw} (Unexpected PSD month)` : `${raw} (PSD not required)`
    };
  }

  const expectedClean = expectedISO.replace(/-/g, "");
  const ok = cleaned === expectedClean;

  return {
    label: "Priority Stack Date",
    status: ok ? "green" : "red",
    message: ok ? raw : `${raw} (Required ${expectedISO})`
  };
}

function validateForcePSD(report, kpi) {
  const { psdRequired, psdEnabled, psdKnown } = getPSDState(report, kpi);
  if (!psdKnown) return {
    label: "Force PSD on SLG",
    status: "default",
    message: "Missing — load the Stats report"
  };

  // If PSD isn't required AND it's disabled, ForcePSD is N/A (pass)
  if (!psdRequired && !psdEnabled) {
    return {
      label: "Force PSD on SLG",
      status: "green",
      message: "Not required (PSD disabled)"
    };
  }

  // If PSD isn't required but is enabled, we already fail PSD check — but still flag ForcePSD as N/A
  if (!psdRequired && psdEnabled) {
    return {
      label: "Force PSD on SLG",
      status: "default",
      message: "PSD enabled (not required) — see PSD check"
    };
  }

  // PSD IS required (holiday bid month)
  // If PSD is required but disabled => fail (PSD should be ON)
  if (psdRequired && !psdEnabled) {
    return {
      label: "Force PSD on SLG",
      status: "red",
      message: "PSD is required but disabled"
    };
  }

  // PSD required and enabled => ForcePSD must be ON
  const force = report?.stats?.forcePsdSlg ?? null;

  return {
    label: "Force PSD on SLG",
    status: force ? "green" : "red",
    message: force ? "OK" : "Must be ON when PSD is enabled"
  };
}

    function validate14LC(report) {
        const reserves = report?.stats?.totalReserves ?? null;
        const used = report?.stats?.max14LC ?? null;

        if (reserves == null || used == null) {
            return {
                label: "14LC",
                status: "red",
                message: "Not Set"
            };
        }
        const req = computeRequiredLC(reserves) ?? 0;
        const ok = used === req;

        return {
            label: "14LC",
            status: ok ? "green" : "red",
            message: `Awarded ${used} / Required ${req}`
        };
    }

    function validateFollowedBy(report) {
        const fb = report?.stats?.followedBy ?? null;
        if (fb == null) return {
            label: "Followed By",
            status: "red",
            message: "Missing"
        };

        const limit = LOA.MAX_FOLLOWED_BY;
        const ok = fb <= limit;

        return {
            label: "Followed By",
            status: ok ? "green" : "red",
            message: `Set: ${minutesToHHMM(fb)} (Limit 18:30)`
        };
    }

    function validateNotesHLV() {
        return {
            label: "HLV Range",
            status: "default",
            message: "Check manually: HLV must be 74–86"
        };
    }

    function validateNotesNCW() {
        return {
            label: "NCW Threshold",
            status: "default",
            message: "Was NCW threshold set to published ALV first run?"
        };
    }

    function validateNotesThresholdChanges() {
        return {
            label: "CW Threshold Changes",
            status: "default",
            message: "Were thresholds changed before limiting max/min windows?"
        };
    }

    function validateALVAcrossCategory() {
        return {
            label: "7.5% ALV Difference",
            status: "default",
            message: "Were the ALVs across categories within 7.5%?"
        };
    }
    function runAllValidations(report, kpi) {
        return [
            validateKPIALV(kpi),
            validateReportALV(report, kpi),
            validateOpenTime(report),

            validateMinCW(report, kpi),
            validateMaxCW(report, kpi),
            validateNormalCW(report, kpi),

            validateRLL(report),
            validateMaxStack(report, kpi),

            validateUnstack(report, kpi),
            validateSLG(report),
            validatePSD(report, kpi),
            validateForcePSD(report, kpi),

            validate14LC(report),
            validateFollowedBy(report),

            validateNotesHLV(),
            validateNotesNCW(),
            validateALVAcrossCategory(),
            validateNotesThresholdChanges()
        ];
    }

    // ---------------- UI (Analysis Panel Styles) ----------------
    const style = document.createElement("style");
    style.textContent = `
  /* ---- Cache size (far right of the top bar) ---- */
  #storage-size {
    margin-left: auto;
    padding: 4px 8px;
    border: 0;
    border-radius: 5px;
    background: #334155;
    color: #cbd5e1;
    font-size: 11px;
    cursor: pointer;
  }

  /* ---- KPI Category Tabs ---- */
  #kpi-tab-bar {
    display: flex;
    gap: 2px;
    padding: 6px 12px 0;
    background: #111827;
    border-bottom: 1px solid #2d3748;
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .kpi-tab-btn {
    padding: 4px 14px;
    background: #1f2937;
    color: #6b7280;
    border: 1px solid #374151;
    border-bottom: none;
    border-radius: 5px 5px 0 0;
    cursor: pointer;
    font-size: 11px;
    font-family: ui-monospace, "Courier New", monospace;
    letter-spacing: 0.03em;
    transition: background 0.15s, color 0.15s;
  }

  .kpi-tab-btn:hover:not(.active) {
    background: #273348;
    color: #d1d5db;
  }

  .kpi-tab-btn.active {
    background: #1d1d1d;
    color: #ff8c00;
    border-color: #4b5563;
    font-weight: 700;
  }

  .kpi-tab-btn.draft {
    font-style: italic;
  }

  .kpi-tab-close {
    margin-left: 8px;
    padding: 0 3px;
    border-radius: 3px;
    color: #6b7280;
    font-weight: 400;
    font-style: normal;
  }

  .kpi-tab-close:hover {
    background: #7f1d1d;
    color: #fef2f2;
  }

  .kpi-tab-btn.kpi-tab-new {
    padding: 4px 10px;
    font-weight: 700;
  }

  /* ---- KPI fields: editable on the draft, read-only text once a report has run ---- */
  /* Styled here rather than inline so the locked rules below can override them */
  #kpi-alv, #kpi-trips {
    padding: 6px;
    border-radius: 4px;
    border: 1px solid #555;
    background: #2a2a2a;
    color: #fff;
  }

  #kpi-grid {
    width: 100%;
    padding: 8px;
    border-radius: 6px;
    border: 1px solid #444;
    background: #222;
    color: #fff;
    font-size: 12px;
    white-space: pre;
  }

  #kpi-box.kpi-locked .kpi-input {
    border-color: transparent;
    background: transparent;
    padding-left: 0;
    color: #e2e8f0;
    cursor: default;
    outline: none;
    resize: none;
  }

  #kpi-box.kpi-locked #kpi-trips {
    -moz-appearance: textfield;
  }

  #kpi-box.kpi-locked #kpi-trips::-webkit-inner-spin-button,
  #kpi-box.kpi-locked #kpi-trips::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  #kpi-lock-note {
    display: none;
    padding: 6px 12px 0;
    font-size: 11px;
    font-style: italic;
    color: #94a3b8;
  }

  #kpi-box.kpi-locked #kpi-lock-note { display: block; }

  .kpi-no-tabs {
    padding: 4px 8px;
    color: #4b5563;
    font-size: 12px;
    font-style: italic;
  }

  /* Panel container */
  #ra-panel {
    position: fixed;
    top: 0;
    right: -770px;
    width: 750px;
    height: 100vh;
    background: #0b1120;
    color: #e2e8f0;
    z-index: 2147483640;
    box-shadow: -4px 0 10px rgba(0,0,0,0.45);
    transition: right 0.30s ease;
    display: flex;
    flex-direction: column;
    font-family: system-ui, sans-serif;
  }

  #ra-panel.visible {
    right: 0;
  }

  /* Panel header */
  #ra-panel header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #1e293b;
    padding: 10px 14px;
    border-bottom: 1px solid #334155;
  }
  
#ra-panel header span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}

  #ra-close {
    background: transparent;
    border: none;
    font-size: 18px;
    color: #cbd5e1;
    cursor: pointer;
  }

  /* Content container */
  #ra-content {
    overflow-y: auto;
    padding-bottom: 50px;
  }

  /* Section headers */
.ra-section-header {
  background: #1e3a8a;
  color: #ff8c00;
  padding: 10px 14px;
  font-size: 18px;
  font-weight: 700;
  font-family: "Open Sans", system-ui, sans-serif;
  display: flex;
  align-items: center;
  gap: 10px;
  border-top: 1px solid #0f172a;
  border-bottom: 1px solid #0f172a;
}

  /* Section content area */
  .ra-section {
    padding: 16px 20px;
    background: #0f172a;
    color: #e2e8f0;
    font-size: 15px;
    line-height: 1.4;
  }

  /* Status icon square */
  .ra-status {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    flex-shrink: 0;
  }
.ra-status.default {
  background: #1e3a8a;
}
  .green  { background: #16a34a; !important;}
  .red    { background: #dc2626; !important;}
  .yellow { background: #eab308; !important;} /* provisional — value came from Dynamic Stats */

    .ra-header-subtle {
    margin-left: 8px;
    font-size: 13px;
    font-weight: 400;
    color: #e5e7eb;
    opacity: 0.8;
  }

/* Reserve Grid */

/* Base grid text color (not overriding color-coded cells) */
.ra-reserve-table td,
.ra-reserve-table th {
    color: #e2e8f0;
    font-family: "Inconsolata", "Courier New", monospace; /* mono font */
}

/* Weekend tint across the whole row */
.ra-reserve-table tr.weekend td {
    background: #1c2840;
}

/* Weekend only highlight date cell */
.ra-reserve-table tr.weekend td:first-child {
    color: #ff8c00 !important; /* weekend orange */
    font-weight: 700;
}

/* Actual below the report's Min: orange cell, shortfall tagged beside the number.
   The tag is absolutely positioned so it adds no width — the number stays centred and
   the columns stay put. tr in the selector so this beats the weekend row tint. */
.ra-reserve-table tr td.reserve-short {
    background: #c2410c;
    color: #fff;
    font-weight: 700;
}
.ra-reserve-table .reserve-num {
    position: relative;
}
.ra-reserve-table .reserve-short-amt {
    position: absolute;
    left: 100%;
    margin-left: 3px;
    font-size: 11px;
    white-space: nowrap;
    color: #fed7aa;
}

/* Reserve grid celebration overlay */
.ra-reserve-grid-wrap {
    position: relative;
}
.ra-reserve-grid-wrap.celebrating {
    min-height: 150px; /* room for the card even when Shortages Only empties the grid */
}
.ra-celebration {
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: none; /* the grid underneath stays scrollable/clickable */
    overflow: hidden;
    transition: opacity .25s ease;
}
.ra-celebration.leaving {
    opacity: 0;
}
.ra-celebration-card {
    pointer-events: auto;
    position: absolute;
    top: 12px;
    left: 50%;
    width: min(92%, 420px);
    transform: translateX(-50%);
    padding: 14px 12px;
    border: 1px solid #2563eb;
    border-radius: 10px;
    background: linear-gradient(90deg, rgba(37,99,235,.35), rgba(34,197,94,.35), rgba(234,179,8,.35)), #0f172a;
    box-shadow: 0 8px 30px rgba(0,0,0,.55);
    text-align: center;
    animation: ra-celebrate-pop .5s cubic-bezier(.2,1.4,.4,1) both;
}
.ra-celebration-title {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: .6px;
    background: linear-gradient(90deg,#60a5fa,#34d399,#fbbf24,#f472b6,#60a5fa);
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: ra-celebrate-shimmer 3s linear infinite;
}
.ra-celebration-sub {
    margin-top: 6px;
    font-size: 12px;
    color: #e2e8f0;
}
.ra-confetti i {
    position: absolute;
    top: -16px;
    border-radius: 2px;
    opacity: 0;
    animation-name: ra-confetti-fall;
    animation-timing-function: cubic-bezier(.3,.6,.6,1);
    animation-fill-mode: forwards;
}
@keyframes ra-celebrate-pop {
    from { opacity: 0; transform: translateX(-50%) scale(.6); }
    to   { opacity: 1; transform: translateX(-50%) scale(1); }
}
@keyframes ra-celebrate-shimmer {
    to { background-position: -200% 0; }
}
@keyframes ra-confetti-fall {
    0%   { opacity: 1; transform: translate(0, 0) rotate(0deg); }
    85%  { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--drift), 420px) rotate(var(--spin)); }
}
@media (prefers-reduced-motion: reduce) {
    .ra-confetti { display: none; }
    .ra-celebration-card, .ra-celebration-title { animation: none; }
}

/* Center-align all numeric columns */
.ra-reserve-table td:not(:first-child),
.ra-reserve-table th:not(:first-child) {
  text-align: center;
}

/* Horizontal toggle row */
/* Reserve Grid toggles, in the section header, pushed to its right end */
.ra-reserve-toggles {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-left: auto;
}
.ra-reserve-toggles .switch {
  margin-bottom: 0;
  font-weight: 400;
}

/* Red highlight when open trips exceed max stack */
.stack-red {
  color: #f87171 !important;
  font-weight: 700;
}

/* Inline hint next to a toggle */
.ra-toggle-hint {
  margin-left: 10px;
  font-size: 12px;
  color: #fbbf24; /* amber */
  opacity: 0.95;
  white-space: nowrap;
}

/* --- iOS-style toggle switches --- */

.switch {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  margin-bottom: 6px;
}

.switch input {
  display: none;
}

.slider {
  position: relative;
  width: 36px;
  height: 20px;
  background: #334155;
  border-radius: 20px;
  transition: background 0.25s ease;
}

.slider::before {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  top: 2px;
  left: 2px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.25s ease;
}

.switch input:checked + .slider {
  background: #0ea5e9;
}

.switch input:checked + .slider::before {
  transform: translateX(16px);
}

.switch-label {
  font-size: 13px;
  color: #e2e8f0;
}

  .ra-reserve-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .ra-reserve-table th,
  .ra-reserve-table td {
    padding: 2px 3px;
    border-bottom: 1px solid #1f2937;
    text-align: right;
  }

  .ra-reserve-table th:first-child,
  .ra-reserve-table td:first-child {
    text-align: left;
  }

  /* Color rows (under each date when enabled) */
  .ra-reserve-table tr.color-row td {
    font-size: 12px;
    font-style: italic;
  }

  /* Diff color rules */
.diff-green   { color: #22c55e !important; font-weight: 700; }
.diff-neutral { color: #f3f4f6 !important; }
.diff-red     { color: #f87171 !important; font-weight: 700; }


  /* Reserve color comparisons */
  .color-req {
    color: #9ca3af;
  }

  .color-ok {
    color: #e5e7eb;
  }

  .color-low {
    color: #fca5a5;
    font-weight: 600;
  }

  /* ---------- Modals (validation, change log) ---------- */
.ra-modal {
  width: 650px;
  background: #0f172a;
  border-radius: 10px;
  border: 1px solid #1e293b;
  box-shadow: 0 12px 30px rgba(0,0,0,0.55);
  font-family: "Open Sans", system-ui, sans-serif;
}

.ra-modal-header {
  background: #1e3a8a;
  color: #ff8c00;
  font-size: 18px;
  padding: 14px;
  font-weight: 700;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

  .ra-modal-title {
    font-size: 16px;
    font-weight: 600;
    color: #e5e7eb;
  }

.ra-backdrop {
  display: none;
}

/* Make ALL modals using ".ra-backdrop.visible" display */
.ra-backdrop.visible {
  display: flex !important;
}

  .ra-modal-close {
    background: transparent;
    border: none;
    font-size: 18px;
    color: #9ca3af;
    cursor: pointer;
  }

.ra-modal-body {
  padding: 10px 14px;
  max-height: 60vh;
  overflow-y: auto;
  background: #0b1120;
}

  /* Make grid monospace for alignment */
  .ra-reserve-table {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }
/* ============================
   COMPARE MODAL BASE STYLES
   ============================ */

.ra-compare-modal {
  background: #0f172a;
  color: #e2e8f0;
  padding: 25px;
  border-radius: 10px;
  width: 95%;
  max-width: 1400px;
  max-height: 90vh;
  overflow-y: auto;
  font-family: system-ui, sans-serif;
  box-shadow: 0 0 25px rgba(0,0,0,0.5);
  position: relative;
}

/* Modal Header */
.ra-compare-header {
  background: #1e3a8a;
  color: #ff8c00;
  padding: 12px 16px;
  font-size: 20px;
  font-weight: 700;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-radius: 6px;
  margin-bottom: 15px;
}

#ra-compare-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.75);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 2147483646; /* one step above Manage modal */
}

/* Close icon */
#ra-compare-close {
  cursor: pointer;
  font-size: 18px;
  color: #e2e8f0;
}

/* Analysis / Inputs switch in the comparison header */
.ra-compare-views {
  display: inline-flex;
  margin-left: auto;
  margin-right: 16px;
  border: 1px solid #3b5bdb;
  border-radius: 6px;
  overflow: hidden;
}
.ra-compare-view-btn {
  padding: 5px 14px;
  border: 0;
  background: transparent;
  color: #cbd5e1;
  font: 600 13px system-ui, sans-serif;
  cursor: pointer;
}
.ra-compare-view-btn.on {
  background: #ff8c00;
  color: #0f172a;
}

/* ============================
   INPUT COMPARE (Inputs view)
   ============================ */

/* Up to ten runs: the table scrolls sideways rather than squeezing the values */
.ra-ic-scroll { overflow-x: auto; }

.ra-ic-table th.ra-ic-run { vertical-align: bottom; min-width: 70px; }
.ra-ic-name {
  display: block;
  color: #cbd5e1;
  font-weight: 400;
  font-size: 11px;
  white-space: normal;
  overflow-wrap: anywhere;
}

.ra-ic-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-family: ui-monospace, "SF Mono", Consolas, "Courier New", monospace;
}

.ra-ic-table th {
  background: #1e293b;
  color: #ff8c00;
  padding: 8px 10px;
  border-bottom: 1px solid #334155;
  text-align: left;
  position: sticky;
  top: 0;
}

.ra-ic-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #1f2937;
  color: #e2e8f0;
  white-space: nowrap;
}

.ra-ic-table td.ra-ic-field { color: #94a3b8; }

.ra-ic-table tr.ra-ic-section td {
  background: #0b1220;
  color: #ff8c00;
  font-weight: 700;
  font-family: system-ui, sans-serif;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.04em;
  border-bottom: 1px solid #334155;
}

.ra-ic-table tr.ra-ic-diff td {
  background: rgba(248, 113, 113, 0.12);
}

.ra-ic-table tr.ra-ic-diff td.ra-ic-field { color: #e2e8f0; font-weight: 600; }

/* Weekend tint on the per-day grid rows (scalar option rows are never weekends).
   A row that also differs keeps the red diff tint — that signal matters more. */
.ra-ic-table tr.weekend td {
  background: #1c2840;
}

.ra-ic-table tr.weekend.ra-ic-diff td {
  background: rgba(248, 113, 113, 0.12);
}

/* Weekend orange on the date, diff row or not */
.ra-ic-table tr.weekend td.ra-ic-field {
  color: #ff8c00;
  font-weight: 700;
}

.ra-ic-empty {
  text-align: center;
  color: #94a3b8;
  padding: 24px 10px;
}

/* ============================
   SUMMARY TABLE
   ============================ */

.ra-compare-summary-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
  font-size: 13px;
  font-family: ui-monospace, "SF Mono", Consolas, "Courier New", monospace;
}

.ra-compare-summary-table th {
  background: #1e293b;
  color: #ff8c00;
  padding: 8px 10px;
  border-bottom: 1px solid #334155;
  text-align: left;
}

.ra-compare-summary-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #1f2937;
  white-space: nowrap;
  color: #e2e8f0;
}

.ra-compare-summary-table tr:nth-child(even) td {
  background: #111827;
}

.ra-compare-note {
  margin: -12px 0 20px;
  font-size: 12px;
  color: #eab308;
}

/* ============================
   COMPARE GRID (BOTTOM HALF)
   ============================ */

/* Column show/hide chips, right-aligned in the section header */
.ra-col-toggles {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ra-col-toggles-label {
  font-size: 13px;
  font-weight: 400;
  color: #e2e8f0;
}

.ra-col-toggle {
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  padding: 5px 9px;
  border: 1px solid #334155;
  border-radius: 12px;
  background: #0f172a;
  color: #64748b;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.ra-col-toggle:hover {
  border-color: #0ea5e9;
}

/* Lit chip = column visible */
.ra-col-toggle.on {
  background: #0ea5e9;
  border-color: #0ea5e9;
  color: #f8fafc;
}

.ra-compare-empty {
  padding: 14px 4px 20px;
  font-size: 13px;
  color: #eab308;
}

.ra-compare-grid-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
  font-family: ui-monospace, "SF Mono", Consolas, "Courier New", monospace;
}

.ra-compare-grid-table th {
  background: #1e293b;
  color: #ff8c00;
  padding: 6px 10px;
  border-bottom: 1px solid #334155;
  text-align: center;
}

.ra-compare-grid-table td {
  padding: 4px 6px;
  border-bottom: 1px solid #1f2937;
  text-align: center;
  color: #e2e8f0;
}

/* Group section headers (OT / NET / DIFF) */
.group-head {
  background: #243047;
  color: #ff8c00;
  font-weight: 700;
  text-align: center;
  border-bottom: 1px solid #334155;
}

/* Bring report columns much closer together */
.ra-compare-grid-table th,
.ra-compare-grid-table td {
  padding: 3px 4px;
}

/* Add small gap between the OT, NET, DIFF blocks */
.ra-compare-grid-table th.group-head + th.group-head {
  border-left: 6px solid #0f172a;
}

.ra-compare-grid-table th:first-child,
.ra-compare-grid-table td:first-child {
  width: 88px;
}

.ra-compare-grid-table th:nth-child(2),
.ra-compare-grid-table td:nth-child(2) {
  width: 40px;
  text-align: center;
}

.ra-compare-grid-table th.sub-col {
  width: 34px;
  padding: 2px 1px;
  font-size: 11px;
}

/* Σ of a report's DIFF column, on its own line under the report label */
.ra-col-sum {
  display: block;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}


/* Add vertical separators in data rows */
.ra-compare-grid-table td.sep {
  border-left: 6px solid #0f172a;
}

/* visual separator before NET and DIFF blocks */
.sep {
  border-left: 8px solid transparent;
}

/* Weekend tint */
.ra-compare-grid-table tr.weekend td {
  background: #1c2840;
}
.ra-compare-grid-table tr.weekend td:first-child {
  color: #ff8c00;
  font-weight: 600;
}

/* Separation between sections in grid */
.col-gap {
  border-right: 2px solid #334155;
}

/* Net <= stack limit color for OpenTrips */
.ot-red { color: #f87171; font-weight: 600; }

/* Validation modal layout */
.ra-validation-body {
  padding: 15px;
  font-family: "Open Sans", sans-serif;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ra-validation-row {
  display: grid;
  grid-template-columns: 20px 200px 1fr;
  align-items: center;
  background: #111;
  padding: 6px 10px;
  border-radius: 6px;
  gap: 10px;
}

/* Indicator colors */
.ra-validation-indicator {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: #333;
}

.ra-validation-indicator.green {
  background: #0c0;
}

.ra-validation-indicator.red {
  background: #c00;
}

.ra-validation-indicator.yellow {
  background: #eab308;
}

.ra-validation-label {
  color: #ff8c00;
  font-weight: 600;
}

.ra-validation-output {
  color: #eee;
  font-family: monospace;
}

#ra-modal-validate-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.75);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 2147483647 !important; /* highest in the system */
}

/* Validation uses the window's full height (it sits above the run list toolbar, so it need not
   start below it). The shared .ra-modal-body caps itself at 60vh; this one fills the modal. */
#ra-modal-validate {
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 24px);
}
#ra-modal-validate .ra-modal-body {
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;
}

#ra-changelog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.75);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 2147483647 !important;
}

/* Like the validation modal: the window's full height, the body filling it (not the shared 60vh) */
#ra-changelog-backdrop .ra-modal {
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 24px);
}
#ra-changelog-backdrop .ra-modal-body {
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;
}

.ra-changelog {
    font-size: 14px;
    color: #e5e7eb;
}

.ra-changelog-major {
    font-size: 13px;
    font-weight: 600;
    color: #93c5fd;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 12px;
}

.ra-changelog-release {
    border-left: 3px solid #1e3a8a;
    padding: 2px 0 2px 12px;
    margin-bottom: 16px;
}

.ra-changelog-version {
    font-size: 15px;
    font-weight: 700;
    color: #ff8c00;
    margin-bottom: 6px;
}

.ra-changelog-notes {
    margin: 0;
    padding-left: 18px;
}

.ra-changelog-notes li {
    margin-bottom: 4px;
    line-height: 1.4;
}

/* Run list: the analysis panel spans the window under the toolbar instead of a 750px sidebar */
#ra-panel.ra-wide {
    top: var(--ra-panel-top, 56px);
    left: 12px;
    right: 12px !important;
    width: auto;
    height: calc(100vh - var(--ra-panel-top, 56px) - 12px);
    border-radius: 8px;
    transform: translateX(calc(100% + 24px));
    transition: transform 0.30s ease;
}
#ra-panel.ra-wide.visible {
    transform: none;
}
/* Run list covered by another screen: the panel opens full height from the Analyzer tab */
#ra-panel.ra-wide.ra-away {
    top: 12px;
    height: calc(100vh - 24px);
}
#ra-away-tab {
    position: fixed;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    writing-mode: vertical-rl;
    max-height: 70vh;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 12px 6px;
    border: 1px solid #334155;
    border-right: 0;
    border-radius: 8px 0 0 8px;
    background: #1e293b;
    color: #e2e8f0;
    font: 600 12px/1 system-ui, sans-serif;
    cursor: pointer;
    box-shadow: -3px 0 10px rgba(0,0,0,.4);
    z-index: 2147483639; /* just under the panel, which covers it when open */
}
#ra-away-tab:hover { background: #334155; }
/* Two columns, each scrolling on its own: the reserve grid is far longer than the summaries */
#ra-panel.ra-wide #ra-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding-bottom: 0;
}
#ra-panel.ra-wide .ra-columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    height: 100%;
    padding: 0 12px;
}
#ra-panel.ra-wide .ra-col {
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 40px;
}
/* Narrow window: back to one scrolling column */
@media (max-width: 1100px) {
    #ra-panel.ra-wide #ra-content { overflow-y: auto; }
    #ra-panel.ra-wide .ra-columns { grid-template-columns: minmax(0, 1fr); height: auto; }
    #ra-panel.ra-wide .ra-col { overflow: visible; padding-bottom: 0; }
    #ra-panel.ra-wide .ra-col:last-child { padding-bottom: 40px; }
}
/* Compact sizing for the wide panel: banners ~30% smaller, section text 2px smaller */
#ra-panel.ra-wide .ra-section-header {
    padding: 7px 10px;          /* was 10px 14px */
    font-size: 13px;            /* was 18px */
    gap: 7px;                   /* was 10px */
}
#ra-panel.ra-wide .ra-section-header .ra-status {
    width: 13px;                /* was 18px */
    height: 13px;
}
#ra-panel.ra-wide .ra-header-subtle {
    font-size: 11px;            /* was 13px */
}
#ra-panel.ra-wide .ra-reserve-toggles { gap: 14px; }
#ra-panel.ra-wide .ra-reserve-toggles .switch-label { font-size: 12px; }
#ra-panel.ra-wide .ra-section {
    font-size: 13px;            /* was 15px */
}
#ra-panel.ra-wide .ra-section .ra-status {
    width: 15px;                /* was 18px, to suit the smaller text */
    height: 15px;
}
/* Reserve grid and Reserve Coloring (both .ra-reserve-table, monospace) */
#ra-panel.ra-wide .ra-reserve-table {
    font-size: 12px;            /* was 13px */
}

/* Run list toolbar buttons (stylesheet, not inline, so :disabled can win) */
#ra-drawer .ra-strip-btn {
    padding: 6px 10px; border: 0; border-radius: 6px; cursor: pointer;
    background: #334155; color: #cbd5e1; font-size: 12px; white-space: nowrap;
}
#ra-drawer .ra-strip-btn:disabled { opacity: .4; cursor: default; }
#ra-drawer #pull-report, #ra-drawer #load-report { background: #2563eb; color: #fff; font-weight: 600; padding: 6px 12px; }
#ra-drawer #pull-report[data-state="ready"] { background: #047857; }
#ra-drawer #pull-report[data-state="busy"]  { background: #b45309; }
#ra-drawer #repull-report { background: #1e40af; color: #fff; font-size: 13px; padding: 6px 9px; }
#ra-drawer #hl-toggle.hl-on   { background: #fef3c7; color: #422006; }
#ra-drawer #validate-run { background: #fff; color: #000; }
#ra-drawer #hl-toggle.hl-warn { box-shadow: 0 0 0 2px #dc2626; }
/* Solid like the KPI box (the toolbar behind them is see-through) */
#ra-hl-pane, #ra-cmp-pane { background: #1d1d1d; color: #eee; border-bottom: 1px solid #333; }
#ra-drawer #hl-run-stats { color: #fb923c; font-size: 12px; font-weight: 600; white-space: nowrap; }
#ra-hl-pane { padding: 8px 12px; }
#ra-drawer #compare-runs { background: #0f766e; color: #ecfdf5; }
#ra-drawer #compare-runs.cmp-on { box-shadow: 0 0 0 2px #5eead4; }
#ra-cmp-pane { padding: 8px 12px 10px; width: 520px; max-width: 100%; box-sizing: border-box; font-size: 12px; }
#ra-cmp-pane .ra-cmp-head { color: #cbd5e1; margin-bottom: 6px; display: flex; justify-content: space-between; gap: 12px; }
#ra-cmp-pane .ra-cmp-count { color: #94a3b8; white-space: nowrap; }
#ra-cmp-pane .ra-cmp-empty { color: #94a3b8; font-style: italic; padding: 4px 0 8px; }
#ra-cmp-pane .ra-cmp-list { list-style: none; margin: 0 0 8px; padding: 0; }
#ra-cmp-pane .ra-cmp-list li { display: flex; align-items: center; gap: 8px; padding: 3px 0; border-bottom: 1px solid #263244; }
#ra-cmp-pane .ra-cmp-list b { color: #ff8c00; width: 14px; }
#ra-cmp-pane .ra-cmp-name { flex: 1; color: #e2e8f0; overflow-wrap: anywhere; }
#ra-cmp-pane .ra-cmp-st { white-space: nowrap; }
#ra-cmp-pane .ra-cmp-st.ready { color: #4ade80; }
#ra-cmp-pane .ra-cmp-st.busy  { color: #fbbf24; }
#ra-cmp-pane .ra-cmp-st.bad   { color: #f87171; }
#ra-cmp-pane .ra-cmp-remove, #ra-cmp-pane .ra-cmp-retry {
    border: 0; border-radius: 4px; background: #334155; color: #cbd5e1; cursor: pointer; font-size: 11px; padding: 2px 6px;
}
#ra-cmp-pane .ra-cmp-foot { display: flex; justify-content: flex-end; gap: 8px; }
#ra-cmp-pane #ra-cmp-done { background: #2563eb; color: #fff; font-weight: 600; }
/* Launch screen: the panel run's reserve Diff inside NavBlue's Min cells (run list) */
.ra-ld-tag {
    position: absolute; right: 22px; top: 0; height: 24px; line-height: 24px; z-index: 1;
    pointer-events: none; white-space: nowrap; font: 12px system-ui, sans-serif; color: #555;
}
.ra-ld-tag b { display: inline-block; min-width: 26px; text-align: right; font-weight: 700; }
.ra-ld-tag.ra-ld-pos b { color: #15803d; }
.ra-ld-tag.ra-ld-mid b { color: #555; }
.ra-ld-tag.ra-ld-neg b { color: #b91c1c; }
.ra-ld-tag.ra-ld-ot b { color: #222; }
/* Max Stack Height boxes are ~1250px wide: start the text in the middle, left aligned */
.ra-ld-tag.ra-ld-stack { left: 50%; right: auto; }
.ra-ld-tag.ra-ld-stack b { min-width: 0; text-align: left; }
.ra-ld-tag .ra-ld-sub { margin-left: 8px; color: #888; font-size: 11px; }
.ra-ld-cap { margin-left: 12px; font: 600 11px system-ui, sans-serif; color: #2563eb; }
.ra-ld-cap.ra-ld-other { color: #b45309; }
/* Paste Targets: a button on NavBlue's Short Call Types box and its pop-up (run list) */
#ra-pt-btn {
    position: fixed; z-index: 2147483641; padding: 9px 18px; border: 0; border-radius: 8px; cursor: pointer;
    background: #2563eb; color: #fff; font: 600 15px/1.3 system-ui, sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.35);
}
#ra-pt-pop {
    position: fixed; z-index: 2147483642; width: 460px; max-width: calc(100vw - 8px); box-sizing: border-box;
    background: #1d1d1d; color: #eee; border: 1px solid #333; border-radius: 8px; padding: 10px 12px;
    font: 12px/1.35 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.45);
}
#ra-pt-pop .pt-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 13px; }
#ra-pt-pop button { border: 0; border-radius: 5px; cursor: pointer; background: #334155; color: #cbd5e1; font-size: 12px; padding: 5px 10px; }
#ra-pt-pop button:disabled { opacity: .4; cursor: default; }
#ra-pt-pop .pt-x { padding: 2px 7px; }
#ra-pt-pop .pt-fill { background: #2563eb; color: #fff; font-weight: 600; }
#ra-pt-pop select { margin-left: 6px; max-width: 360px; font-size: 12px; }
#ra-pt-pop textarea { width: 100%; box-sizing: border-box; margin-top: 8px; font: 12px ui-monospace, Menlo, monospace; background: #111; color: #eee; border: 1px solid #444; }
#ra-pt-pop .pt-msgs { margin: 8px 0 0; padding-left: 18px; color: #fbbf24; }
#ra-pt-pop .pt-summary { margin: 8px 0 4px; color: #94a3b8; }
#ra-pt-pop .pt-grid { max-height: 320px; overflow: auto; border: 1px solid #333; }
#ra-pt-pop table { width: 100%; border-collapse: collapse; font: 12px ui-monospace, Menlo, monospace; }
#ra-pt-pop th { position: sticky; top: 0; background: #262626; color: #cbd5e1; text-align: left; padding: 3px 8px; }
#ra-pt-pop td { padding: 2px 8px; border-top: 1px solid #2a2a2a; white-space: nowrap; }
#ra-pt-pop .pt-date { color: #cbd5e1; }
#ra-pt-pop .pt-change { background: rgba(37, 99, 235, .25); }
#ra-pt-pop .pt-change s { color: #94a3b8; }
#ra-pt-pop .pt-change b { color: #93c5fd; }
#ra-pt-pop .pt-same { color: #6b7280; }
#ra-pt-pop .pt-nodata { color: #6b7280; font-style: italic; }
#ra-pt-pop .pt-off { color: #555; }
#ra-pt-pop tr.pt-miss .pt-date { color: #fbbf24; }
#ra-pt-pop .pt-foot { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
`;
    document.head.appendChild(style);

    // --------------- Panel Controls -------------------
    function showPanel() {
        raPanel.classList.add("visible");
    }

    function hidePanel() {
        raPanel.classList.remove("visible");
    }

    function closeAllModals() {
        // Close the Compare modal
        const m2 = document.getElementById("ra-compare-backdrop");
        if (m2) m2.classList.remove("visible");

         // Close the Validate modal
		const m3 = document.getElementById("ra-modal-validate-backdrop");
		if (m3) m3.classList.remove("visible");

         // Close the Change Log modal
		const m4 = document.getElementById("ra-changelog-backdrop");
		if (m4) m4.classList.remove("visible");
    }

    function setPanelStatus(color) {
        const el = document.getElementById("ra-header-status");
        el.classList.remove("blue", "green", "red");
        el.classList.add(color);
    }

    // ---------------- Update Report Object Logic ----------------
    function applyUpdate(existing, scraped) {
        if (scraped.type) existing.type = scraped.type;
        if (scraped.period) existing.period = scraped.period;
        if (scraped.category) existing.category = scraped.category;

        // Scheduler inputs (Options section) for the input-compare tool
        if (scraped.inputs) existing.inputs = scraped.inputs;

        // update stats
        if (scraped.stats) {
            for (const key in scraped.stats) {
                const val = scraped.stats[key];

                if (val === null || val === undefined) continue;

                // nested structures
                if (typeof val === "object" && !Array.isArray(val)) {
                    existing.stats[key] = {
                        ...existing.stats[key],
                        ...val
                    };
                } else {
                    existing.stats[key] = val;
                }
            }
        }

        // reserveGrid omitted for now
        existing.lastUpdated = Date.now();
    }

    // ---------------- Detect Report Type ----------------
    function detectReportType(txt) {
        if (PATTERNS.RUN_DETAIL_w_NAME.test(txt)) return REPORT_TYPES.RUN_DETAIL;
        if (PATTERNS.DYNAMIC_STATS_w_NAME.test(txt)) return REPORT_TYPES.DYNAMIC_STATS;
        if (PATTERNS.UNSTACKING_REPORT_w_NAME.test(txt)) return REPORT_TYPES.UNSTACKING;
        return REPORT_TYPES.UNKNOWN;
    }

    // ---------------- Parsers ----------------
    function matchMinutes(txt, pattern) {
        const m = txt.match(pattern);
        return m ? toMinutes(`${m[1]}:${m[2]}`) : null;
    }

    // Bidders with No Line — Stats and Dynamic Stats both print it in the same form and
    // write the same fields, so whichever ran last wins (like reserveLinesUnstackedPercent).
    // Left untouched when the line is missing, so a report without it can't erase a count.
    function parseNoLineBidders(txt, partial) {
        const m = txt.match(PATTERNS.NO_LINE_BIDDERS);
        if (!m) return;
        partial.stats.noLineBidders = parseInt(m[1], 10);
        partial.stats.noLineEmployees = m[2] ? (m[2].match(/\d+/g) || []) : [];
    }

    // Pertinent Scheduler inputs under the Stats/Run Detail "Options" section, in
    // report order. Each entry lists the exact keys to capture for that group — an
    // allowlist rather than "grab every Key = Value", because real reports carry a
    // large amount of extra config (buffer/rest/bid rules) after ShortCall_RE that
    // would otherwise be swallowed by the trailing segment. Grid-only groups
    // (ReserveStackHeight, ReserveCallTypeCoverage, MaxUdosPerDay) have no keys.
    const INPUT_SPEC = [
        { group: "IgnoreBids", keys: ["IgnoreNonSysGenBids"] },
        { group: "ExtraCombinationsForAwardBids", keys: ["Use"] },
        { group: "FillToThreshold", keys: ["Use"] },
        { group: "FollowedBy", keys: ["Time"] },
        { group: "Iterations", keys: ["Max", "MaxSLG"] },
        { group: "MaxCreditsHonoured", keys: ["Max"] },
        { group: "MaxSkedCredit", keys: ["High", "Low", "Threshold"] },
        { group: "MaxUdosPerDay", keys: [] },
        { group: "MinCreditsHonoured", keys: ["Max"] },
        { group: "MinSkedCredit", keys: ["High", "Low", "Threshold"] },
        { group: "NormalSkedCredit", keys: ["High", "Low", "Threshold"] },
        { group: "PairingLines", keys: ["Max"] },
        { group: "ReducedLowerLimitCredit", keys: ["High", "Low", "Threshold"] },
        { group: "ReducedLowerLimitLines", keys: ["Cutoff", "Max"] },
        { group: "ReducedMaxSkedCredit", keys: ["High", "Low", "Threshold"] },
        { group: "ReducedMinSkedCredit", keys: ["High", "Low", "Threshold"] },
        { group: "ReducedNormalCredit", keys: ["High", "Low", "Threshold"] },
        { group: "Reserves", keys: ["Max"] },
        { group: "Unstacking", keys: [
            "MaxPasses", "PriorityStackDate", "SLGForcePriorityStackDate",
            "SecondaryPriorityStackDate", "StackType", "TripAllocationMode",
            "TripUnstackingMethod", "Use", "UseEquipmentUnstacking",
            "UseLocationGroupUnstacking", "UseLocationUnstacking", "UsePWI",
            "UsePositionUnstacking", "UsePriorityStackDate", "UseSecondaryPriorityStackDate",
        ] },
        { group: "LongCall_14LC", keys: ["MaxBidders", "Use"] },
        { group: "ReducedReserveLines", keys: ["Max"] },
        { group: "ReserveStackHeight", keys: [] },
        { group: "Reserve", keys: ["MaxPasses", "Use"] },
        { group: "ReserveCallTypeCoverage", keys: [] },
        { group: "ShortCall_AM", keys: ["Use"] },
        { group: "ShortCall_PM", keys: ["Use"] },
        { group: "ShortCall_RE", keys: ["Use"] },
    ];

    // Ordered group headers, used to slice the (newline-flattened) text into per-group
    // segments by finding each header in turn.
    const INPUT_GROUPS = INPUT_SPEC.map(s => s.group);

    // Slice the flattened Options text into { group: segmentText } by locating each
    // known header in report order. Because getReportText() collapses newlines, the
    // whole Options block is one line and headers must be found by walking forward.
    function findInputSegments(text) {
        const found = [];
        let searchFrom = 0;
        for (const g of INPUT_GROUPS) {
            // "Reserve" also appears inside the ReserveStackHeight grid header (as a
            // "Reserve" super-header and a "Reserve Type" column label). Require a
            // nearby "=" so the anchor lands on the real group (first key
            // "MaxPasses =" is right after) rather than the grid header.
            const guard = g === "Reserve" ? "(?=[^=]{0,30}=)" : "";
            const re = new RegExp("\\b" + g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b" + guard);
            const rel = text.slice(searchFrom).search(re);
            if (rel === -1) continue;
            const start = searchFrom + rel;
            found.push({ group: g, start });
            searchFrom = start + g.length;
        }
        const segments = {};
        for (let i = 0; i < found.length; i++) {
            const from = found[i].start + found[i].group.length;
            const to = i + 1 < found.length ? found[i + 1].start : text.length;
            segments[found[i].group] = text.slice(from, to);
        }
        return segments;
    }

    // Parse the "Options" section into structured inputs for the input-compare tool.
    // Returns { scalars: [{key,value}], unstackGrid: [{date,max}], rshGrid: [{date,min}] }.
    function parseInputs(txt) {
        const segments = findInputSegments(txt);
        const scalars = [];

        for (const { group, keys } of INPUT_SPEC) {
            const seg = segments[group];
            if (!seg || !keys.length) continue;
            // Stop before any embedded grid header so grid rows aren't read as pairs.
            const gridCut = seg.search(/Date\s+(Max|Type)\b/i);
            const scalarPart = gridCut === -1 ? seg : seg.slice(0, gridCut);
            for (const key of keys) {
                // First value for this exact key within the group segment. Word
                // boundaries keep e.g. "Use" from matching inside "UsePWI".
                const re = new RegExp("\\b" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b\\s*=\\s*(\\S+)");
                const m = scalarPart.match(re);
                if (m) scalars.push({ key: `${group}.${key}`, value: m[1] });
            }
        }

        // Unstacking per-day grid: Date + Max. Split on the "Date Max ----" header so
        // PriorityStackDate values aren't mistaken for grid rows.
        const unstackTail = (segments["Unstacking"] || "").split(/Date\s+Max\s+-+/i)[1] || "";
        const unstackGrid = [];
        let um;
        const ure = /(\d{8})\s+(\d{1,4})/g;
        while ((um = ure.exec(unstackTail)) !== null) {
            unstackGrid.push({ date: um[1], max: um[2] });
        }

        // ReserveStackHeight per-day grid: Date (col 1) + Min coverage (col 3).
        const rshSeg = segments["ReserveStackHeight"] || "";
        const rshGrid = [];
        let rm;
        const rre = /(\d{8})\s+RES\s+(\d{1,4})\s+\d{1,4}/g;
        while ((rm = rre.exec(rshSeg)) !== null) {
            rshGrid.push({ date: rm[1], min: rm[2] });
        }

        return { scalars, unstackGrid, rshGrid };
    }

    function parseRunDetail(txt) {
        const partial = {
            type: REPORT_TYPES.RUN_DETAIL,
            name: null,
            stats: {
                windows: {
                    normal: {
                        low: null,
                        high: null
                    },
                    min: {
                        low: null,
                        high: null,
                        threshold: null
                    },
                    max: {
                        low: null,
                        high: null
                    },
                    rll: {
                        low: null,
                        threshold: null
                    }
                }
            }
        };

        // name
        const name = txt.match(PATTERNS.RUN_DETAIL_w_NAME);
        if (name) partial.name = name[2].trim();

        // period / category
        const period = txt.match(PATTERNS.PERIOD);
        if (period) partial.period = period[1].trim();
        const cat = txt.match(PATTERNS.CATEGORY);
        if (cat) partial.category = cat[1].toUpperCase();

        // ALV
        partial.stats.alv = matchMinutes(txt, PATTERNS.AVG_LINE_VALUE);

        parseNoLineBidders(txt, partial);

        // Scheduler inputs (Options section) for the input-compare tool
        partial.inputs = parseInputs(txt);

        // Reserves
        const tr = txt.match(PATTERNS.TOTAL_RESERVES);
        if (tr) partial.stats.totalReserves = parseInt(tr[1], 10);

        // Reserve Days
        const trd = txt.match(PATTERNS.TOTAL_RESERVE_DAYS);
        if (trd) partial.stats.totalReserveDays = parseInt(trd[1], 10);

        // Lines
        const ts = txt.match(PATTERNS.TOTAL_SCHEDULES);
        if (ts) partial.stats.totalAwardedSchedules = parseInt(ts[1], 10);

        // Trip Credits
        partial.stats.tripCredit = matchMinutes(txt, PATTERNS.TRIP_CREDIT);

        // OT Credit
        partial.stats.openTimeCredit = matchMinutes(txt, PATTERNS.OPEN_TIME_CREDIT);

        // OT Percent
        if (partial.stats.tripCredit && partial.stats.openTimeCredit) {
            const otPct = partial.stats.openTimeCredit / partial.stats.tripCredit;
            partial.stats.openTimePercent = parseFloat((otPct * 100).toFixed(2));
        }

        // Min/Max Credits Allowed
        const minAllow = txt.match(PATTERNS.MIN_CREDITS_ALLOWED);
        if (minAllow) {
            partial.stats.minCredits = {
                ...partial.stats.minCredits,
                allowed: parseInt(minAllow[1], 10)
            };
        }

        const maxAllow = txt.match(PATTERNS.MAX_CREDITS_ALLOWED);
        if (maxAllow) {
            partial.stats.maxCredits = {
                ...partial.stats.maxCredits,
                allowed: parseInt(maxAllow[1], 10)
            };
        }

        // Reserve Grid
        const reserveRows = txt.match(PATTERNS.RESERVE_GRID) || [];
        partial.stats.reserveGrid = {};

        for (const row of reserveRows) {
            const parsed = parseReserveRow(row);
            partial.stats.reserveGrid[parsed.date] = parsed;
        }

        // ---- MAX 14LC BIDDERS ----
        const max14 = txt.match(PATTERNS.MAX_14LC);
        if (max14) {
            partial.stats.max14LC = parseInt(max14[1], 10);
            partial.stats.lcColor = max14[2] === "1";
        }

        // Reserve Coloring Used?
        const amUse = txt.match(PATTERNS.AM_COLOR);
        if (amUse) partial.stats.amColor = amUse[1] === "1";

        const pmUse = txt.match(PATTERNS.PM_COLOR);
        if (pmUse) partial.stats.pmColor = pmUse[1] === "1";

        const reUse = txt.match(PATTERNS.RE_COLOR);
        if (reUse) partial.stats.reColor = reUse[1] === "1";

        // ---- FOLLOWED BY TIME ----
        partial.stats.followedBy = matchMinutes(txt, PATTERNS.FOLLOWED_BY);

        // ---- HEADCOUNTS: TOTAL CREW / INELIGIBLE / ELIGIBLE ----
        const totalCrew = txt.match(PATTERNS.TOTAL_CREW);
        if (totalCrew) {
            partial.stats.totalCrew = parseInt(totalCrew[1], 10);
        }

        const inel = txt.match(PATTERNS.INELIGIBLE);
        if (inel) {
            partial.stats.ineligibleBidders = parseInt(inel[1], 10);
        }

        if (totalCrew && inel) {
            const crew = parseInt(totalCrew[1], 10);
            const ineligible = parseInt(inel[1], 10);
            partial.stats.eligibleBidders = crew - ineligible;
        }

        // ---- PRIORITY STACK DATE / FORCE PSD ----
        const psd = txt.match(PATTERNS.PRIORITY_STACK_DATE);
        if (psd) {
  const clean = psd[1].replace(/-/g, ""); // YYYYMMDD
  partial.stats.priorityStackDate = formatDate(clean);
}


        const forcePsd = txt.match(PATTERNS.FORCE_PSD);
        if (forcePsd) {
            partial.stats.forcePsdSlg = forcePsd[1] === "1";
        }
        
        // ---- PSD USE TOGGLES (critical) ----
const usePsd = txt.match(PATTERNS.USE_PRIORITY_STACK_DATE);
if (usePsd) partial.stats.usePriorityStackDate = usePsd[1] === "1";

const useSecPsd = txt.match(PATTERNS.USE_SECONDARY_PRIORITY_STACK_DATE);
if (useSecPsd) partial.stats.useSecondaryPriorityStackDate = useSecPsd[1] === "1";

const secPsd = txt.match(PATTERNS.SECONDARY_PRIORITY_STACK_DATE);
if (secPsd) {
  const raw = secPsd[1]; // YYYYMMDD
  partial.stats.secondaryPriorityStackDate = formatDate(raw);
}
        
        // Pairing Unstacking Used
		const pUnstk = txt.match(PATTERNS.USE_UNSTACKING);
		if (pUnstk){
			partial.stats.useUnstacking = parseInt(pUnstk[1]);
		}

        // CREDIT windows
        partial.stats.windows.normal.low    = matchMinutes(txt, PATTERNS.NORM_WINDOW_LOW);
        partial.stats.windows.normal.high   = matchMinutes(txt, PATTERNS.NORM_WINDOW_HIGH);
        partial.stats.windows.min.low       = matchMinutes(txt, PATTERNS.MIN_CW_LOW);
        partial.stats.windows.min.high      = matchMinutes(txt, PATTERNS.MIN_CW_HIGH);
        partial.stats.windows.min.threshold = matchMinutes(txt, PATTERNS.MIN_CW_THRESH);
        partial.stats.windows.max.low       = matchMinutes(txt, PATTERNS.MAX_CW_LOW);
        partial.stats.windows.max.high      = matchMinutes(txt, PATTERNS.MAX_CW_HIGH);
        partial.stats.windows.rll.low       = matchMinutes(txt, PATTERNS.RLL_CW_LOW);
        partial.stats.windows.rll.threshold = matchMinutes(txt, PATTERNS.RLL_CW_THRESH);

        // ---- REDUCED LOWER LIMIT (RLL) LINES ----
        // The Stats report lists the employees who bid RLL in a small table:
        //
        //   Reduced Lower Limit Employees
        //       Employee Id      Seniority
        //       --------------------------
        //           10003        1234
        //       --------------------------
        //
        // getReportText() flattens newlines to spaces, so this arrives as one run of text:
        // take what sits between the two rules and count the id/seniority pairs. RLL is rare
        // and the whole section is absent when nobody bid it — that is 0 lines, not unknown,
        // and a Stats report is the only thing that can tell us either way.
        const rllBlock = txt.match(PATTERNS.RLL_EMPLOYEE_BLOCK);
        partial.stats.rllLines = rllBlock
            ? (rllBlock[1].match(/\d{3,8}\s+\d{1,6}/g) || []).length
            : 0;

        return partial;
    }

    // ------- SCRAPE DYNAMIC STATS
    function parseDynamicStats(txt) {
        const partial = {
            type: REPORT_TYPES.DYNAMIC_STATS,
            name: null,
            stats: {
                reserveGrid: {}
            }
        };

        // ---- NAME ----
        const nameMatch = txt.match(PATTERNS.DYNAMIC_STATS_w_NAME);
        if (nameMatch) {
            partial.name = nameMatch[2].trim();
        }

        // ALV
        partial.stats.alv = matchMinutes(txt, PATTERNS.AVG_LINE_VALUE);

        parseNoLineBidders(txt, partial);

        // period / category
        const period = txt.match(PATTERNS.PERIOD);
        if (period) partial.period = period[1].trim();
        const cat = txt.match(PATTERNS.CATEGORY);
        if (cat) partial.category = cat[1].toUpperCase();

        // ---- HONORED MIN / MAX CREDITS ----
        const minHon = txt.match(PATTERNS.MIN_CREDITS_HONORED);
        if (minHon) {
            partial.stats.minCredits = {
                ...(partial.stats.minCredits || {}),
                honored: parseInt(minHon[1], 10)
            };
        }

        const maxHon = txt.match(PATTERNS.MAX_CREDITS_HONORED);
        if (maxHon) {
            partial.stats.maxCredits = {
                ...(partial.stats.maxCredits || {}),
                honored: parseInt(maxHon[1], 10)
            };
        }
       
        // ---- PAIRING LINES UNSTACKED % ----
        const pctUnstack = txt.match(PATTERNS.PCT_PAIRINGS_UNSTACKED);
        if (pctUnstack) {
            partial.stats.pairingsUnstackedPercent = parseFloat(pctUnstack[1]);
        }

        // ---- RESERVE LINES UNSTACKED % ----
        const pctReserveUnstack = txt.match(PATTERNS.PCT_RESERVE_LINES_UNSTACKED);
        if (pctReserveUnstack) {
            partial.stats.reserveLinesUnstackedPercent = parseFloat(pctReserveUnstack[1]);
        }

        // ---- PAIRING LINES WITH SLG ----
        const slgCount = txt.match(PATTERNS.PAIRING_LINES_WITH_SLG);
        if (slgCount) {
            partial.stats.pairingLinesWithSLG = parseInt(slgCount[1], 10);
        }
        const slgPct = txt.match(PATTERNS.PCT_PAIRING_LINES_WITH_SLG);
        if (slgPct) {
            partial.stats.pairingLinesWithSLGPercent = parseFloat(slgPct[1]);
        }

        // ---- OPEN TIME PERCENT ----
        const otPct = txt.match(PATTERNS.OPEN_TIME_PERCENT);

        if (otPct) {
            partial.stats.openTimePercent = parseFloat(otPct[1]);
        }
        
		// ---- PAIRING LINES ----
		const pairingLines = txt.match(PATTERNS.PAIRING_LINES);
		if (pairingLines) {
			partial.stats.pairingLines = parseInt(pairingLines[1], 10);
		}

        // ---- BLOCKED IOE TRIPS ----
        const bioe = txt.match(PATTERNS.BLOCKED_IOE);
        if (bioe) {
            partial.stats.blockedIOETrips = parseInt(bioe[1], 10);
        }
        
        // ---- RESERVE LINES (= Total Reserves in Dynamic Stats) ----
        const reserveLines = txt.match(PATTERNS.RESERVE_LINES);
        if (reserveLines) {
            partial.stats.totalReserves = parseInt(reserveLines[1], 10);
        }

        // ---- 14LC ALLOWED BIDDERS ----
        // Dynamic Stats reports lack the Stats "MaxBidders" line. The "14LC Reserve
        // Lines:" line only appears when 14LC was used, so its presence means it's on.
        const dyn14 = txt.match(PATTERNS.MAX_14LC_DYNAMIC);
        if (dyn14) {
            partial.stats.max14LC = parseInt(dyn14[1], 10);
            partial.stats.lcColor = true;
        }

        // ---- RESERVE DAYS ON AWARDED ----
        const reserveDays = txt.match(PATTERNS.TOTAL_RESERVE_DAYS);
        if (reserveDays) {
            partial.stats.totalReserveDays = parseInt(reserveDays[1], 10);
        }

		// Reserve Grid and optional coloring
        const reserveRows = txt.match(PATTERNS.RESERVE_GRID) || [];

        reserveRows.forEach(row => {
            const parsed = parseReserveRow(row); // we will define parseReserveRow below
            const date = parsed.date;

            // Create if missing
            if (!partial.stats.reserveGrid[date]) {
                partial.stats.reserveGrid[date] = {};
            }

            // Update ONLY the numeric grid values
            partial.stats.reserveGrid[date].minCoverage = parsed.minCoverage;
            partial.stats.reserveGrid[date].actualCoverage = parsed.actualCoverage;
            partial.stats.reserveGrid[date].openTrips = parsed.openTrips;
            partial.stats.reserveGrid[date].netCoverage = parsed.netCoverage;
        });

        parseDynamicStatsColoring(txt, partial)

        return partial;
    }

    function parseUnstacking(txt) {
            const partial = {
            type: REPORT_TYPES.UNSTACKING,
            name: null,
            stats: {
                reserveGrid: {}
            }
        };

        // ---- NAME ----
        const nameMatch = txt.match(PATTERNS.UNSTACKING_REPORT_w_NAME);
        if (nameMatch) {
            partial.name = nameMatch[2].trim();
        }

        // period / category
        const period = txt.match(PATTERNS.PERIOD);
        if (period) partial.period = period[1].trim();
        const cat = txt.match(PATTERNS.CATEGORY);
        if (cat) partial.category = cat[1].toUpperCase();

        // ---- UNSTACKING ON / OFF ----
        // Booleans, so a later Unstacking report flips them either way; absent lines leave them unset.
        const pairingOn = txt.match(PATTERNS.PAIRING_UNSTACK_ENABLED);
        if (pairingOn) partial.stats.pairingUnstackEnabled = !/^NOT/i.test(pairingOn[1]);
        const reserveOn = txt.match(PATTERNS.RESERVE_UNSTACK_ENABLED);
        if (reserveOn) partial.stats.reserveUnstackEnabled = !/^NOT/i.test(reserveOn[1]);

        // ---- PAIRING LINES UNSTACKED % ----
        const pctUnstack = txt.match(PATTERNS.PCT_PAIRINGS_UNSTACKED);
        if (pctUnstack) {
            partial.stats.pairingsUnstackedPercent = parseFloat(pctUnstack[1]);
        }

        // ---- RESERVE LINES UNSTACKED % ----
        const pctReserveUnstack = txt.match(PATTERNS.PCT_RESERVE_LINES_UNSTACKED);
        if (pctReserveUnstack) {
            partial.stats.reserveLinesUnstackedPercent = parseFloat(pctReserveUnstack[1]);
        }

        // ---- SLG STATS ----
        const slgLines = txt.match(PATTERNS.SLG_LINES);
        if (slgLines) {
            partial.stats.slgLines = parseInt(slgLines[1], 10);
        }

        const slgAbove = txt.match(PATTERNS.SLG_ABOVE_TEN_PERCENT);
        if (slgAbove) {
            partial.stats.slgAboveTenPercent = parseInt(slgAbove[1], 10);
        }

        // ---- OFFICIAL (CONTRACTUAL) NUMBERS ----
        const highestUnstack = txt.match(PATTERNS.HIGHEST_PCT_PAIRINGS_UNSTACKED);
        if (highestUnstack) {
            // Like the SLG line below, "(None)" is printed when no pairing line was unstacked
            partial.stats.highestPairingsUnstackedPercent = highestUnstack[1] != null ? parseFloat(highestUnstack[1]) : 0;
        }

        const highestSLG = txt.match(PATTERNS.HIGHEST_PCT_PAIRING_LINES_SLG);
        if (highestSLG) {
            // The report prints "(None)" rather than 0% when no line was assigned SLG
            partial.stats.highestPairingLinesSLGPercent = highestSLG[1] != null ? parseFloat(highestSLG[1]) : 0;
        }

        return partial;
    }

    // ---------------- Core Dispatcher ----------------
    function parseReport(reportText, type) {
        switch (type) {
            case REPORT_TYPES.RUN_DETAIL:
                return parseRunDetail(reportText);
            case REPORT_TYPES.DYNAMIC_STATS:
                return parseDynamicStats(reportText);
            case REPORT_TYPES.UNSTACKING:
                return parseUnstacking(reportText);
            default:
                return null;
        }
    }

    // ---------------- Reading report text (both pages) ----------------
    // One path from report text to parsed reports, used by Load & Run on a report page and by
    // Download/Analyze Run on the run list, so the two can't drift apart. The text may hold one
    // report (a report page) or several back to back (a download).

    // Every run of whitespace becomes one space. The parsers are written against one long line;
    // collapsing the column padding too means a page and a download produce identical text.
    function flattenReportText(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
    }

    // Where each report starts in the text. The analyzer's *_w_NAME patterns are
    // greedy across a whole report, so they only run on a segment once it has been cut out.
    const REPORT_STARTS = [
        { type: REPORT_TYPES.RUN_DETAIL,    re: /Run\s+Detail\s+Report\b/i },
        { type: REPORT_TYPES.DYNAMIC_STATS, re: /Dynamic\s+Stats\s+Report\b/i },
        { type: REPORT_TYPES.UNSTACKING,    re: /Unstacking\s+Report\b/i },
    ];
    const APPLY_ORDER = [REPORT_TYPES.RUN_DETAIL, REPORT_TYPES.DYNAMIC_STATS, REPORT_TYPES.UNSTACKING];

    // Cut the text at each report's header. Returns { [type]: segment }.
    function splitReports(flat) {
        const starts = [];
        for (const r of REPORT_STARTS) {
            const m = r.re.exec(flat);
            if (m) starts.push({ type: r.type, at: m.index });
        }
        starts.sort((a, b) => a.at - b.at);
        const out = {};
        starts.forEach((st, i) => {
            out[st.type] = flat.slice(st.at, i + 1 < starts.length ? starts[i + 1].at : flat.length).trim();
        });
        return out;
    }

    // Report text -> { partials, missing, names } or { error: "none" | "names", names }.
    // `partials` are in APPLY_ORDER (Stats, Dynamic, Unstacking); all must name the same run.
    function readReportText(text) {
        const flat = flattenReportText(text);
        const segments = splitReports(flat);
        // A single report (every report page) is parsed whole, as Load & Run always did, so
        // nothing printed above its header is lost. Only several reports need cutting apart.
        const types = Object.keys(segments);
        if (types.length === 1) segments[types[0]] = flat;
        const partials = [];
        const missing = [];
        for (const type of APPLY_ORDER) {
            const seg = segments[type];
            if (!seg || detectReportType(seg) !== type) { missing.push(type); continue; }
            const partial = parseReport(seg, type);
            if (!partial || !partial.name) { missing.push(type); continue; }
            partials.push(partial);
        }
        if (!partials.length) return { error: "none" };
        const names = [...new Set(partials.map(p => p.name))];
        if (names.length > 1) return { error: "names", names };
        return { partials, missing, names };
    }

    // Parsed reports onto a fresh report object. Nothing is saved between runs any more, so a run
    // is exactly its own reports. Partials are cloned: a download's cached partials must never
    // share nested objects with the panel.
    function buildReport(name, partials) {
        let full = defaultReport(name);
        for (const p of partials) applyUpdate(full, structuredClone(p));
        return normalizeReport(full);
    }

    // ---------------- Main Load Functions ----------------
    // Parses the KPI fields on screen into a KPI object (on top of `base`), or toasts and
    // returns null. Saving it is the caller's job.
    function buildKPIFromFields(base) {
        let kpi = { ...(base || {}) };

        expandKPIGridYears(); // in case Load & Run is clicked before the textarea blurs
        const gridText = document.querySelector("#kpi-grid").value.trim();
        const alvText = document.querySelector("#kpi-alv").value.trim();
        const tripsText = document.querySelector("#kpi-trips").value.trim();

        const missingGrid = gridText === "";
        const missingALV = !/^(\d{1,3}):([0-5]\d)$/.test(alvText);

        if (missingGrid || missingALV) {
            showToast("Missing KPI and/or\nALV in HH:MM", "error");
            return null; // stop report run
        }

const parsed = parseKPIGrid(gridText);

if (parsed.errors.length) {
  showToast(parsed.errors[0], "error"); // or show all in a modal
  console.warn("KPI parse errors:", parsed.errors);
  return null;
}

// Persist KPI meta so validations can use the inferred bid month/year
kpi.meta = {
  bidMonth: parsed?.meta?.bidMonth ?? null,
  bidYear: parsed?.meta?.bidYear ?? null,
  expectedDays: parsed?.meta?.expectedDays ?? null,
};

kpi.grid = parsed.grid;

        kpi.gridText = gridText;
        kpi.alvTarget = parseKPIALV(alvText);


        if (tripsText == "") {
            delete kpi.totalTrips;
        } else {
            kpi.totalTrips = Number(tripsText) || null;
        }

        kpi.defaultCompareMode = readDefaultGrossField();
        return kpi;
    }

    // The KPI a run of `category` uses. A locked category always uses its saved KPI — the
    // fields never overwrite it. Otherwise the fields on an editable tab (the draft, or an
    // unparsed stub) are parsed, saved under the category, and that tab locks.
    function resolveKPIForRun(category) {
        const saved = loadKPI(category);
        const activeLocked = isKPILocked(loadKPI(activeKPICategory));

        if (isKPILocked(saved)) {
            if (category !== activeKPICategory) {
                // Values typed into an editable tab would be silently ignored — stop instead
                if (!activeLocked && kpiFieldsHaveData()) {
                    showToast(`${category} already has locked KPIs.\nClose its tab first to enter new ones.`, "error");
                    return null;
                }
                const leavingEmptyDraft = activeKPICategory == null;
                switchKPITab(category);
                if (leavingEmptyDraft) { closeKPIDraft(); renderKPITabs(); }
            }
            return saved;
        }

        // A locked tab's values belong to that category — don't copy them into another one
        if (activeLocked) {
            openKPIDraft();
            showToast(`No KPIs for ${category} yet.\nFill in the new tab, then ${IS_RUN_LIST ? "Analyze Run" : "Analyze"} again.`, "error");
            return null;
        }

        const kpi = buildKPIFromFields(saved);
        if (!kpi) return null;

        saveKPI(category, kpi);
        const fromDraft = activeKPICategory == null;
        switchKPITab(category);
        if (fromDraft) { closeKPIDraft(); renderKPITabs(); }
        showToast(`KPIs locked for ${category}`, "success");
        return kpi;
    }

    // The report on screen, read with the same reader as the run list's downloads
    // (readReportText), or toasts and returns null. Nothing is persisted here.
    function readScreenReport() {
        const reportText = getReportText();
        if (!reportText) { showToast("No report text detected.", "error"); return null; }

        const read = readReportText(reportText);
        if (read.error === "none") {
            showToast(detectReportType(reportText) === REPORT_TYPES.UNKNOWN
                ? "Report type not recognized." : "Could not read report name.", "error");
            return null;
        }
        if (read.error === "names") {
            showToast(`This page names different runs:\n${read.names.join(", ")}`, "error");
            return null;
        }
        return read;
    }

    // ---------------- Button Events ----------------
    // Shows a parsed run: KPIs resolved (or the KPI box opened), panel rendered. Shared by
    // Load & Run (report page) and Download/Analyze Run (run list).
    function finishRun(updated) {
        // Report types that don't print a category fall back to the saved report's, then the tab
        const category = updated.category || activeKPICategory;
        if (!category) {
            showToast("Could not read the category from this report.", "error");
            return false;
        }

        const kpi = resolveKPIForRun(category);
        if (!kpi) { setPane("kpi"); return false; }

        console.log("Updated Report:", updated);
        workingReport = updated;
        currentKPI = kpi;
        reserveCompareMode = defaultCompareModeFor(kpi); // each run starts on its category's default
        renderPanel(updated, kpi || {});
        return true;
    }

    // ---------------- Pull & Analyze ----------------
    const PULL_TIMEOUT_MS = 90000;
    const PULL_REPORTS = [
        { type: "Statistics",        options: "<Options></Options>" },
        { type: "DynamicStatistics", options: "<Options></Options>" },
        { type: "Unstacking",        options: "<Options><Reporting></Reporting></Options>" },
    ];
    let pullInFlight = null;   // { controller, timer, ticker, started }
    // "PeriodId:RunId" -> { name, ts, missing, partials, textGz, text? }. Saved under
    // PULLS_KEY, separate from saved reports: a download is not a Save, and it must not appear
    // in Manage Reports or Compare until the user saves it. The parsed partials are re-applied
    // onto the SAVED report on every Analyze, so a Save made in between is not lost.
    // `text` (plain) is memory only; storage holds it gzipped as base64 in `textGz`.
    const PULLS_MAX = 40; // newest kept
    const runKey = (run) => `${run.PeriodId}:${run.RunId}`;
    const pulledRuns = (() => {
        try { return JSON.parse(localStorage.getItem(PULLS_KEY) || "{}") || {}; } catch (e) { return {}; }
    })();

    function savePulls() {
        const entries = Object.entries(pulledRuns).sort((a, b) => b[1].ts - a[1].ts);
        const write = (list) => {
            const out = {};
            for (const [k, v] of list) out[k] = { name: v.name, ts: v.ts, missing: v.missing, partials: v.partials, textGz: v.textGz ?? null, parser: v.parser ?? null };
            localStorage.setItem(PULLS_KEY, JSON.stringify(out));
        };
        let keep = entries.slice(0, PULLS_MAX);
        for (const [k] of entries.slice(PULLS_MAX)) delete pulledRuns[k];
        try {
            write(keep);
        } catch (e) {
            // Quota: drop the older half and try once more; otherwise keep this session's in memory
            keep = keep.slice(0, Math.max(1, Math.floor(keep.length / 2)));
            try { write(keep); } catch (e2) {
                showToast("Browser storage is full — downloads are kept until the page reloads.", "error");
            }
        }
        updateStorageSize();
    }

    async function gzipBase64(str) {
        if (typeof CompressionStream === "undefined") return null;
        const buf = await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    }

    async function gunzipBase64(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    }

    // Fingerprint of everything that turns report text into numbers. Function.toString() gives the
    // source, so editing any parser or pattern changes it — no version to remember to bump.
    const PARSER_FINGERPRINT = (() => {
        const parts = [
            parseRunDetail, parseDynamicStats, parseUnstacking, parseDynamicStatsColoring, parseReserveRow,
            parseInputs, parseNoLineBidders, matchMinutes, formatDate, toMinutes, detectReportType, parseReport,
            flattenReportText, splitReports, readReportText,
        ].map(String);
        parts.push(JSON.stringify(INPUT_SPEC));
        parts.push(Object.values(PATTERNS).map(String).join("\n"));
        parts.push(REPORT_STARTS.map(r => String(r.re)).join("\n"));
        let h = 0x811c9dc5; // FNV-1a
        for (const ch of parts.join("\u0001")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
        return h.toString(16);
    })();

    function formatAge(ts) {
        const mins = Math.floor((Date.now() - ts) / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins} min ago`;
        const h = Math.floor(mins / 60);
        if (h < 48) return `${h} h ${mins % 60} min ago`;
        return new Date(ts).toLocaleString();
    }

    function buildPullNws(run) {
        // Values came out of NavBlue's own XML, so they are already escaped — insert as-is.
        const reports = PULL_REPORTS.map(r => `<Report><ReportType>${r.type}</ReportType>${r.options}</Report>`).join("");
        return `<Call><Function>getRunReport</Function><Attributes>`
            + `<ALC>${run.ALC}</ALC><LogPersonId>${run.LogPersonId ?? ""}</LogPersonId>`
            + `<LogUserType>${run.LogUserType ?? ""}</LogUserType><PeriodId>${run.PeriodId}</PeriodId>`
            + `<RunIdList><RunId>${run.RunId}</RunId></RunIdList><LanguageCode>${run.LanguageCode}</LanguageCode>`
            + `<Reports>${reports}</Reports></Attributes></Call>`;
    }

    function refreshPullButton() {
        const btn = document.getElementById("pull-report");
        if (!btn) return;
        if (pullInFlight) {
            const secs = Math.round((Date.now() - pullInFlight.started) / 1000);
            btn.textContent = `Downloading… ${secs}s (click to cancel)`;
            btn.disabled = false;
            btn.dataset.state = "busy";
            const repull = document.getElementById("repull-report");
            if (repull) repull.style.display = "none";
            return;
        }
        const cached = capturedRun ? pulledRuns[runKey(capturedRun)] : null;
        const repull = document.getElementById("repull-report");
        if (!capturedRun) {
            btn.textContent = "Select a run";
            btn.disabled = true;
            btn.dataset.state = "none";
        } else if (cached) {
            btn.textContent = "Analyze Run";
            btn.disabled = false;
            btn.dataset.state = "ready";
            btn.title = `${cached.name}, downloaded ${formatAge(cached.ts)}.\nOpens the saved download — nothing is requested. ↻ downloads it again.`;
        } else {
            btn.textContent = "Download Run";
            btn.disabled = false;
            btn.dataset.state = "idle";
            btn.title = "Downloads Stats, Dynamic Stats and Unstacking for the selected run, then analyzes it.";
        }
        if (repull) repull.style.display = cached ? "" : "none";
        const view = document.getElementById("view-report-text");
        if (view) view.disabled = !cached;
        const validate = document.getElementById("validate-run");
        if (validate) validate.disabled = !cached;
    }



    function endPull() {
        if (!pullInFlight) return;
        clearTimeout(pullInFlight.timer);
        clearInterval(pullInFlight.ticker);
        pullInFlight = null;
        refreshPullButton();
    }

    const TYPE_LABEL = { [REPORT_TYPES.RUN_DETAIL]: "Stats", [REPORT_TYPES.DYNAMIC_STATS]: "Dynamic", [REPORT_TYPES.UNSTACKING]: "Unstacking" };

    // Rebuild the run from its pulled partials on top of whatever is saved now, then show it.
    function analyzePulled(key, announce) {
        const c = pulledRuns[key];
        if (!c) return false;
        const full = buildReport(c.name, c.partials);
        if (finishRun(full) && announce) {
            const got = c.partials.map(p => TYPE_LABEL[p.type] || p.type).join(" + ");
            showToast(`${c.name}: ${got} loaded (${announce})` + (c.missing.length ? `\nNot in reply: ${c.missing.map(t => TYPE_LABEL[t]).join(", ")}` : ""),
                c.missing.length ? "info" : "success");
        }
        return true;
    }

    // The newest download of the run `report` names, or null. The run list saves downloads in
    // another window, so the store is re-read first (and this page's copy replaced, so a re-read
    // below can't write an old copy back). Run names can repeat across months and seats, so the
    // category and period must agree wherever both the report and the download print them.
    function findDownloadFor(report) {
        let stored = {};
        try { stored = JSON.parse(localStorage.getItem(PULLS_KEY) || "{}") || {}; } catch (e) { stored = {}; }
        for (const k of Object.keys(pulledRuns)) if (!(k in stored)) delete pulledRuns[k];
        for (const [k, v] of Object.entries(stored)) if (!pulledRuns[k] || pulledRuns[k].ts !== v.ts) pulledRuns[k] = v;
        const agrees = (field, c) => {
            const theirs = c.partials.find(p => p[field])?.[field];
            return !report[field] || !theirs || String(theirs) === String(report[field]);
        };
        const hits = Object.entries(pulledRuns)
            .filter(([, c]) => c && c.name === report.name && Array.isArray(c.partials) && c.partials.length
                && agrees("category", c) && agrees("period", c))
            .sort((a, b) => b[1].ts - a[1].ts);
        return hits.length ? hits[0][0] : null;
    }

    // A download read by older parser code is re-read from its stored text, so a parser fix
    // reaches downloads made before it. Without stored text the old numbers are used as they are.
    async function reparseIfStale(key) {
        const c = pulledRuns[key];
        if (!c || c.parser === PARSER_FINGERPRINT) return;
        let text = c.text;
        if (!text && c.textGz) {
            try { text = await gunzipBase64(c.textGz); } catch (e) { text = null; }
        }
        if (!text) { console.info("[PBS Analyzer] stale download, but no stored text to re-read:", c.name); return; }
        const parsed = readReportText(text);
        if (parsed.error || parsed.names[0] !== c.name) {
            console.warn("[PBS Analyzer] re-reading the stored text failed; keeping the old numbers", parsed);
            return;
        }
        c.partials = parsed.partials;
        c.missing = parsed.missing;
        c.parser = PARSER_FINGERPRINT;
        c.text = text;
        savePulls();
        showToast(`${c.name}: re-read from its stored text\n(the analyzer's parsing has changed since it was downloaded)`, "info");
    }

    // One download: POST getRunReport, read the reply, store it under the run's key. Shared by
    // Download Run and by Compare picking. Throws an Error whose message is ready for a toast;
    // when `signal` aborted it, the caller reads the reason from the signal instead.
    async function downloadRun(run, signal) {
        const started = Date.now();
        let raw;
        try {
            const res = await origFetch(`${location.origin}/cgi-bin-xml/class/class.cgi?getRunReport`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
                body: new URLSearchParams({ nws: buildPullNws(run) }),
                credentials: "same-origin",
                signal,
            });
            raw = await res.text();
            if (!res.ok) throw new Error(`NavBlue answered ${res.status}`);
        } catch (e) {
            if (signal?.aborted) throw e;
            throw new Error(`Pull failed: ${e.message || e}`);
        }
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);

        // ---- unwrap the XML reply ----
        const doc = new DOMParser().parseFromString(raw, "text/xml");
        const rt = doc.getElementsByTagName("ReportText")[0];
        const code = doc.getElementsByTagName("Code")[0]?.textContent?.trim() || "";
        const msg = doc.getElementsByTagName("Message")[0]?.textContent?.trim() || "";
        console.info(`[PBS Analyzer] reply in ${elapsed}s, ${raw.length} chars, Status ${code} ${msg}`);
        let text = rt ? rt.textContent : "";
        // A stray control character makes the whole reply invalid XML; cut ReportText out directly
        if (!text && doc.getElementsByTagName("parsererror").length) {
            const m = raw.match(/<ReportText>([\s\S]*?)<\/ReportText>/);
            if (m) {
                const ta = document.createElement("textarea");
                ta.innerHTML = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => c.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
                text = ta.value; // decodes &lt; &amp; etc.
                console.warn("[PBS Analyzer] reply was not valid XML; read ReportText directly");
            }
        }
        const navblue = code || msg ? `\nNavBlue: ${code} ${msg}` : "";
        if (!text.trim()) throw new Error(`No report text came back.${navblue}`);

        // ---- parse each report; all must be the same run ----
        const parsed = readReportText(text);
        if (parsed.error === "none") throw new Error(`Couldn't read any report in the reply.${navblue}`);
        if (parsed.error === "names") {
            console.warn("[PBS Analyzer] run names disagree:", parsed.names);
            throw new Error(`The reports name different runs:\n${parsed.names.join(", ")}\nNothing was loaded.`);
        }
        const { partials, missing, names } = parsed;

        const key = runKey(run);
        pulledRuns[key] = { name: names[0], partials, text, textGz: null, ts: Date.now(), missing, parser: PARSER_FINGERPRINT };

        // Store it: parsed numbers right away, the text once it is compressed (not awaited)
        savePulls();
        gzipBase64(text).then(gz => {
            if (gz && pulledRuns[key]) { pulledRuns[key].textGz = gz; savePulls(); }
        }).catch(e => console.warn("[PBS Analyzer] couldn't compress the report text", e));

        return { key, elapsed };
    }

    async function pullAndAnalyze(force) {
        if (pullInFlight) {           // second click cancels
            pullInFlight.controller.abort("cancelled");
            return;
        }
        const run = capturedRun;
        if (!run) return showToast("Click a run in the list first.", "error");
        // Out of the way of the panel. finishRun reopens the KPI pane if the run needs KPIs;
        // Compare picks are kept, picking just pauses until Compare is opened again.
        setPane(null);

        // Already pulled this run: reopen it, no request
        if (!force && pulledRuns[runKey(run)]) {
            await reparseIfStale(runKey(run));
            analyzePulled(runKey(run), null);
            return;
        }

        const controller = new AbortController();
        pullInFlight = {
            controller,
            started: Date.now(),
            timer: setTimeout(() => controller.abort("timeout"), PULL_TIMEOUT_MS),
            ticker: setInterval(refreshPullButton, 1000),
        };
        refreshPullButton();

        let got;
        try {
            got = await downloadRun(run, controller.signal);
        } catch (e) {
            const reason = controller.signal.aborted ? controller.signal.reason : null;
            const why = reason === "timeout" ? `No reply after ${PULL_TIMEOUT_MS / 1000}s.`
                : reason ? "Pull cancelled." : (e.message || String(e));
            endPull();
            return showToast(why, reason === "cancelled" ? "info" : "error");
        }
        endPull();
        analyzePulled(got.key, `${got.elapsed}s`);
        refreshPullButton();
        renderComparePane(); // a picked run may have been waiting on this
    }

    // ---------------- Compare picking (run list only) ----------------
    // Compare opens a pane under the toolbar; while it is open, every run selected in the list
    // (the same capture Download Run uses) is added to the picks. A pick that isn't downloaded
    // yet downloads in the background, one at a time. Done needs two or more picks, all
    // downloaded, and opens the comparison window. The picks outlive the pane (memory only),
    // so Compare again can add or remove runs; Clear empties them.
    const cmpItems = [];    // [{ key, run, name }] in pick order -> labels A, B, C…
    const cmpState = {};    // key -> "waiting" | "downloading" | "failed"
    const cmpErrors = {};   // key -> message of the last failed download
    let cmpInFlight = null; // { key, controller }
    let cmpPumping = false;
    let lastRowClick = null; // { name, ts }: the run row clicked last, to name a pick before its download

    const cmpPicking = () => IS_RUN_LIST && openPane === "cmp";
    const cmpName = (item) => pulledRuns[item.key]?.name || item.name || `Run ${item.run.RunId}`;

    function cmpStatus(item) {
        if (pulledRuns[item.key]) return "ready";
        return cmpState[item.key] || "missing"; // missing: dropped from the downloads store since
    }

    function paintCompareButton() {
        const btn = document.getElementById("compare-runs");
        if (!btn) return;
        const n = cmpItems.length;
        btn.textContent = `Compare${n ? ` (${n})` : ""} ${cmpPicking() ? "▴" : "▾"}`;
        btn.classList.toggle("cmp-on", cmpPicking());
    }

    function renderComparePane() {
        if (!IS_RUN_LIST) return;
        paintCompareButton();
        if (!cmpPicking()) return;

        const statusText = {
            ready: '<span class="ra-cmp-st ready">ready</span>',
            waiting: '<span class="ra-cmp-st busy">waiting to download</span>',
            downloading: '<span class="ra-cmp-st busy">downloading…</span>',
        };
        const rows = cmpItems.map((item, i) => {
            const st = cmpStatus(item);
            const status = statusText[st] || `<span class="ra-cmp-st bad" title="${(cmpErrors[item.key] || "Not downloaded").replace(/"/g, "&quot;")}">${st === "failed" ? "download failed" : "not downloaded"}</span>
                <button type="button" class="ra-cmp-retry" data-key="${item.key}">Retry</button>`;
            return `<li><b>${REPORT_LABELS[i]}</b><span class="ra-cmp-name">${cmpName(item)}</span>${status}
                <button type="button" class="ra-cmp-remove" data-key="${item.key}" title="Take this run out">✕</button></li>`;
        }).join("");

        const notReady = cmpItems.filter(i => cmpStatus(i) !== "ready").length;
        const canDone = cmpItems.length >= 2 && !notReady;
        const doneTitle = cmpItems.length < 2 ? "Pick at least two runs"
            : notReady ? `Waiting for ${notReady} run${notReady === 1 ? "" : "s"} to download`
            : "Open the comparison";
        const sel = capturedRun && !cmpItems.some(i => i.key === runKey(capturedRun)) && cmpItems.length < COMPARE_MAX;

        cmpPane.innerHTML = `
  <div class="ra-cmp-head">Click runs in the list to add them to the comparison <span class="ra-cmp-count">${cmpItems.length} / ${COMPARE_MAX}</span></div>
  ${rows ? `<ol class="ra-cmp-list">${rows}</ol>` : '<div class="ra-cmp-empty">No runs picked yet.</div>'}
  <div class="ra-cmp-foot">
    ${sel ? '<button type="button" id="ra-cmp-add-sel" class="ra-strip-btn" title="Add the run that is selected now">+ Selected run</button>' : ""}
    <button type="button" id="ra-cmp-clear" class="ra-strip-btn" ${cmpItems.length ? "" : "disabled"}>Clear</button>
    <button type="button" id="ra-cmp-done" class="ra-strip-btn" ${canDone ? "" : "disabled"} title="${doneTitle}">Compare ${cmpItems.length || ""}</button>
  </div>`;

        // The pane is rebuilt on every render, so its handlers are attached again each time
        cmpPane.querySelectorAll(".ra-cmp-remove").forEach(b => { b.onclick = () => removeComparePick(b.dataset.key); });
        cmpPane.querySelectorAll(".ra-cmp-retry").forEach(b => {
            b.onclick = () => { cmpState[b.dataset.key] = "waiting"; renderComparePane(); pumpCompareDownloads(); };
        });
        const addSel = cmpPane.querySelector("#ra-cmp-add-sel");
        if (addSel) addSel.onclick = () => addComparePick(capturedRun, null);
        cmpPane.querySelector("#ra-cmp-clear").onclick = clearComparePicks;
        cmpPane.querySelector("#ra-cmp-done").onclick = compareDone;
    }

    function addComparePick(run, name) {
        if (!run) return;
        const key = runKey(run);
        if (cmpItems.some(i => i.key === key)) return; // a click can send several requests for one run
        if (cmpItems.length >= COMPARE_MAX) {
            showToast(`Limit is ${COMPARE_MAX} runs for comparison.`, "error");
            return;
        }
        cmpItems.push({ key, run: { ...run }, name });
        if (!pulledRuns[key]) {
            cmpState[key] = "waiting";
            pumpCompareDownloads();
        }
        renderComparePane();
    }

    function removeComparePick(key) {
        const at = cmpItems.findIndex(i => i.key === key);
        if (at >= 0) cmpItems.splice(at, 1);
        if (cmpInFlight?.key === key) cmpInFlight.controller.abort("removed");
        delete cmpState[key];
        delete cmpErrors[key];
        renderComparePane();
    }

    function clearComparePicks() {
        cmpInFlight?.controller.abort("removed");
        cmpItems.length = 0;
        for (const k of Object.keys(cmpState)) delete cmpState[k];
        for (const k of Object.keys(cmpErrors)) delete cmpErrors[k];
        renderComparePane();
    }

    // One download at a time, in pick order; NavBlue takes a while per run
    async function pumpCompareDownloads() {
        if (cmpPumping) return;
        cmpPumping = true;
        try {
            for (;;) {
                const item = cmpItems.find(i => cmpState[i.key] === "waiting");
                if (!item) break;
                if (pulledRuns[item.key]) { delete cmpState[item.key]; continue; } // Download Run got there first

                cmpState[item.key] = "downloading";
                renderComparePane();
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort("timeout"), PULL_TIMEOUT_MS);
                cmpInFlight = { key: item.key, controller };
                try {
                    await downloadRun(item.run, controller.signal);
                    delete cmpState[item.key];
                } catch (e) {
                    const reason = controller.signal.aborted ? controller.signal.reason : null;
                    if (reason === "removed") {
                        delete cmpState[item.key];
                    } else {
                        const why = reason === "timeout" ? `No reply after ${PULL_TIMEOUT_MS / 1000}s.` : (e.message || String(e));
                        cmpState[item.key] = "failed";
                        cmpErrors[item.key] = why;
                        showToast(`Compare: ${cmpName(item)} didn't download.\n${why}`, "error");
                    }
                } finally {
                    clearTimeout(timer);
                    cmpInFlight = null;
                }
                refreshPullButton(); // the selected run may be the one that just arrived
                renderComparePane();
            }
        } finally {
            cmpPumping = false;
        }
    }

    async function compareDone() {
        if (cmpItems.length < 2 || cmpItems.some(i => cmpStatus(i) !== "ready")) return;
        for (const item of cmpItems) await reparseIfStale(item.key);
        // Each run is built the way Analyze Run builds it: its download on top of its saved report
        const reports = cmpItems.map(i => buildReport(pulledRuns[i.key].name, pulledRuns[i.key].partials));
        setPane(null);
        openCompare(reports, "analysis");
    }

    // Validate button: the selected, downloaded run, built the same way as for Analyze Run
    async function validateSelectedRun() {
        const key = capturedRun ? runKey(capturedRun) : null;
        if (!key || !pulledRuns[key]) return;
        await reparseIfStale(key);
        const c = pulledRuns[key];
        const report = buildReport(c.name, c.partials);
        const kpi = loadKPI(report.category) || {};
        renderValidationModal(runAllValidations(report, kpi), report.name);
        closeAllModals();
        document.getElementById("ra-modal-validate-backdrop").classList.add("visible");
    }

    // ---------------- View Text highlighting ----------------
    // Marks every line of a download's text that the analyzer reads a value from. The real
    // parsers run on a String that records each match, so the marks can't drift from what the
    // parsers do; the matches are then mapped from the flattened text back to the original lines.

    // flattenReportText()'s output plus, for each of its characters, its index in `raw`.
    function flattenWithMap(raw) {
        const out = [], map = [];
        const n = raw.length, ws = /\s/;
        let i = 0;
        while (i < n && ws.test(raw[i])) i++;
        while (i < n) {
            if (ws.test(raw[i])) {
                const start = i;
                while (i < n && ws.test(raw[i])) i++;
                if (i < n) { out.push(" "); map.push(start); }
            } else { out.push(raw[i]); map.push(i); i++; }
        }
        return { flat: out.join(""), map };
    }

    // A String that records where each match() / matchAll() landed. slice() keeps the offset, so
    // parseInputs' per-group segments still report positions in the whole text. The parsers only
    // use match, matchAll, search, slice and length on their text; a new method needs a hook here.
    class TracedText extends String {
        constructor(value, offset, sink) { super(value); this._off = offset; this._sink = sink; }
        _record(re) {
            if (!(re instanceof RegExp)) return;
            const r = new RegExp(re.source, re.flags.includes("d") ? re.flags : re.flags + "d");
            const s = String(this);
            let m;
            while ((m = r.exec(s)) !== null) {
                this._sink.push({ re, indices: m.indices, off: this._off });
                if (!r.global) break;
                if (m[0] === "") r.lastIndex++;
            }
        }
        match(re) { this._record(re); return String.prototype.match.call(String(this), re); }
        matchAll(re) { this._record(re); return String.prototype.matchAll.call(String(this), re); }
        slice(a, b) {
            const s = String(this), len = s.length;
            const from = a === undefined ? 0 : a < 0 ? Math.max(len + a, 0) : Math.min(a, len);
            return new TracedText(s.slice(a, b), this._off + from, this._sink);
        }
    }

    const PATTERN_NAMES = new Map(Object.entries(PATTERNS).map(([k, re]) => [re, k]));
    // Not highlighted: the reserve grids, and the scheduler inputs from the Stats Options
    // section. parseInputs' per-key patterns aren't in PATTERNS, so they drop out on their own.
    const TRACE_SKIP = new Set([
        "RESERVE_GRID", "COLORING_GRID",
        "FOLLOWED_BY", "NORM_WINDOW_LOW", "NORM_WINDOW_HIGH", "MIN_CW_LOW", "MIN_CW_HIGH", "MIN_CW_THRESH",
        "MAX_CW_LOW", "MAX_CW_HIGH", "RLL_CW_LOW", "RLL_CW_THRESH", "MIN_CREDITS_ALLOWED", "MAX_CREDITS_ALLOWED",
        "MAX_14LC", "AM_COLOR", "PM_COLOR", "RE_COLOR", "PRIORITY_STACK_DATE", "SECONDARY_PRIORITY_STACK_DATE",
        "USE_PRIORITY_STACK_DATE", "USE_SECONDARY_PRIORITY_STACK_DATE", "FORCE_PSD", "USE_UNSTACKING",
    ]);
    function traceLabel(key) {
        const words = key.replace(/_w_NAME$/, "_NAME").replace(/_/g, " ").toLowerCase();
        return words.charAt(0).toUpperCase() + words.slice(1);
    }

    // Report text -> [{ start, end, label }] in raw-text positions, or null if it can't be mapped.
    // Each match marks its capture groups (the values read), or the whole match if it has none.
    function traceReportText(raw) {
        raw = String(raw || "");
        const { flat, map } = flattenWithMap(raw);
        if (flat !== flattenReportText(raw)) return null;
        const segments = splitReports(flat);
        const types = Object.keys(segments);
        if (types.length === 1) segments[types[0]] = flat; // as readReportText does
        const hits = [];
        for (const type of APPLY_ORDER) {
            const seg = segments[type];
            if (!seg || detectReportType(seg) !== type) continue;
            const sink = [];
            try { parseReport(new TracedText(seg, flat.indexOf(seg), sink), type); }
            catch (e) { console.warn("[PBS Analyzer] couldn't trace", type, e); continue; }
            for (const { re, indices, off } of sink) {
                const key = PATTERN_NAMES.get(re);
                if (!key || TRACE_SKIP.has(key)) continue;
                const groups = indices.slice(1).filter(Boolean);
                for (const [s, e] of (groups.length ? groups : [indices[0]])) {
                    if (e > s) hits.push({ start: map[off + s], end: map[off + e - 1] + 1, label: traceLabel(key) });
                }
            }
        }
        return hits;
    }

    // Report text -> HTML lines, read lines tinted and the values themselves marked.
    function buildTracedHTML(raw, hits) {
        const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const starts = [0];
        for (let i = 0; i < raw.length; i++) if (raw[i] === "\n") starts.push(i + 1);
        const lineOf = pos => { // last line starting at or before pos
            let lo = 0, hi = starts.length - 1;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
            return lo;
        };
        const perLine = new Map(); // line -> { labels:Set, spans:[[s,e]] } in line-relative positions
        for (const h of hits) {
            for (let ln = lineOf(h.start), last = lineOf(h.end - 1); ln <= last; ln++) {
                const ls = starts[ln], le = ln + 1 < starts.length ? starts[ln + 1] - 1 : raw.length;
                const s = Math.max(h.start, ls) - ls, e = Math.min(h.end, le) - ls;
                if (!perLine.has(ln)) perLine.set(ln, { labels: new Set(), spans: [] });
                const info = perLine.get(ln);
                info.labels.add(h.label);
                if (e > s) info.spans.push([s, e]);
            }
        }
        let count = 0;
        const html = starts.map((ls, ln) => {
            const text = raw.slice(ls, ln + 1 < starts.length ? starts[ln + 1] - 1 : raw.length).replace(/\r$/, "");
            const info = perLine.get(ln);
            if (!info) return `<div class="ln">${esc(text)}</div>`;
            count++;
            const spans = info.spans.sort((a, b) => a[0] - b[0]).reduce((acc, sp) => {
                const prev = acc[acc.length - 1];
                if (prev && sp[0] <= prev[1]) prev[1] = Math.max(prev[1], sp[1]); else acc.push([...sp]);
                return acc;
            }, []);
            let out = "", at = 0;
            for (const [s, e] of spans) {
                out += esc(text.slice(at, s)) + `<mark>${esc(text.slice(s, e))}</mark>`;
                at = e;
            }
            out += esc(text.slice(at));
            return `<div class="ln hit" title="${esc([...info.labels].join("\n"))}">${out}</div>`;
        }).join("");
        return { html, count };
    }

    // Fill the View Text window: highlighted lines, a count, Prev / Next and a highlight switch.
    function fillTextWindow(w, raw) {
        const doc = w.document;
        let traced = null;
        try {
            const hits = traceReportText(raw);
            if (hits) traced = buildTracedHTML(raw, hits);
        } catch (e) { console.warn("[PBS Analyzer] couldn't highlight the report text", e); }
        if (!traced) {
            doc.body.innerHTML = "";
            const pre = doc.createElement("pre");
            pre.style.cssText = "font: 12px/1.35 ui-monospace, Menlo, monospace; white-space: pre; padding: 12px;";
            pre.textContent = raw;
            doc.body.appendChild(pre);
            return;
        }
        doc.head.insertAdjacentHTML("beforeend", `<style>
            body { margin: 0; background: #fff; color: #1d2433; }
            .ra-bar { position: sticky; top: 0; left: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
                padding: 7px 12px; background: #eef1f5; border-bottom: 1px solid #cfd6e0; font: 13px/1.3 system-ui, sans-serif; }
            .ra-bar button { font: inherit; padding: 3px 10px; cursor: pointer; }
            .ra-txt { font: 12px/1.35 ui-monospace, Menlo, monospace; padding: 10px 12px; }
            .ln { white-space: pre; min-height: 1.35em; }
            .hit { background: #fff4c2; }
            .hit mark { background: #ffd43b; color: inherit; border-radius: 2px; }
            .hit.cur { outline: 2px solid #f08c00; outline-offset: -1px; }
            body.ra-plain .hit { background: none; outline: none; }
            body.ra-plain .hit mark { background: none; }
        </style>`);
        doc.body.innerHTML = `<div class="ra-bar">
            <span><b>${traced.count}</b> highlighted lines are what the analyzer reads. Hover one to see which value.</span>
            <button type="button" id="ra-prev">↑ Prev</button><button type="button" id="ra-next">Next ↓</button>
            <label><input type="checkbox" id="ra-hl" checked> Highlight</label>
        </div><div class="ra-txt">${traced.html}</div>`;
        const lines = [...doc.querySelectorAll(".hit")];
        let cur = -1;
        const go = step => {
            if (!lines.length) return;
            lines[cur]?.classList.remove("cur");
            cur = (cur + step + lines.length) % lines.length;
            lines[cur].classList.add("cur");
            lines[cur].scrollIntoView({ block: "center" });
        };
        doc.getElementById("ra-next").addEventListener("click", () => go(1));
        doc.getElementById("ra-prev").addEventListener("click", () => go(-1));
        doc.getElementById("ra-hl").addEventListener("change", e => doc.body.classList.toggle("ra-plain", !e.target.checked));
    }

    if (IS_RUN_LIST) {
        window.__raRunListOnCapture = () => {
            refreshPullButton();
            if (!cmpPicking()) return;
            const recent = lastRowClick && Date.now() - lastRowClick.ts < 3000 ? lastRowClick.name : null;
            addComparePick(capturedRun, recent);
        };
        // The clicked run's name, so a pick reads as the run before its download names it.
        // Mousedown, capture phase: before NavBlue's own handler sends the request that reports
        // the selection, whether it selects on mousedown or on click.
        document.addEventListener("mousedown", (e) => {
            const row = e.target?.closest?.('div.TableRow[id^="cr_table_"]');
            const cells = row ? row.querySelectorAll(":scope > .TableCell") : [];
            if (cells.length < 6) return; // signature rows have fewer cells
            const name = [...cells[0].childNodes]
                .filter(n => !(n.nodeType === 1 && n.classList.contains("nbh-stats")))
                .map(n => n.textContent).join("").trim();
            if (name) lastRowClick = { name, ts: Date.now() };
        }, true);
        onPaneChange = renderComparePane;
        document.getElementById("compare-runs").addEventListener("click", () => setPane(openPane === "cmp" ? null : "cmp"));
        document.getElementById("validate-run").addEventListener("click", validateSelectedRun);
        setInterval(() => { if (!pullInFlight) refreshPullButton(); }, 30000); // keep the tooltip's age current
        document.getElementById("pull-report").addEventListener("click", () => pullAndAnalyze(false));
        document.getElementById("repull-report").addEventListener("click", () => pullAndAnalyze(true));

        // Opens straight from the click, so popup blockers allow it. Text is memory only.
        document.getElementById("view-report-text").addEventListener("click", () => {
            const c = capturedRun ? pulledRuns[runKey(capturedRun)] : null;
            if (!c) return;
            const w = window.open("", "_blank"); // open now, inside the click, or it gets blocked
            if (!w) return showToast("The browser blocked the window.", "error");
            w.document.title = `${c.name} — downloaded reports`;
            const pre = w.document.createElement("pre");
            pre.style.cssText = "font: 12px/1.35 ui-monospace, Menlo, monospace; white-space: pre; padding: 12px;";
            w.document.body.appendChild(pre);
            if (c.text) return fillTextWindow(w, c.text);
            if (!c.textGz) { pre.textContent = "The report text wasn't stored for this download. ↻ downloads it again."; return; }
            pre.textContent = "Unpacking…";
            gunzipBase64(c.textGz)
                .then(t => { c.text = t; fillTextWindow(w, t); })
                .catch(() => { pre.textContent = "Couldn't unpack the stored text. ↻ downloads it again."; });
        });

        refreshPullButton();
    } else {
        // Analyze. The report is parsed before any KPI is saved, so a report that can't be
        // read never creates or locks a tab.
        // The run this page belongs to, for Analyze and Validate. When the run list has
        // downloaded it (same name, and the same category and period where both say), that
        // download's Stats + Dynamic + Unstacking, so the analysis is the full one; a report type
        // the download lacks comes from the page. Without a download, this page's report alone.
        // Null (after a toast) when the page can't be read.
        async function readPageRun() {
            const read = readScreenReport();
            if (!read) return null;
            const name = read.names[0];
            const key = findDownloadFor(buildReport(name, read.partials));
            if (key) await reparseIfStale(key);
            const dl = key ? pulledRuns[key] : null;
            const partials = dl
                ? APPLY_ORDER.map(t => dl.partials.find(p => p.type === t) || read.partials.find(p => p.type === t)).filter(Boolean)
                : read.partials;
            return { name, read, dl, partials, report: buildReport(name, partials) };
        }

        document.querySelector("#load-report").addEventListener("click", async () => {
            if (pairingsReportInfo()) {
                return showToast("This is an IOE Pairings report — use Validate to check its IOE trips.", "error");
            }
            const run = await readPageRun();
            if (!run) return;
            const { name, read, dl, partials } = run;
            setPane(null); // as on the run list: close the KPI drop-down (finishRun reopens it if needed)
            if (!finishRun(run.report)) return;
            if (!dl) {
                showToast(`Report analyzed: this ${TYPE_LABEL[read.partials[0].type] || "report"} report only.\nDownload the run on the run list for the full analysis.`, "info");
                return;
            }
            const gaps = APPLY_ORDER.filter(t => !partials.some(p => p.type === t)).map(t => TYPE_LABEL[t]);
            showToast(`${name}: analyzed from the run list download (${formatAge(dl.ts)})\n`
                + partials.map(p => TYPE_LABEL[p.type] || p.type).join(" + ")
                + (gaps.length ? `\nNot downloaded: ${gaps.join(", ")}` : ""), gaps.length ? "info" : "success");
        });

        // Validate the run on this page: its run list download when there is one (readPageRun),
        // else the page's one report, whose checks needing another report come back "missing".
        // KPIs are read, never created.
        document.getElementById("validate-run").addEventListener("click", async () => {
            // An IOE Pairings report has no stats to check: Validate counts its trips instead
            const pairingsInfo = pairingsReportInfo();
            if (pairingsInfo) {
                const { category, results } = validatePairingsReport(pairingsInfo);
                renderValidationModal(results, `IOE Pairings${category ? ` — ${category}` : ""}${pairingsInfo.period ? ` · ${pairingsInfo.period}` : ""}`);
                closeAllModals();
                document.getElementById("ra-modal-validate-backdrop").classList.add("visible");
                return;
            }
            const run = await readPageRun();
            if (!run) return;
            const report = run.report;
            const kpi = loadKPI(report.category || activeKPICategory) || {};
            renderValidationModal(runAllValidations(report, kpi),
                `${report.name}${run.dl ? " · run list download" : ` · ${TYPE_LABEL[run.read.partials[0].type] || "this"} report only`}`);
            closeAllModals();
            document.getElementById("ra-modal-validate-backdrop").classList.add("visible");
        });
    }

    // close side panel
    document.getElementById("ra-close").addEventListener("click", hidePanel);

    // Manage Reports button -> open modal

    // Version badge -> open change log modal
    document.querySelector("#changelog-btn")?.addEventListener("click", () => {
        document.getElementById("ra-changelog-backdrop").classList.add("visible");
    });


    // ---------------- Run Highlighter (run list only) ----------------
    // Formerly the separate "PBS Run Highlighter" userscript (v1.2). Colors each run row of the
    // Completed list by its ALV against the published ALV in the KPIs, and adds run-line stats and
    // ★/✕ marks. Its storage keys (NBRunHighlighter*) are unchanged, so colors, marks and typed-in
    // ALVs carry over. See CLAUDE.md "Run Highlighter".
    function startRunHighlighter() {
        // ---------------- Config ----------------
        const CFG = {
            ALV_TOLERANCE_MINUTES: LOA.ALV_TOLERANCE_MINUTES,             // the analyzer's own rules
            ALV_TOLERANCE_SMALL_MINUTES: LOA.ALV_TOLERANCE_SMALL_MINUTES,
            SMALL_POSITION_LINES: LOA.SMALL_POSITION_LINES,               // <= this many lines => wide tolerance
            COLORS: { green: '#a5d6a7', yellow: '#fff59d', red: '#ef9a9a' },
            MARK_COLORS: { like: '#ef6c00', likeEnd: '#1a237e', out: '#c62828' }, // ★ is a diagonal like -> likeEnd gradient
            KPI_KEY: KPI_KEY,                 // the analyzer's KPIs; READ ONLY here
            CACHE_KEY: 'NBRunHighlighterCache',
            MANUAL_KEY: 'NBRunHighlighterTargets',
            PREF_KEY: 'NBRunHighlighterEnabled',
            MARKS_KEY: 'NBRunHighlighterMarks', // { 'CAT|Period|Run': 'like' | 'out' }
            // The KPI run (orange) and the ALPA run (light blue): at most one of each per
            // signature + month, and a run holds at most one of them.
            ROLE_COLORS: { kpi: '#ffb74d', alpa: '#90caf9' },
            ROLE_LABELS: { kpi: 'KPI run', alpa: 'ALPA run' },
            ROLES_KEY: 'NBRunHighlighterRoles', // { 'CAT|Period': { kpi: 'RunName', alpa: 'RunName' } }
            // Custom colours: any number of runs, each its own colour. The KPI / ALPA colour wins
            // over a custom one, and a custom one over the ALV colour.
            CUSTOM_KEY: 'NBRunHighlighterColors',      // { 'CAT|Period|Run': '#rrggbb' }
            CUSTOM_PICK_KEY: 'NBRunHighlighterPick',   // the picker's last colour
            CUSTOM_DEFAULT: '#ce93d8',
            SWATCH_KEY: 'NBRunHighlighterSwatches',    // four saved colours for quick picking, '#rrggbb' or null
            SWATCH_COUNT: 4,
        };

        // ---------------- Storage helpers ----------------
        function readJSON(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch { return fallback; }
        }
        function writeJSON(key, obj) {
            try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { console.warn('[RunHighlighter] storage write failed', e); }
        }

        let enabled = readJSON(CFG.PREF_KEY, true) !== false;
        let cache = readJSON(CFG.CACHE_KEY, {});
        let marks = readJSON(CFG.MARKS_KEY, {});
        let roles = readJSON(CFG.ROLES_KEY, {});
        let customColors = readJSON(CFG.CUSTOM_KEY, {});
        const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
        let customPick = isHex(readJSON(CFG.CUSTOM_PICK_KEY, null)) ? readJSON(CFG.CUSTOM_PICK_KEY, null) : CFG.CUSTOM_DEFAULT;
        let swatches = (() => {
            const saved = readJSON(CFG.SWATCH_KEY, []);
            return Array.from({ length: CFG.SWATCH_COUNT }, (_, i) => isHex(saved?.[i]) ? saved[i] : null);
        })();
        // Black or white text, whichever reads better on the colour
        function textOn(hex) {
            const n = parseInt(hex.slice(1), 16);
            const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
            return lum > 0.55 ? '#000' : '#fff';
        }
        let pendingName = null; // run name from the last click, until its stats show up
        let lastClickedName = null; // run name from the last click, kept (Mark KPI / Mark ALPA act on it)
        let holdCapture = false; // after "Clear Highlights": capture nothing until a run is clicked

        // ---------------- Small utils ----------------
        const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

        function fmt(mins) {
            if (mins == null || Number.isNaN(mins)) return '--:--';
            const sign = mins < 0 ? '-' : '';
            const a = Math.abs(mins);
            return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
        }
        function fmtSigned(mins) { return (mins >= 0 ? '+' : '') + fmt(mins); }
        function parseHHMM(s) {
            const m = /^\s*(\d{1,3}):([0-5]\d)\s*$/.exec(s || '');
            return m ? Number(m[1]) * 60 + Number(m[2]) : null;
        }
        const cellsOf = row => row.querySelectorAll(':scope > .TableCell');
        // Run name = Name cell text, minus a stats tag (rows used to carry one; the standalone script still adds it).
        const nameOf = row => [...(cellsOf(row)[0]?.childNodes || [])]
            .filter(n => !(n.nodeType === 1 && n.classList.contains('nbh-stats')))
            .map(n => n.textContent).join('').trim();
        // The app marks the selected row with an inline "background-color: highlight".
        const isSelected = row => /background-color:\s*highlight\b/i.test(row.getAttribute('style') || '');

        // ---------------- Reading the page ----------------
        // Runs table rows have 6 cells (Name, State, Valid, Started, Finished, Elapsed).
        // The Signature list on the left uses the same id prefix with 3 cells.
        function runRows() {
            return [...document.querySelectorAll('div.TableRow[id^="cr_table_"]')].filter(r => cellsOf(r).length >= 6);
        }
        function signatureRows() {
            return [...document.querySelectorAll('div.TableRow[id^="cr_table_"]')].filter(r => {
                const n = cellsOf(r).length;
                return n >= 2 && n < 6;
            });
        }
        // The signature row only looks selected while the signature list has focus; once a run is
        // clicked the app drops (or restyles) that highlight even though the run list still belongs
        // to it. So: treat any inline background as "selected", and remember the last category seen
        // until the period changes or that signature disappears from the list.
        let lastCat = null; // { cat, period }
        let catChangedAt = 0;
        const categoryOf = row => {
            const m = /([A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z]{2})/i.exec(cellsOf(row)[0]?.textContent || '');
            return m ? m[1].toUpperCase() : null;
        };
        const hasSelectionLook = row => /background-color:\s*(?!transparent|;)/i.test(row.getAttribute('style') || '');
        function getCategory() {
            const rows = signatureRows();
            const period = getPeriod().value;
            const sel = rows.find(hasSelectionLook);
            const cat = sel ? categoryOf(sel) : null;
            if (cat) {
                if (!lastCat || lastCat.cat !== cat || lastCat.period !== period) catChangedAt = Date.now();
                lastCat = { cat, period };
                return cat;
            }
            if (lastCat && lastCat.period === period && rows.some(r => categoryOf(r) === lastCat.cat)) return lastCat.cat;
            lastCat = null;
            return null;
        }
        function getPeriod() {
            const sel = document.querySelector('select[id^="run_manager_tab_periods"]');
            const val = sel && sel.value;
            if (!val) return { value: '', month: null, year: null, text: '' };
            const mi = MONTHS.indexOf(val.slice(0, 3).toLowerCase());
            const ym = /(\d{4})/.exec(val);
            return {
                value: val,
                month: mi >= 0 ? mi + 1 : null,
                year: ym ? Number(ym[1]) : null,
                text: val.replace('_', ' '),
            };
        }
        function selectedRunName() {
            const row = runRows().find(isSelected);
            return row ? nameOf(row) : null;
        }
        // Statistics panel: the "Run: <name>" label plus the statistics_table rows.
        function readStats() {
            const label = [...document.querySelectorAll('span.Label')].find(e => /^Run:\s/.test((e.textContent || '').trim()));
            if (!label) return null;
            const name = label.textContent.trim().replace(/^Run:\s*/, '').trim();
            const text = [...document.querySelectorAll('div.TableCell[id^="statistics_table_"]')]
                .map(c => c.textContent).join('\n');
            const alv = /Average\s+Line\s+Value\s+\(ALV\):\s+(\d{1,3}):([0-5]\d)/i.exec(text);
            if (!alv) return null;
            // NavBlue prints Yes, No or Not Used. \s* not \s+: the value may sit in its own element with no
            // space before it. Anything else (or no line) is unknown, which shows yellow like No.
            const conv = /Run\s+Converged:\s*(Not\s*Used|Yes|No)\b/i.exec(text);
            // Same source order as PBS Analyzer: pairing lines, else total schedules awarded
            const lines = /Pairing\s+Lines:\s+(\d+)/i.exec(text) || /Total\s+Schedules\s+Awarded:\s+(\d+)/i.exec(text);
            // Open Time % and Reserve Days, same patterns as PBS Analyzer (OPEN_TIME_PERCENT, TOTAL_RESERVE_DAYS).
            // No OT % line -> compute it from Open Time Credit / Trip Credit, like PBS Analyzer does.
            const otPct = /Open\s+Time\s+Credit\s*%:\s*([0-9]+(?:\.[0-9]+)?)\s*%/i.exec(text);
            const otCr = /Eligible Bidders Excluding Shadows:[\s\S]+?Open Time Credit:\s+(\d{1,5}):(\d{2})/i.exec(text);
            const tripCr = /Eligible Bidders Excluding Shadows:[\s\S]+?Trip Credit:\s+(\d{1,5}):(\d{2})/i.exec(text);
            let ot = otPct ? parseFloat(otPct[1]) : null;
            if (ot == null && otCr && tripCr) {
                const trip = Number(tripCr[1]) * 60 + Number(tripCr[2]);
                if (trip) ot = parseFloat(((Number(otCr[1]) * 60 + Number(otCr[2])) / trip * 100).toFixed(2));
            }
            const rd = /(?:Total\s+)?Reserve\s+Days\s+On\s+Awarded:\s+(\d+)/i.exec(text);
            return {
                name,
                alv: Number(alv[1]) * 60 + Number(alv[2]),
                // true = Yes, false = No, 'notused' = convergence not used for this run
                converged: !conv ? null : /^yes$/i.test(conv[1]) ? true : /^no$/i.test(conv[1]) ? false : 'notused',
                lines: lines ? Number(lines[1]) : null,
                ot,
                rd: rd ? Number(rd[1]) : null,
            };
        }

        // ---------------- Targets ----------------
        // Order: PBS Analyzer's saved published ALV (if it's for this month) -> manual entry in this panel.
        function resolveTarget(cat, period) {
            const manualKey = `${cat}|${period.value}`;
            const kpiAll = readJSON(CFG.KPI_KEY, {});
            const kpi = kpiAll && kpiAll.alvTarget === undefined ? kpiAll[cat] : null; // old flat format = ignore
            let mismatch = null;

            if (kpi && typeof kpi.alvTarget === 'number' && !Number.isNaN(kpi.alvTarget)) {
                const bm = kpi.meta && kpi.meta.bidMonth, by = kpi.meta && kpi.meta.bidYear;
                const monthOk = !(bm && period.month && bm !== period.month) && !(by && period.year && by !== period.year);
                if (monthOk) return { minutes: kpi.alvTarget, source: 'PBS Analyzer' };
                mismatch = { month: bm, year: by };
            }
            const manual = readJSON(CFG.MANUAL_KEY, {})[manualKey];
            if (typeof manual === 'number') return { minutes: manual, source: 'entered here' };
            return { minutes: null, source: null, mismatch };
        }

        // ---------------- Rules ----------------
        function evaluate(entry, target) {
            const tol = (entry.lines != null && entry.lines <= CFG.SMALL_POSITION_LINES)
                ? CFG.ALV_TOLERANCE_SMALL_MINUTES : CFG.ALV_TOLERANCE_MINUTES;
            const diff = entry.alv - target;
            const alvOk = Math.abs(diff) <= tol;
            const color = !alvOk ? 'red' : ((entry.converged === true || entry.converged === 'notused') ? 'green' : 'yellow');
            return { color, diff, tol, alvOk };
        }

        // ---------------- Painting ----------------
        const CLASSES = ['nbh-green', 'nbh-yellow', 'nbh-red', 'nbh-kpi', 'nbh-alpa', 'nbh-custom'];

        function styleTag() {
            const s = document.createElement('style');
            s.id = 'ra-hl-style';
            s.textContent = `
                div.TableRow.nbh-green  { background-color: ${CFG.COLORS.green}  !important; color: #000 !important; }
                div.TableRow.nbh-yellow { background-color: ${CFG.COLORS.yellow} !important; color: #000 !important; }
                div.TableRow.nbh-red    { background-color: ${CFG.COLORS.red}    !important; color: #000 !important; }
                div.TableRow.nbh-kpi    { background-color: ${CFG.ROLE_COLORS.kpi}  !important; color: #000 !important; }
                div.TableRow.nbh-alpa   { background-color: ${CFG.ROLE_COLORS.alpa} !important; color: #000 !important; }
                div.TableRow.nbh-custom { background-color: var(--nbh-custom) !important; color: var(--nbh-custom-fg, #000) !important; }
                div.TableRow.nbh-sel    { outline: 2px solid #1a237e !important; outline-offset: -2px; }
                .nbh-stats { position: absolute; right: 0; top: 0; z-index: 1; padding: 0 3px; font-size: 9px; line-height: inherit;
                             white-space: nowrap; background: #fff !important; color: #000 !important; pointer-events: none; }
                .nbh-stats > span { display: inline-block; font-variant-numeric: tabular-nums; }
                .nbh-stats > .nbh-ot { width: 10ch; }
                .nbh-stats > .nbh-r  { width: 6.5ch; }
                .nbh-marks { float: right; margin-left: 4px; white-space: nowrap; user-select: none; }
                .nbh-marks > span { cursor: pointer; padding: 0 2px; visibility: hidden; color: #777 !important; opacity: .55; }
                div.TableRow:hover .nbh-marks > span { visibility: visible; }
                .nbh-marks > span:hover { opacity: 1; }
                .nbh-marks > span.nbh-on { visibility: visible; opacity: 1; font-weight: bold; }
                .nbh-marks > .nbh-like.nbh-on, .nbh-marks > .nbh-like:hover { color: ${CFG.MARK_COLORS.like} !important; }
                .nbh-marks > .nbh-like.nbh-on, .nbh-marks > .nbh-like:hover {
                    background: linear-gradient(135deg, ${CFG.MARK_COLORS.like} 30%, ${CFG.MARK_COLORS.likeEnd} 70%) content-box;
                    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent !important;
                }
                .nbh-marks > .nbh-out.nbh-on,  .nbh-marks > .nbh-out:hover  { color: ${CFG.MARK_COLORS.out}  !important; }
            `;
            document.head.appendChild(s);
        }

        function setRow(row, cls, title, custom) {
            for (const c of CLASSES) {
                if (c !== cls && row.classList.contains(c)) row.classList.remove(c);
            }
            if (cls && !row.classList.contains(cls)) row.classList.add(cls);
            // A custom colour rides on two CSS variables on the row itself
            const bg = cls === 'nbh-custom' ? custom : '';
            if (row.style.getPropertyValue('--nbh-custom') !== bg) {
                if (bg) { row.style.setProperty('--nbh-custom', bg); row.style.setProperty('--nbh-custom-fg', textOn(bg)); }
                else { row.style.removeProperty('--nbh-custom'); row.style.removeProperty('--nbh-custom-fg'); }
            }
            const wantSel = !!cls && isSelected(row);
            if (row.classList.contains('nbh-sel') !== wantSel) row.classList.toggle('nbh-sel', wantSel);
            if (cls) {
                if (row.title !== title) row.title = title;
                row.dataset.nbhTitle = '1';
            } else if (row.dataset.nbhTitle) {
                row.removeAttribute('title');
                delete row.dataset.nbhTitle;
            }
        }

        const keyFor = (cat, period, name) => `${cat}|${period.value}|${name}`;

        // KPI / ALPA run for the signature + month the key belongs to ('CAT|Period|Run')
        const splitKey = key => { const [cat, period, ...rest] = key.split('|'); return { group: `${cat}|${period}`, name: rest.join('|') }; };
        function roleOf(key) {
            if (!key) return null;
            const { group, name } = splitKey(key);
            const r = roles[group];
            return !r ? null : r.kpi === name ? 'kpi' : r.alpa === name ? 'alpa' : null;
        }

        // ★ / ✕ toggles at the right of the Elapsed cell. Faint on row hover; solid once chosen.
        // (KPI / ALPA runs are set from the options box, not here: the row has no room.)
        function setMarks(row, key) {
            const cell = cellsOf(row)[5];
            let box = row.querySelector('.nbh-marks');
            if (!key || !cell) { if (box) box.remove(); return; }
            if (!box || box.parentElement !== cell) {
                if (box) box.remove();
                box = document.createElement('span');
                box.className = 'nbh-marks';
                box.innerHTML = '<span class="nbh-like">\u2606</span><span class="nbh-out" title="Mark as out">\u2715</span>';
                cell.insertBefore(box, cell.firstChild); // first child so the float stays on the text line
                fitInCell(box, cell); // hidden glyphs still take their space, so this measures the hover layout
            }
            if (box.dataset.key !== key) box.dataset.key = key;
            const m = marks[key] || null;
            const like = box.querySelector('.nbh-like'), out = box.querySelector('.nbh-out');
            const star = m === 'like' ? '\u2605' : '\u2606';
            if (like.textContent !== star) like.textContent = star;
            const likeTitle = m === 'like' ? 'Publish candidate (click to clear)' : 'Mark as publish candidate';
            if (like.title !== likeTitle) like.title = likeTitle;
            const outTitle = m === 'out' ? 'Marked out (click to clear)' : 'Mark as out';
            if (out.title !== outTitle) out.title = outTitle;
            if (like.classList.contains('nbh-on') !== (m === 'like')) like.classList.toggle('nbh-on', m === 'like');
            if (out.classList.contains('nbh-on') !== (m === 'out')) out.classList.toggle('nbh-on', m === 'out');
        }

        // App cells are clipped with an inline clip: rect(...) that ignores padding, so a right float
        // can land partly outside the visible area. Measure and pull it back in when that happens.
        function fitInCell(el, cell) {
            el.style.marginRight = '';
            const m = /rect\(\s*[\d.]+px,?\s*([\d.]+)px/i.exec(cell.style.clip || '');
            const visibleRight = cell.getBoundingClientRect().left + (m ? Number(m[1]) : cell.offsetWidth);
            const over = el.getBoundingClientRect().right - visibleRight;
            if (over > 0) el.style.marginRight = `${Math.ceil(over) + 4}px`;
        }

        // "OT 9.5%, R 788" (Open Time %, Reserve Days): on every run row, at the right of the Name cell,
        // and for the current run at the left end of the toolbar too. The row tag is absolutely placed
        // on a solid white background, so a long name runs underneath it instead of wrapping out of
        // the 18px row (the team wanted the figures on the rows back after 5.1.1 took them off).
        function setStats(row, text) {
            const cell = cellsOf(row)[0];
            let el = row.querySelector('.nbh-stats');
            if (!text || !cell) { if (el) el.remove(); return; }
            if (!el || el.parentElement !== cell) {
                if (el) el.remove();
                el = document.createElement('span');
                el.className = 'nbh-stats';
                // NavBlue positions its cells absolutely; make sure the tag is placed against the cell
                if (getComputedStyle(cell).position === 'static') cell.style.position = 'relative';
                cell.appendChild(el);
            }
            // Two fixed-width columns (OT, then R), so the figures line up from row to row; a missing
            // one keeps its empty column, so the other still lines up.
            const [ot, r] = text;
            if (el.dataset.t !== ot + '|' + r) {
                el.dataset.t = ot + '|' + r;
                el.innerHTML = '<span class="nbh-ot"></span><span class="nbh-r"></span>';
                el.firstChild.textContent = ot;
                el.lastChild.textContent = r;
                fitInCell(el, cell);
            }
        }
        // [OT part, R part] for a row's tag; null when there is nothing to show
        function rowStatsParts(entry) {
            if (!entry || (entry.ot == null && entry.rd == null)) return null;
            return [entry.ot != null ? `OT ${entry.ot}%` : '', entry.rd != null ? `R ${entry.rd}` : ''];
        }
        function statsText(entry) {
            if (!entry) return '';
            const parts = [];
            if (entry.ot != null) parts.push(`OT ${entry.ot}%`);
            if (entry.rd != null) parts.push(`R ${entry.rd}`);
            return parts.join(', ');
        }
        function setRunStats(text) {
            const el = document.getElementById('hl-run-stats');
            if (!el) return;
            if (el.textContent !== text) el.textContent = text;
            const disp = text ? '' : 'none';
            if (el.style.display !== disp) el.style.display = disp;
        }

        function toggleMark(key, kind) {
            if (marks[key] === kind) delete marks[key];
            else marks[key] = kind;
            writeJSON(CFG.MARKS_KEY, marks);
            lastPanelKey = '';
            run();
        }

        // Setting a role moves it here from any other run, and a run holds only one role.
        function toggleRole(key, role) {
            const { group, name } = splitKey(key);
            const r = { ...(roles[group] || {}) };
            if (r[role] === name) delete r[role];
            else {
                r[role] = name;
                const other = role === 'kpi' ? 'alpa' : 'kpi';
                if (r[other] === name) delete r[other];
            }
            if (Object.keys(r).length) roles[group] = r; else delete roles[group];
            writeJSON(CFG.ROLES_KEY, roles);
            lastPanelKey = '';
            run();
        }

        // Mark Color: on a run without one it sets the picker's colour; on a run with one it clears it
        function toggleCustom(key) {
            if (customColors[key]) delete customColors[key];
            else customColors[key] = customPick;
            writeJSON(CFG.CUSTOM_KEY, customColors);
            lastPanelKey = '';
            run();
        }

        function sync() {
            const cat = getCategory();
            const period = getPeriod();
            const target = enabled && cat ? resolveTarget(cat, period) : null;
            let painted = 0, total = 0, liked = 0, out = 0, colored = 0;

            for (const row of runRows()) {
                total++;
                let cls = null, title = null;
                const name = nameOf(row);
                const key = enabled && cat && name ? keyFor(cat, period, name) : null;
                setMarks(row, key);
                const entry = key ? cache[key] : null;
                setStats(row, rowStatsParts(entry));
                if (key && marks[key] === 'like') liked++;
                if (key && marks[key] === 'out') out++;
                if (target && target.minutes != null) {
                    if (entry) {
                        const r = evaluate(entry, target.minutes);
                        cls = 'nbh-' + r.color;
                        title = `ALV ${fmt(entry.alv)} vs published ${fmt(target.minutes)} (${fmtSigned(r.diff)}), `
                            + `tolerance ±${fmt(r.tol)}${entry.lines != null ? ` [${entry.lines} lines]` : ''}, `
                            + `converged: ${entry.converged == null ? '?' : entry.converged === 'notused' ? 'Not used' : entry.converged ? 'Yes' : 'No'}`
                            + (statsText(entry) ? `, ${statsText(entry)}` : '');
                        painted++;
                    }
                }
                // KPI / ALPA run colour wins, then a custom colour, then the ALV colour; the tooltip keeps the ALV check
                const role = roleOf(key);
                const custom = key && isHex(customColors[key]) ? customColors[key] : null;
                if (custom) colored++;
                if (role) {
                    cls = 'nbh-' + role;
                    title = CFG.ROLE_LABELS[role] + (title ? ` — ${title}` : '');
                } else if (custom) {
                    cls = 'nbh-custom';
                    title = 'Custom highlight' + (title ? ` — ${title}` : '');
                }
                setRow(row, cls, title, custom);
            }
            // Mark KPI / Mark ALPA act on the selected run (or the last one clicked, if it is still listed)
            const names = runRows().map(nameOf);
            const selName = selectedRunName() || (names.includes(lastClickedName) ? lastClickedName : null);
            setRunStats(enabled && cat && selName ? statsText(cache[keyFor(cat, period, selName)]) : '');
            updatePanel({ cat, period, target, painted, total, liked, out, colored, roleSet: cat ? roles[`${cat}|${period.value}`] : null, selName,
                selCustom: cat && selName ? customColors[keyFor(cat, period, selName)] || null : null });
        }

        // ---------------- Capture (click -> read stats -> remember) ----------------
        function capture() {
            if (!enabled) return false;
            const st = readStats();
            if (!st) return false;
            const cat = getCategory();
            if (!cat) return false;
            // Only trust the stats panel once it shows the run that is actually selected/clicked.
            if (st.name !== selectedRunName() && st.name !== pendingName) return false;
            // The stats box still shows the selected run after a clear; don't re-save it unprompted.
            if (holdCapture && st.name !== pendingName) return false;
            // Right after a signature switch the run list/stats may still be the previous signature's;
            // only trust them if a run was clicked since.
            if (Date.now() - catChangedAt < 2500 && st.name !== pendingName) return false;

            const period = getPeriod();
            const k = keyFor(cat, period, st.name);
            const next = { alv: st.alv, lines: st.lines, converged: st.converged, ot: st.ot, rd: st.rd };
            const prev = cache[k];
            if (!prev || Object.keys(next).some(f => prev[f] !== next[f])) {
                cache[k] = { ...next, t: Date.now() };
                writeJSON(CFG.CACHE_KEY, cache);
            }
            if (st.name === pendingName) { pendingName = null; holdCapture = false; }
            return true;
        }

        let scheduled = false;
        let stoodDown = false;
        function run() {
            scheduled = false;
            if (stoodDown) return;
            // The separate Run Highlighter script (nbh-host) is still installed: leave the run list to it
            if (document.getElementById('nbh-host')) { standDown(); return; }
            try { capture(); sync(); } catch (e) { console.warn('[RunHighlighter]', e); }
        }
        function standDown() {
            stoodDown = true;
            hlPaintButton = null;
            const b = document.getElementById('hl-toggle');
            if (b) b.style.display = 'none';
            setRunStats('');
            if (openPane === 'hl') setPane(null);
            if (ui) ui.host.remove();
            showToast('The separate Run Highlighter script is still on.\nPBS Analyzer now includes it — turn the separate script off in TamperMonkey.', 'error');
        }
        function schedule() {
            if (scheduled) return;
            scheduled = true;
            setTimeout(run, 120);
        }

        // ---------------- Panel ----------------
        let ui = null;
        let lastPanelKey = '';

        function buildPanel() {
            const host = document.createElement('div');
            host.id = 'ra-hl-host';
            const root = host.attachShadow({ mode: 'open' });
            root.innerHTML = `
            <style>
              /* No card: the controls sit straight on the dark toolbar drop-down, like the KPI and Compare panes */
              .box{font-size:12px;line-height:1.35;width:520px;max-width:100%;color:#cbd5e1}
              .main{display:flex;gap:16px;align-items:flex-start}
              .ctl{width:300px;flex:none}
              .info{flex:1;min-width:0;text-align:right}
              .row{display:flex;gap:6px;margin-bottom:8px}
              button.act{flex:1;padding:6px 10px;border:0;border-radius:6px;background:#334155;color:#cbd5e1;cursor:pointer;font-size:12px;white-space:nowrap}
              button.act:hover:not(:disabled){background:#475569}
              button.act:disabled{opacity:.4;cursor:default}
              button.on{background:#fef3c7;color:#422006;font-weight:600}
              .roles{display:flex;gap:6px;margin-bottom:8px}
              .roles > div{flex:1;min-width:0;display:flex;flex-direction:column}
              button.role{width:100%;padding:6px 10px;border:0;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;color:#000}
              button.role:disabled{opacity:.4;cursor:default}
              button.kpi{background:${CFG.ROLE_COLORS.kpi}}
              button.alpa{background:${CFG.ROLE_COLORS.alpa}}
              .custom{display:flex;margin-bottom:8px}
              .custom button{flex:1;border-radius:6px 0 0 6px}
              .custom input[type=color]{width:38px;height:auto;padding:2px 4px;border:0;border-left:1px solid rgba(0,0,0,.25);border-radius:0 6px 6px 0;background:var(--pick, #ce93d8);cursor:pointer}
              .custom input[type=color]::-webkit-color-swatch-wrapper{padding:0}
              .custom input[type=color]::-webkit-color-swatch{border:1px solid rgba(0,0,0,.35);border-radius:3px}
              .custom input[type=color]::-moz-color-swatch{border:1px solid rgba(0,0,0,.35);border-radius:3px}
              .swatches{display:flex;gap:6px;margin:-2px 0 8px}
              .slot{position:relative;flex:1;height:20px;border-radius:5px;cursor:pointer;padding:0;font-size:12px;line-height:18px}
              .slot.empty{background:transparent;border:1px dashed #64748b;color:#94a3b8}
              .slot.empty:hover{border-color:#cbd5e1;color:#e2e8f0}
              .slot.full{border:1px solid rgba(0,0,0,.35)}
              .slot.full.cur{outline:2px solid #e2e8f0;outline-offset:1px}
              .slot .x{display:none;position:absolute;top:-6px;right:-6px;width:14px;height:14px;border-radius:50%;background:#0f172a;color:#e2e8f0;font-size:10px;line-height:14px;text-align:center}
              .slot.full:hover .x{display:block}
              .rolename{margin-top:3px;font-size:10px;line-height:1.25;color:#94a3b8;text-align:center;overflow-wrap:anywhere}
              .key{display:flex;flex-wrap:wrap;gap:4px 12px;margin:2px 0 8px;font-size:11px;color:#cbd5e1}
              .sw{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;margin-right:4px}
              .status{font-size:11px;color:#94a3b8;white-space:pre-line}
              .alert{display:none;margin-top:8px;padding:6px 8px;background:rgba(220,38,38,.15);border:1px solid #dc2626;border-radius:6px;color:#fca5a5;font-size:11px}
              input{width:60px;padding:3px 5px;border:1px solid #475569;border-radius:4px;background:#0f172a;color:#e2e8f0;font-size:12px}
              .alert input{margin:6px 4px 0 0}
              .alert button,.fix button.save{border:0;border-radius:4px;background:#2563eb;color:#fff;cursor:pointer;font-size:11px;padding:3px 8px}
              .fix{display:none;margin-top:4px;font-size:11px}
              .fix button.link{all:unset;cursor:pointer;color:#60a5fa;text-decoration:underline;margin-left:8px}
              .fix input{margin-right:4px}
            </style>
            <div class="box" id="box">
              <div id="bd">
                <div class="main">
                <div class="ctl">
                <div class="row"><button class="act" id="toggle"></button></div>
                <div class="roles">
                  <div><button class="role kpi" id="markKpi"></button><span class="rolename" id="kpiName"></span></div>
                  <div><button class="role alpa" id="markAlpa"></button><span class="rolename" id="alpaName"></span></div>
                </div>
                <div class="custom" id="customRow"><button class="role" id="markCustom"></button><input type="color" id="customPick" title="Choose the highlight colour"></div>
                <div class="swatches" id="swatches"></div>
                <div class="row"><button class="act" id="clear" title="Forget saved stats for the selected signature and month (★/✕ marks are kept)">Clear Highlights</button><button class="act" id="clearMarks" title="Remove ★/✕ marks, the KPI/ALPA runs and custom colours for the selected signature and month (saved stats are kept)">Clear marks</button></div>
                <div class="key">
                  <div><span class="sw" style="background:${CFG.COLORS.green}"></span>ALV OK &amp; Converged (or not used)</div>
                  <div><span class="sw" style="background:${CFG.COLORS.yellow}"></span>ALV OK Only</div>
                  <div><span class="sw" style="background:${CFG.COLORS.red}"></span>ALV Not Met</div>
                </div>
                </div>
                <div class="info">
                <div class="status" id="status"></div>
                <div class="fix" id="fix">
                  <span id="fixLinks"><button class="link" id="fixChange">Change</button><button class="link" id="fixRemove">Remove</button></span>
                  <span id="fixEdit" hidden><input id="fixInput" placeholder="HH:MM" maxlength="6"><button class="save" id="fixSave">Save</button><button class="link" id="fixCancel">Cancel</button></span>
                </div>
                </div>
                </div>
                <div class="alert" id="alert">
                  <div id="alertText"></div>
                  <input id="manual" placeholder="HH:MM" maxlength="6"><button id="saveManual">Use this</button>
                </div>
              </div>
            </div>`;
            hlPane.appendChild(host);

            const $ = id => root.getElementById(id);
            ui = {
                host, box: $('box'), bd: $('bd'), toggle: $('toggle'), status: $('status'), alert: $('alert'), alertText: $('alertText'), manual: $('manual'),
                markCustom: $('markCustom'), customPick: $('customPick'), customRow: $('customRow'), swatches: $('swatches'),
                clearMarks: $('clearMarks'), markKpi: $('markKpi'), markAlpa: $('markAlpa'), kpiName: $('kpiName'), alpaName: $('alpaName'),
                fix: $('fix'), fixLinks: $('fixLinks'), fixEdit: $('fixEdit'), fixInput: $('fixInput'),
            };

            $('toggle').addEventListener('click', () => {
                enabled = !enabled;
                writeJSON(CFG.PREF_KEY, enabled);
                lastPanelKey = '';
                run();
            });
            $('clear').addEventListener('click', () => {
                const cat = getCategory(), period = getPeriod();
                if (!cat) return;
                const prefix = `${cat}|${period.value}|`;
                for (const k of Object.keys(cache)) if (k.startsWith(prefix)) delete cache[k];
                writeJSON(CFG.CACHE_KEY, cache);
                pendingName = null;
                holdCapture = true;
                lastPanelKey = '';
                run();
            });
            // Mark KPI / Mark ALPA: on the selected run; on the run that already has it, they clear it
            const markRole = role => {
                const cat = getCategory(), period = getPeriod();
                if (!cat || !selRunForButtons) return;
                toggleRole(keyFor(cat, period, selRunForButtons), role);
            };
            $('markKpi').addEventListener('click', () => markRole('kpi'));
            $('markAlpa').addEventListener('click', () => markRole('alpa'));
            // Mark Color toggles the picker's colour on the selected run. Picking a colour sets it
            // for the next mark and, when the selected run has a custom colour, recolours that run.
            $('markCustom').addEventListener('click', () => {
                const cat = getCategory(), period = getPeriod();
                if (!cat || !selRunForButtons) return;
                toggleCustom(keyFor(cat, period, selRunForButtons));
            });
            const paintCustomButton = c => {
                ui.customRow.style.setProperty('--pick', c);
                ui.markCustom.style.background = c;
                ui.markCustom.style.color = textOn(c);
            };
            $('customPick').addEventListener('input', () => paintCustomButton(ui.customPick.value)); // live preview while dragging
            // A new colour for the next mark (and for the selected run, if it already has one):
            // from the picker or from a saved slot.
            const setPick = c => {
                if (!isHex(c)) return;
                customPick = c;
                writeJSON(CFG.CUSTOM_PICK_KEY, c);
                const cat = getCategory(), period = getPeriod();
                const k = cat && selRunForButtons ? keyFor(cat, period, selRunForButtons) : null;
                if (k && customColors[k]) { customColors[k] = c; writeJSON(CFG.CUSTOM_KEY, customColors); }
                lastPanelKey = '';
                run();
            };
            $('customPick').addEventListener('change', () => setPick(ui.customPick.value));
            // Four saved colours: an empty slot (+) saves the current colour, a full one picks it,
            // its ✕ empties it. Rebuilt on every change, with its handlers, like the other renders.
            const renderSwatches = () => {
                ui.swatches.innerHTML = swatches.map((c, i) => c
                    ? `<button class="slot full${c.toLowerCase() === customPick.toLowerCase() ? ' cur' : ''}" data-i="${i}" style="background:${c}" title="Use ${c}"><span class="x" data-x="${i}" title="Remove this colour">✕</span></button>`
                    : `<button class="slot empty" data-i="${i}" title="Save the current colour here">+</button>`).join('');
                ui.swatches.querySelectorAll('.slot').forEach(b => b.addEventListener('click', e => {
                    const i = Number(b.dataset.i);
                    if (e.target.dataset.x != null) swatches[i] = null;
                    else if (!swatches[i]) swatches[i] = customPick;
                    else { setPick(swatches[i]); renderSwatches(); return; }
                    writeJSON(CFG.SWATCH_KEY, swatches);
                    renderSwatches();
                }));
            };
            ui.renderSwatches = renderSwatches;
            renderSwatches();
            ui.paintCustomButton = paintCustomButton;
            $('clearMarks').addEventListener('click', () => {
                const cat = getCategory(), period = getPeriod();
                if (!cat) return;
                const prefix = `${cat}|${period.value}|`;
                for (const k of Object.keys(marks)) if (k.startsWith(prefix)) delete marks[k];
                writeJSON(CFG.MARKS_KEY, marks);
                delete roles[`${cat}|${period.value}`];
                writeJSON(CFG.ROLES_KEY, roles);
                for (const k of Object.keys(customColors)) if (k.startsWith(prefix)) delete customColors[k];
                writeJSON(CFG.CUSTOM_KEY, customColors);
                lastPanelKey = '';
                run();
            });
            // Manual published ALV for the selected signature + month; null removes it.
            const setManual = mins => {
                const cat = getCategory(), period = getPeriod();
                if (!cat) return false;
                const all = readJSON(CFG.MANUAL_KEY, {});
                if (mins == null) delete all[`${cat}|${period.value}`];
                else all[`${cat}|${period.value}`] = mins;
                writeJSON(CFG.MANUAL_KEY, all);
                lastPanelKey = '';
                run();
                return true;
            };
            $('saveManual').addEventListener('click', () => {
                const mins = parseHHMM(ui.manual.value);
                if (mins == null || !setManual(mins)) { ui.manual.style.outline = '2px solid #c62828'; return; }
                ui.manual.value = '';
            });
            // Change / Remove an ALV that was entered here (it hides the entry box once saved).
            const showFixEdit = on => { ui.fixLinks.hidden = on; ui.fixEdit.hidden = !on; };
            $('fixChange').addEventListener('click', () => {
                const cat = getCategory();
                const t = cat ? resolveTarget(cat, getPeriod()) : null;
                ui.fixInput.value = t && t.minutes != null ? fmt(t.minutes) : '';
                ui.fixInput.style.outline = '';
                showFixEdit(true);
                ui.fixInput.focus();
                ui.fixInput.select();
            });
            $('fixCancel').addEventListener('click', () => showFixEdit(false));
            $('fixSave').addEventListener('click', () => {
                const mins = parseHHMM(ui.fixInput.value);
                if (mins == null || !setManual(mins)) { ui.fixInput.style.outline = '2px solid #c62828'; return; }
                showFixEdit(false);
            });
            ui.fixInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') $('fixSave').click();
                else if (e.key === 'Escape') showFixEdit(false);
            });
            $('fixRemove').addEventListener('click', () => setManual(null));
        }

        let selRunForButtons = null; // the run Mark KPI / Mark ALPA act on, from the last sync
        function updatePanel({ cat, period, target, painted, total, liked, out, colored, roleSet, selName, selCustom }) {
            if (!ui) return;
            let status, alertMsg = null;

            if (!enabled) {
                status = 'Highlighting is off.';
            } else if (!cat) {
                status = 'Select a signature on the left.';
            } else if (target && target.minutes != null) {
                status = `${cat} · ${period.text}\nPublished ALV ${fmt(target.minutes)} (${target.source})\n${painted} of ${total} runs colored`;
            } else if (target && target.mismatch) {
                const mm = target.mismatch;
                status = `${cat} · ${period.text}\nNo target for this month.`;
                alertMsg = `PBS Analyzer's saved published ALV for ${cat} is for ${mm.month ? MONTHS[mm.month - 1] : '?'} ${mm.year || ''}, `
                    + `not ${period.text}. Enter this month's published ALV in PBS Analyzer, or here:`;
            } else {
                status = `${cat} · ${period.text}\nNo target — no ALV colors.`;
                alertMsg = `No published ALV saved for ${cat}. Enter it in PBS Analyzer's KPI box (then reload this page), or here:`;
            }
            if (enabled && cat && (liked || out)) status += `\nMarked: \u2605 ${liked} \u00b7 \u2715 ${out}`;
            if (enabled && cat && colored) status += `\nCustom colors: ${colored}`;
            const hasRoles = !!(roleSet && (roleSet.kpi || roleSet.alpa));
            selRunForButtons = enabled && cat ? selName : null;

            const canFix = !!(enabled && cat && target && target.source === 'entered here');
            const hasMarks = !!(enabled && cat && (liked || out || hasRoles || colored));
            const key = [enabled, status, alertMsg, canFix, hasMarks, selRunForButtons, roleSet?.kpi, roleSet?.alpa, selCustom, customPick].join('\u0001');
            if (key === lastPanelKey) return;
            lastPanelKey = key;

            ui.toggle.textContent = enabled ? 'Highlighting: ON' : 'Highlighting: OFF';
            ui.toggle.classList.toggle('on', enabled);
            ui.status.textContent = status;
            ui.clearMarks.disabled = !hasMarks;
            for (const [role, btn, nameEl, word] of [['kpi', ui.markKpi, ui.kpiName, 'KPI'], ['alpa', ui.markAlpa, ui.alpaName, 'ALPA']]) {
                const holder = enabled && cat && roleSet ? roleSet[role] || null : null;
                const isHolder = !!holder && holder === selRunForButtons;
                btn.textContent = isHolder ? `Unmark ${word}` : `Mark ${word}`;
                btn.disabled = !selRunForButtons;
                btn.title = !selRunForButtons ? 'Select a run in the list first'
                    : isHolder ? `${selRunForButtons} is the ${CFG.ROLE_LABELS[role]} — click to clear it`
                    : `Make ${selRunForButtons} the ${CFG.ROLE_LABELS[role]}${holder ? ` (instead of ${holder})` : ''}`;
                nameEl.textContent = holder || '—';
                nameEl.title = holder || `No ${CFG.ROLE_LABELS[role]} yet`;
            }
            // The button wears the selected run's custom colour if it has one, else the picker's
            const runColor = selRunForButtons && isHex(selCustom) ? selCustom : null;
            const shown = runColor || customPick;
            if (ui.customPick.value !== shown) ui.customPick.value = shown;
            ui.renderSwatches?.();
            ui.paintCustomButton(shown);
            ui.markCustom.textContent = runColor ? 'Unmark Color' : 'Mark Color';
            ui.markCustom.disabled = !selRunForButtons;
            ui.markCustom.title = !selRunForButtons ? 'Select a run in the list first'
                : runColor ? `Clear ${selRunForButtons}'s custom colour`
                : `Highlight ${selRunForButtons} in this colour (pick it on the right)`;
            ui.fix.style.display = canFix ? 'block' : 'none';
            if (!canFix) { ui.fixLinks.hidden = false; ui.fixEdit.hidden = true; }
            ui.alert.style.display = alertMsg ? 'block' : 'none';
            if (alertMsg) ui.alertText.textContent = alertMsg;
            hlAlert = !!alertMsg;
            paintButton();
        }

        // "Highlight: ON ▾" in the toolbar. A red ring stands in for the floating panel's habit of
        // opening itself for the no-ALV reminder.
        let hlAlert = false;
        function paintButton() {
            const b = document.getElementById('hl-toggle');
            if (!b) return;
            const text = `Highlight: ${enabled ? 'ON' : 'OFF'} ${openPane === 'hl' ? '▴' : '▾'}`;
            if (b.textContent !== text) b.textContent = text;
            b.classList.toggle('hl-on', enabled);
            b.classList.toggle('hl-warn', hlAlert);
            b.title = hlAlert ? 'Run Highlighter needs a published ALV — open for details' : 'Run Highlighter: on/off and options';
        }

        // ---------------- Wire up ----------------
        function init() {
            styleTag();
            buildPanel();
            hlPaintButton = paintButton;
            document.getElementById('hl-toggle').style.display = '';

            // ★/✕ clicks: swallow the whole press so the app doesn't also select the row.
            // Registered before the click listener below so stopImmediatePropagation keeps it out too.
            const markOf = e => e.target && e.target.closest && e.target.closest('.nbh-marks > span');
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
                document.addEventListener(type, e => {
                    const el = markOf(e);
                    if (!el) return;
                    e.stopImmediatePropagation();
                    e.preventDefault();
                    if (type === 'click') toggleMark(el.parentElement.dataset.key, el.classList.contains('nbh-like') ? 'like' : 'out');
                }, true);
            }

            // Remember which run was clicked, so stats can be matched to it once they load.
            document.addEventListener('click', e => {
                const row = e.target && e.target.closest && e.target.closest('div.TableRow[id^="cr_table_"]');
                if (row && cellsOf(row).length < 6) { schedule(); return; } // signature clicked
                if (!row) return;
                pendingName = nameOf(row);
                lastClickedName = pendingName;
                schedule();
            }, true);

            // The app redraws freely (tab switch, period change, scrolling, paging), so re-apply on any change.
            // Our own toolbar and panel redraw often; only NavBlue's changes need a repaint
            const ours = n => { const e = n.nodeType === 1 ? n : n.parentElement; return !!(e && e.closest && e.closest('#ra-drawer, #ra-panel, [id^="ra-pt-"]')); };
            new MutationObserver(recs => { if (recs.some(r => !ours(r.target))) schedule(); }).observe(document.body, {
                childList: true, subtree: true, characterData: true,
                attributes: true, attributeFilter: ['style', 'class'],
            });
            setInterval(schedule, 1500); // belt and braces
            run();
        }

        init();
    }
    if (IS_RUN_LIST) startRunHighlighter();

    // ---------------- Paste Targets (run list only) ----------------
    // Fills NavBlue's Short Call Types tables (AM / PM / RE Min Coverage, one row per day) from a
    // KPI category's grid, or from a pasted grid in the KPI format (Date LC AM PM RE TTL; LC and
    // TTL are not used). Rows are matched by their date label ("Dec 1"), not by position. Replaces
    // the separate "Paste Reserve Targets" Chrome extension. See CLAUDE.md "Paste Targets".
    function startPasteTargets() {
        const BANDS = ["AM", "PM", "RE"];
        const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const tableOf = (band) => document.querySelector(`[id^="reserve_short_call_parameters_table_${band}_"]`);
        const PASTE = "__paste__"; // the source <select>'s value for the paste box

        let source = null;  // a KPI category, or PASTE
        let undoSnap = null; // [{ band, md, prev }] from the last fill
        let popOpen = false;
        let lastHTML = null;  // the pop-up as last rendered
        let autoFor = null;   // the screen's Group the source was last set from

        // The run setup screen's Group drop-down (add_run_to_queue_rungroups_<n>) names the
        // category being set up. Its selection is the <select>'s value property, not anything in
        // the HTML. The prompt option "Select a RunGroup..." means none.
        function pageGroup() {
            const sels = [...document.querySelectorAll('select[id^="add_run_to_queue_rungroups_"]')];
            const sel = sels.find(s => { const r = s.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || sels[0];
            const v = sel ? String(sel.value || "").trim() : "";
            return v && !/^Select\b/i.test(v) ? v : null;
        }

        // ---- Reading the screen ----
        // A cell is fillable when its input is there, enabled, writable and laid out. NavBlue may
        // switch a whole band off; its inputs then fail one of those.
        function fillable(inp) {
            if (!inp || inp.disabled || inp.readOnly) return false;
            if (inp.closest('[disabled], .disabled, .Disabled')) return false;
            const r = inp.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(inp).visibility !== "hidden";
        }

        // { AM: { present, rows: Map("12-1" -> { label, input, ok }) }, ... }, plus the screen's
        // dates in order (from the first band that has rows).
        function readScreen() {
            const out = { bands: {}, order: [] };
            for (const band of BANDS) {
                const t = tableOf(band);
                const rows = new Map();
                for (const row of t ? t.querySelectorAll(".TableRow") : []) {
                    const m = (row.textContent || "").match(/\b([A-Z][a-z]{2})\s+(\d{1,2})\b/);
                    const mon = m ? MONTHS.indexOf(m[1]) + 1 : 0;
                    if (!mon) continue;
                    const md = `${mon}-${Number(m[2])}`;
                    const input = row.querySelector(".IntegerSpinner input.ValidatingText") || row.querySelector("input.ValidatingText");
                    rows.set(md, { label: `${m[1]} ${Number(m[2])}`, input, ok: fillable(input) });
                    if (!out.order.some(o => o.md === md)) out.order.push({ md, label: `${m[1]} ${Number(m[2])}` });
                }
                out.bands[band] = { present: !!t, rows, active: [...rows.values()].some(c => c.ok) };
            }
            return out;
        }

        // ---- Sources ----
        // "12-1" -> { AM, PM, RE } from a parsed KPI grid (keys are ISO dates)
        function byMonthDay(grid) {
            const out = new Map();
            for (const [iso, v] of Object.entries(grid || {})) {
                const [, mm, dd] = iso.split("-").map(Number);
                out.set(`${mm}-${dd}`, v);
            }
            return out;
        }
        function gridMonthLabel(grid) {
            const counts = {};
            for (const iso of Object.keys(grid || {})) { const k = iso.slice(0, 7); counts[k] = (counts[k] || 0) + 1; }
            const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
            if (!best) return "";
            const [y, m] = best[0].split("-").map(Number);
            return `${MONTHS[m - 1]} ${y}`;
        }
        function kpiSources() {
            const all = loadAllKPIs();
            return Object.keys(all).filter(c => all[c]?.grid && Object.keys(all[c].grid).length)
                .sort().map(c => ({ category: c, grid: all[c].grid }));
        }
        // { targets: Map | null, notes: [] } for the chosen source
        function readSource() {
            if (source === PASTE) {
                const box = pop.querySelector("#ra-pt-box");
                const text = expandTwoDigitYears(box.value);
                if (text !== box.value) box.value = text;
                if (!text.trim()) return { targets: null, notes: ["Paste a grid: Date LC AM PM RE TTL, one day per line."] };
                const parsed = parseKPIGrid(text);
                // Day-count and bid-month errors don't stop a fill: rows are matched by date and the
                // preview shows what is missing. Line errors are shown.
                const notes = parsed.errors.filter(e => /^Line /.test(e)).slice(0, 4);
                return { targets: byMonthDay(parsed.grid), notes };
            }
            const k = kpiSources().find(s => s.category === source);
            return k ? { targets: byMonthDay(k.grid), notes: [] } : { targets: null, notes: ["No KPI grid for this category."] };
        }

        // ---- The plan: what a fill would write ----
        function buildPlan() {
            const screen = readScreen();
            const { targets, notes } = readSource();
            const rows = [];
            let changes = 0, same = 0;
            for (const { md, label } of screen.order) {
                const want = targets?.get(md);
                const cells = {};
                for (const band of BANDS) {
                    const cell = screen.bands[band].rows.get(md);
                    const cur = cell?.input ? cell.input.value : null;
                    const v = want ? want[band] : undefined;
                    if (!cell || !cell.input) cells[band] = { kind: "none" };
                    else if (!cell.ok) cells[band] = { kind: "inactive", cur };
                    else if (typeof v !== "number" || Number.isNaN(v)) cells[band] = { kind: "nodata", cur };
                    else if (String(cur).trim() === String(v)) { cells[band] = { kind: "same", cur }; same++; }
                    else { cells[band] = { kind: "change", cur, next: String(v) }; changes++; }
                }
                rows.push({ md, label, cells, hasTarget: !!want });
            }
            const onScreen = new Set(screen.order.map(o => o.md));
            const offScreen = targets ? [...targets.keys()].filter(md => !onScreen.has(md)) : [];
            const noTarget = targets ? rows.filter(r => !r.hasTarget).map(r => r.label) : [];
            return { screen, rows, changes, same, notes, offScreen, noTarget, hasSource: !!targets };
        }

        // ---- Writing ----
        // As the extension did: focus, set, input, change. NavBlue redraws the table as fields
        // change, which replaces the inputs, so a reference taken before the fill goes stale after
        // the first write (v5.3's first try filled only one field). Each field is therefore looked
        // up again just before it is written, one at a time with a pause for NavBlue to redraw,
        // and the read-back uses fresh lookups too.
        const pause = (ms) => new Promise(res => setTimeout(res, ms));
        let busy = false;
        function cellNow(band, md) {
            const t = tableOf(band);
            for (const row of t ? t.querySelectorAll(".TableRow") : []) {
                const m = (row.textContent || "").match(/\b([A-Z][a-z]{2})\s+(\d{1,2})\b/);
                if (!m || `${MONTHS.indexOf(m[1]) + 1}-${Number(m[2])}` !== md) continue;
                const input = row.querySelector(".IntegerSpinner input.ValidatingText") || row.querySelector("input.ValidatingText");
                return input && fillable(input) ? input : null;
            }
            return null;
        }
        // NavBlue's page replaces the global Event with its own (a TamperMonkey script shares the
        // page's globals; the old extension's isolated world did not), so `new Event()` throws
        // "Event is not a constructor". document.createEvent still gives the browser's own.
        function fire(el, type) {
            const ev = document.createEvent("HTMLEvents");
            ev.initEvent(type, true, false);
            el.dispatchEvent(ev);
        }
        function writeInput(el, value) {
            const prev = el.value;
            el.focus();
            el.value = value;
            fire(el, "input");
            if (prev !== value) fire(el, "change");
        }
        // writes: [{ band, md, next }]. Returns how many fields do not hold their value afterwards.
        async function applyWrites(writes) {
            for (const w of writes) {
                const el = cellNow(w.band, w.md);
                if (el) writeInput(el, w.next);
                await pause(25);
            }
            // Tab out of the last field, so NavBlue validates it too
            const a = document.activeElement;
            if (a && a.matches && a.matches("input.ValidatingText")) a.blur();
            await pause(200);
            return writes.filter(w => String(cellNow(w.band, w.md)?.value ?? "").trim() !== w.next).length;
        }
        async function runWrites(writes) {
            busy = true;
            render();
            try { return await applyWrites(writes); }
            catch (err) { console.error("[Paste Targets]", err); showToast(`Fill failed: ${err.message || err}`, "error"); return writes.length; }
            finally { busy = false; }
        }
        async function fill() {
            if (busy) return;
            const plan = buildPlan();
            const writes = [];
            for (const r of plan.rows) for (const band of BANDS) {
                const c = r.cells[band];
                if (c.kind === "change") writes.push({ band, md: r.md, next: c.next, prev: c.cur });
            }
            if (!writes.length) { showToast("Nothing to change: the fields already match."); return; }
            undoSnap = writes.map(w => ({ band: w.band, md: w.md, prev: w.prev }));
            const rejected = await runWrites(writes);
            showToast(rejected
                ? `Filled ${writes.length - rejected} of ${writes.length} fields. ${rejected} did not take: they still show as changes.`
                : `Filled ${writes.length} field${writes.length === 1 ? "" : "s"}. Undo puts the old values back.`,
                rejected ? "error" : "success");
            render();
        }
        async function undo() {
            if (busy || !undoSnap) return;
            const writes = undoSnap
                .filter(s => { const el = cellNow(s.band, s.md); return el && String(el.value).trim() !== String(s.prev); })
                .map(s => ({ band: s.band, md: s.md, next: String(s.prev) }));
            undoSnap = null;
            const rejected = await runWrites(writes);
            showToast(rejected ? `Undo: ${rejected} field(s) did not go back.` : `Undo: ${writes.length} field(s) restored.`, rejected ? "error" : "success");
            render();
        }

        // ---- UI: a button on the Short Call Types box, and its pop-up ----
        const btn = document.createElement("button");
        btn.id = "ra-pt-btn";
        btn.type = "button";
        btn.textContent = "Paste Targets ▾";
        btn.style.display = "none";
        const pop = document.createElement("div");
        pop.id = "ra-pt-pop";
        pop.style.display = "none";
        document.body.append(btn, pop);

        // The box around the three tables: the nearest group box holding all of them, else their
        // nearest common ancestor.
        function shortCallBox() {
            const tables = BANDS.map(tableOf).filter(Boolean);
            if (!tables.length) return null;
            let n = tables[0].parentElement, common = null;
            for (; n && n !== document.body; n = n.parentElement) {
                if (!tables.every(t => n.contains(t))) continue;
                if (!common) common = n;
                if (n.classList.contains("groupbox")) return n;
            }
            return common || tables[0];
        }

        // NavBlue scrolls the screen inside its own panes, so the window is not what clips the
        // box: walk up to every ancestor that clips its overflow and intersect their rects.
        const clips = (el) => { const cs = getComputedStyle(el); return cs.overflowY !== "visible" || cs.overflowX !== "visible"; };
        function scrollPane(el) {
            for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement)
                if (clips(n)) return n;
            return null;
        }
        function visibleArea(el) {
            const r = el.getBoundingClientRect();
            const a = { top: Math.max(0, r.top), left: Math.max(0, r.left), bottom: Math.min(window.innerHeight, r.bottom), right: Math.min(window.innerWidth, r.right) };
            for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
                if (!clips(n)) continue;
                const c = n.getBoundingClientRect();
                a.top = Math.max(a.top, c.top); a.left = Math.max(a.left, c.left);
                a.bottom = Math.min(a.bottom, c.bottom); a.right = Math.min(a.right, c.right);
            }
            return a.bottom > a.top && a.right > a.left ? a : null;
        }

        // Shown while the screen holding the Short Call Types box is showing, wherever the box has
        // been scrolled to: kept just right of the last column of inputs, level with its top, but
        // held inside the visible part of the pane that scrolls it.
        function place() {
            const box = shortCallBox();
            const br = box ? box.getBoundingClientRect() : null;
            const pane = box ? scrollPane(box) : null;
            const area = !br || !(br.width > 0 && br.height > 0) || getComputedStyle(box).visibility === "hidden" ? null
                : pane ? visibleArea(pane) : { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
            // Another screen of the app drawn over the pane? Sample the visible part of the box if
            // any is in view, else the pane itself.
            let shown = !!area;
            if (shown && typeof document.elementsFromPoint === "function") {
                const boxArea = visibleArea(box) || area;
                const x = Math.round((boxArea.left + boxArea.right) / 2), y = Math.round((boxArea.top + boxArea.bottom) / 2);
                const top = document.elementsFromPoint(x, y).find(el => !isOurs(el));
                if (top && !(pane || box).contains(top)) shown = false;
            }
            // Like CSS position: sticky — at its spot while that is in view, held at the top of
            // the pane once the tables scroll up past it, and out of sight (scrolled away with
            // the page) while the tables are still below the visible part.
            const last = [...BANDS].reverse().map(tableOf).find(t => t && t.getBoundingClientRect().width > 0);
            const lr = last ? last.getBoundingClientRect() : br;
            const h = btn.offsetHeight, w = btn.offsetWidth;
            if (shown && lr.top > area.bottom - h - 4) shown = false;
            if (!shown) {
                btn.style.display = "none";
                if (popOpen) setPop(false);
                return;
            }
            btn.style.display = "";
            const top = Math.round(Math.max(area.top + 4, lr.top));
            const left = Math.round(Math.max(area.left + 4, Math.min(lr.right + 16, area.right - w - 4, window.innerWidth - w - 4)));
            btn.style.top = `${top}px`;
            btn.style.left = `${left}px`;
            if (popOpen) {
                const pw = pop.offsetWidth || 460, ph = pop.offsetHeight || 0;
                pop.style.top = `${Math.max(4, Math.min(top + h + 4, window.innerHeight - ph - 4))}px`;
                pop.style.left = `${Math.max(4, Math.min(window.innerWidth - pw - 4, left))}px`;
            }
        }

        function setPop(open) {
            popOpen = open;
            if (open) autoFor = null; // re-read the Group on every opening
            pop.style.display = open ? "" : "none";
            btn.textContent = open ? "Paste Targets ▴" : "Paste Targets ▾";
            if (open) { render(); place(); }
        }

        const esc = (s) => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

        function render() {
            const sources = kpiSources();
            // Follow the screen's Group: on opening and whenever it changes, pick its KPIs if
            // saved. A source chosen by hand stays until the Group changes.
            const group = pageGroup();
            if (group && group !== autoFor) {
                autoFor = group;
                if (sources.some(s => s.category === group)) source = group;
            }
            if (source == null || (source !== PASTE && !sources.some(s => s.category === source))) {
                source = sources.some(s => s.category === activeKPICategory) ? activeKPICategory
                    : sources[0] ? sources[0].category : PASTE;
            }
            const keepBox = expandTwoDigitYears(pop.querySelector("#ra-pt-box")?.value || "");
            const plan = buildPlan();
            const inactive = BANDS.filter(b => plan.screen.bands[b].present && !plan.screen.bands[b].active);
            const missing = BANDS.filter(b => !plan.screen.bands[b].present);

            const cellHTML = (c) => {
                switch (c.kind) {
                    case "change": return `<td class="pt-change" title="Now ${esc(c.cur)}, will be ${esc(c.next)}"><s>${esc(c.cur)}</s> → <b>${esc(c.next)}</b></td>`;
                    case "same": return `<td class="pt-same">${esc(c.cur)}</td>`;
                    case "inactive": return `<td class="pt-off" title="Not fillable on this screen">—</td>`;
                    case "nodata": return `<td class="pt-nodata" title="No target for this day">${esc(c.cur)}</td>`;
                    default: return `<td class="pt-off">·</td>`;
                }
            };
            const rowsHTML = plan.rows.map(r => {
                return `<tr${r.hasTarget ? "" : ' class="pt-miss"'}><td class="pt-date">${esc(r.label)}</td>${BANDS.map(b => cellHTML(r.cells[b])).join("")}</tr>`;
            }).join("");

            const msgs = [...plan.notes];
            if (group && !sources.some(s => s.category === group))
                msgs.push(`No saved KPIs for ${group}, the Group on this screen. Add them in the KPI box, or paste a grid.`);
            else if (group && source !== PASTE && source !== group)
                msgs.push(`Filling from ${source}, but the Group on this screen is ${group}.`);
            if (inactive.length) msgs.push(`${inactive.join(", ")} ${inactive.length === 1 ? "is" : "are"} inactive on this screen and will be left alone.`);
            if (missing.length) msgs.push(`No ${missing.join(", ")} table on this screen.`);
            const nt = plan.noTarget;
            if (plan.hasSource && nt.length) msgs.push(nt.length === plan.rows.length ? "No target for any day on screen: is this the right month?"
                : `No target for ${nt.length > 6 ? `${nt.length} of ${plan.rows.length} days (${nt.slice(0, 5).join(", ")}, …)` : nt.join(", ")}; ${nt.length === 1 ? "that day is" : "those days are"} left alone.`);
            if (plan.hasSource && plan.offScreen.length && plan.noTarget.length !== plan.rows.length)
                msgs.push(`${plan.offScreen.length} target day${plan.offScreen.length === 1 ? " is" : "s are"} not on this screen.`);

            const html = `
  <div class="pt-head"><b>Paste Targets</b><button type="button" class="pt-x" title="Close">✕</button></div>
  <div class="pt-src">
    <label>From
      <select id="ra-pt-src">
        ${sources.map(s => `<option value="${esc(s.category)}"${s.category === source ? " selected" : ""}>KPIs: ${esc(s.category)} (${esc(gridMonthLabel(s.grid))})</option>`).join("")}
        <option value="${PASTE}"${source === PASTE ? " selected" : ""}>Paste a grid…</option>
      </select>
    </label>
  </div>
  <textarea id="ra-pt-box" rows="5" placeholder="12/1/2026 2 5 6 4 17&#10;Date LC AM PM RE TTL, as in the KPI box. LC and TTL are not used."${source === PASTE ? "" : ' style="display:none"'}>${esc(keepBox)}</textarea>
  ${msgs.length ? `<ul class="pt-msgs">${msgs.map(m => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
  <div class="pt-summary">${plan.changes} change${plan.changes === 1 ? "" : "s"}, ${plan.same} already match.</div>
  <div class="pt-grid"><table><thead><tr><th>Date</th>${BANDS.map(b => `<th${inactive.includes(b) ? ' class="pt-off"' : ""}>${b}</th>`).join("")}</tr></thead><tbody>${rowsHTML}</tbody></table></div>
  <div class="pt-foot">
    <span style="flex:1"></span>
    <button type="button" class="pt-undo"${undoSnap && !busy ? "" : " disabled"}>Undo</button>
    <button type="button" class="pt-fill"${plan.changes && !busy ? "" : " disabled"}>${busy ? "Filling…" : `Fill ${plan.changes || ""}`}</button>
  </div>`;
            // The 2s refresh would otherwise rebuild an unchanged pop-up and throw the date list
            // back to the top; when it does change, keep the list where it was scrolled to.
            if (html === lastHTML) return;
            lastHTML = html;
            const scrolled = pop.querySelector(".pt-grid")?.scrollTop || 0;
            pop.innerHTML = html;
            const grid = pop.querySelector(".pt-grid");
            if (grid) grid.scrollTop = scrolled;

            // Re-attached on every render: innerHTML replaced the old nodes
            pop.querySelector(".pt-x").addEventListener("click", () => setPop(false));
            pop.querySelector("#ra-pt-src").addEventListener("change", (e) => { source = e.target.value; render(); if (source === PASTE) pop.querySelector("#ra-pt-box").focus(); });
            const box = pop.querySelector("#ra-pt-box");
            box.addEventListener("change", render);
            box.addEventListener("input", (e) => { if (e.inputType === "insertFromPaste") render(); });
            pop.querySelector(".pt-fill").addEventListener("click", fill);
            pop.querySelector(".pt-undo").addEventListener("click", undo);
        }

        btn.addEventListener("click", () => setPop(!popOpen));
        // A press outside the button and the pop-up closes it, as the toolbar's drop-downs do
        document.addEventListener("pointerdown", (e) => {
            if (!popOpen) return;
            const t = e.target;
            if (t && (btn.contains(t) || pop.contains(t))) return;
            setPop(false);
        }, true);
        // NavBlue may redraw the tables while the pop-up is open; keep the preview current
        // (not while focus is in it: typing in the box, or the source list open).
        setInterval(() => { if (popOpen && !busy && !pop.contains(document.activeElement)) render(); }, 2000);
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        setInterval(place, 500);
        place();
    }
    if (IS_RUN_LIST) startPasteTargets();

    // ---------------- Launch screen: reserve Diff beside Min ----------------
    // The run setup screen's Min / Max table (reserve_parameters_table_<n>) has room to the right
    // of each Min value. Show there the Diff the analyzer panel shows for that day, for the run
    // in the panel (workingReport, with its KPIs), as a reference while typing new Mins. Tags go
    // inside NavBlue's Min cell, so they scroll and clip with it; pointer-events: none keeps the
    // input clickable. NavBlue redraws its tables, so a 500ms pass re-applies them, writing only
    // what changed.
    function startLaunchDiffs() {
        const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const TAG = "ra-ld-tag", CAP = "ra-ld-cap";

        // "12-1" -> { diff, base, required } for the panel's run, or null
        function diffsByDay() {
            const grid = workingReport?.stats?.reserveGrid;
            if (!grid || !currentKPI) return null;
            const out = new Map();
            for (const [iso, day] of Object.entries(grid)) {
                const [, mm, dd] = iso.split("-").map(Number);
                out.set(`${mm}-${dd}`, reserveDayDiff(day, currentKPI.grid?.[iso]));
            }
            return out;
        }
        const pageGroup = () => {
            const sel = [...document.querySelectorAll('select[id^="add_run_to_queue_rungroups_"]')]
                .find(s => s.getBoundingClientRect().width > 0);
            const v = sel ? String(sel.value || "").trim() : "";
            return v && !/^Select\b/i.test(v) ? v : null;
        };
        const sign = (n) => n > 0 ? `+${n}` : String(n).replace("-", "−");
        const esc = (t) => String(t ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

        function setTag(cell, html, cls) {
            let tag = cell.querySelector(`:scope > .${TAG}`);
            if (html == null) { if (tag) tag.remove(); return; }
            if (!tag) { tag = document.createElement("span"); tag.className = TAG; cell.appendChild(tag); }
            if (tag.innerHTML !== html) tag.innerHTML = html;
            const want = `${TAG} ${cls}`.trim();
            if (tag.className !== want) tag.className = want;
        }

        function apply() {
            const tables = [...document.querySelectorAll('[id^="reserve_parameters_table_"]')];
            if (!tables.length) return;
            const diffs = diffsByDay();
            const mode = reserveCompareMode === "actual" ? "GROSS" : "NET";
            for (const table of tables) {
                let matched = 0;
                for (const row of table.querySelectorAll(".TableRow")) {
                    const cells = [...row.children].filter(c => c.classList.contains("TableCell"));
                    const m = (cells[0]?.textContent || "").match(/^\s*([A-Z][a-z]{2})\s+(\d{1,2})\s*$/);
                    const mon = m ? MONTHS.indexOf(m[1]) + 1 : 0;
                    const minCell = cells[1];
                    if (!mon || !minCell || !minCell.querySelector("input")) continue;
                    const d = diffs?.get(`${mon}-${Number(m[2])}`);
                    if (!d) { setTag(minCell, null); continue; }
                    matched++;
                    if (d.diff == null) {
                        setTag(minCell, `<span class="ra-ld-sub">${d.required == null ? "no Required" : `no ${mode}`}</span>`, "");
                        continue;
                    }
                    // Own colour classes: the panel's diff-* are !important and made for a dark background
                    const cls = { "diff-green": "ra-ld-pos", "diff-neutral": "ra-ld-mid", "diff-red": "ra-ld-neg" }[diffClassFor(d.diff)];
                    setTag(minCell, `<b>${sign(d.diff)}</b><span class="ra-ld-sub">${mode} ${d.base} / Req ${d.required}</span>`, cls);
                }
                // A caption in the header names the run, so the numbers aren't a mystery
                // (once captioned, the header holds the caption, so find it through the caption)
                const head = table.querySelector(`.${CAP}`)?.parentElement ||
                    [...table.querySelectorAll("*")].find(el => !el.children.length && /^\s*Min\s*$/.test(el.textContent || ""));
                if (!head) continue;
                let cap = head.querySelector(`:scope > .${CAP}`);
                if (!matched) { if (cap) cap.remove(); continue; }
                const group = pageGroup();
                const other = group && workingReport.category && group !== workingReport.category;
                const text = `Diff (${mode}) · ${workingReport.name}${other ? ` · ${workingReport.category}, not ${group}` : ""}`;
                if (!cap) { cap = document.createElement("span"); cap.className = CAP; head.appendChild(cap); }
                if (cap.textContent !== text) cap.textContent = text;
                cap.classList.toggle("ra-ld-other", !!other);
            }
        }

        // The Max Stack Height screen: one DayIntegerSpinner per day (daySpinner_Dec_1_<n>, a
        // "Dec 1" label and an IntegerSpinner holding the input). Beside each value, the panel
        // run's open trips for that day, red when over the run's max stack height, as in the
        // Reserve Grid's Open Trips column.
        function applyStacks() {
            const spinners = [...document.querySelectorAll('.DayIntegerSpinner[id^="daySpinner_"]')];
            if (!spinners.length) return;
            const stats = workingReport?.stats;
            const grid = stats?.reserveGrid;
            const maxStack = grid ? computeMaxStack(resolveLineCount(stats), stats.openTimePercent) : null;
            const byDay = new Map();
            for (const [iso, day] of Object.entries(grid || {})) {
                const [, mm, dd] = iso.split("-").map(Number);
                const ot = day?.openTrips;
                if (typeof ot === "number" && !Number.isNaN(ot)) byDay.set(`${mm}-${dd}`, ot);
            }
            for (const sp of spinners) {
                const box = sp.querySelector(":scope > .IntegerSpinner");
                if (!box || !box.querySelector("input")) continue;
                const label = sp.querySelector(":scope > .Label")?.textContent || "";
                const m = label.match(/^\s*([A-Z][a-z]{2})\s+(\d{1,2})\s*$/) || sp.id.match(/^daySpinner_([A-Z][a-z]{2})_(\d{1,2})_/);
                const mon = m ? MONTHS.indexOf(m[1]) + 1 : 0;
                const ot = mon ? byDay.get(`${mon}-${Number(m[2])}`) : undefined;
                if (ot == null) { setTag(box, null); continue; }
                const over = maxStack != null && ot > maxStack;
                setTag(box, `<b>${ot}</b><span class="ra-ld-sub">${maxStack != null ? `max stack ${maxStack} · ` : ""}${esc(workingReport.name || "")}</span>`,
                    `ra-ld-stack ${over ? "ra-ld-neg" : "ra-ld-ot"}`);
            }
        }

        setInterval(() => {
            try { apply(); } catch (err) { console.error("[Launch diffs]", err); }
            try { applyStacks(); } catch (err) { console.error("[Launch stacks]", err); }
        }, 500);
    }
    if (IS_RUN_LIST) startLaunchDiffs();

    } // end __raMain

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", __raMain);
    else __raMain();
}

)();
