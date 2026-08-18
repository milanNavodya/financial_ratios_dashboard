# Financial ratios dashboard

Three files — `index.html`, `styles.css`, `app.js` — no install, no server,
no build step. Keep all three in the same folder. It reads data live from
your Google Sheet in the browser.

## Running it

1. Open `index.html` by double-clicking it (or right-click → Open with → your browser).
2. That's it. It fetches your data over the internet each time you open or reload it.

If your browser blocks the request (rare, but some browsers restrict `file://`
pages), run one command from this folder instead and open the printed URL:

```
python3 -m http.server 8000 or python -m http.server 8000
```
then visit `http://localhost:8000`.

## One-time setup on your Google Sheet

The app reads each tab as CSV, so your sheet just needs to be viewable:

**File → Share → General access → "Anyone with the link" → Viewer**

No further "publish to web" step is needed.

## Adding companies / sheets

Open `app.js` in a text editor and find the `CONFIG` object near the top:

```js
const CONFIG = {
  sheetId: '1DEh0sZxLN5UI7BEKqGn7JgWn2CCbKJ7fdZAAEuLPr94',
  companies: [
    {
      id: 'vpel',
      label: 'VPEL',
      annualSheet: 'Financial and Operational Ratios',
      quarterlySheet: 'VPEL_Quarterly'
    }
  ]
};
```

- `sheetId` is the long string in your sheet's URL: `.../spreadsheets/d/THIS_PART/edit`
- Add one object per company, pointing `annualSheet` / `quarterlySheet` at the
  exact tab names in your workbook. All companies can live in the same
  spreadsheet (one or two tabs each) — the dropdown in the app switches
  between them.
- `label` is what shows up in the company dropdown; `id` just needs to be
  unique.

## Suggested layout for quarterly tabs

You asked me to suggest a structure, and to use **year-to-date cumulative**
figures (the standard way interim/quarterly reports are usually published) —
so Q2 already includes Q1, Q4 already includes Q1–Q3, etc.

Create one tab per company, named to match `quarterlySheet` in `CONFIG`
(e.g. `VPEL_Quarterly`), laid out exactly like your annual tab but with
quarter columns instead of year columns:

| ratio | Q1 24/25 | Q2 24/25 | Q3 24/25 | Q4 24/25 | Q1 25/26 | Q2 25/26 | Q3 25/26 | Q4 25/26 |
|---|---|---|---|---|---|---|---|---|
| Revenue | ... | ... | ... | ... | ... | ... | ... | ... |
| Profit After Tax (PAT) | ... | ... | ... | ... | ... | ... | ... | ... |
| Return on Equity (ROE) | ... | ... | ... | ... | ... | ... | ... | ... |
| ... | | | | | | | | |

Notes:
- Column headers must follow the exact pattern `Q<1-4> <YY>/<YY+1>` (e.g.
  `Q4 25/26`) — the app parses this to sort periods chronologically and to
  filter by quarter position.
- Row labels (column A) should match the ratio names used in your annual
  tab, so both tabs share the same list.
- Balance-sheet items (Total Assets, Total Equity, NAV per share, etc.) are
  naturally point-in-time, not cumulative — just enter the balance as of the
  end of that quarter, same as your annual tab does at year end.
- Leave a cell blank (or write "Not in source") for anything you don't have
  yet — the app shows it as "n/a" instead of breaking.

In the app, switch **Period → Quarterly**, then use the quarter filter to
show all quarters in sequence, or lock to one quarter position (e.g. "Q4
only") to compare the same quarter year over year — e.g. 2026 Q4 vs 2025 Q4.

## How values are parsed

Your existing sheet mixes formats like `Rs. 1,122.6 Mn (Rs. 1,122,569,000)`,
`0% (Debt-free)`, and `1.65 (Inferred) / 9 times`. The app extracts the first
usable number it finds per cell (preferring the `Mn` figure for currency
rows). This works for your current data, but a few cells are inherently
ambiguous (e.g. `Nil / 7%`, which could mean two different things) — the app
picks the first number it finds (`7`). If a chart looks off for a specific
cell, hover it in the table below the chart to see the original text, and
consider simplifying that cell in the sheet to a single clean number.

## Notes on the chart

- Selecting ratios with different units (e.g. Revenue in Rs. Mn alongside
  ROE in %) automatically creates separate axes so the scales don't collide.
  Only the first two unit groups get a visible axis label; beyond that,
  values still scale correctly but the axis line is hidden to avoid clutter
  — hover the chart to read exact values in the tooltip, or check the table.
- Line chart mirrors the style from our earlier conversation; bar chart is
  a grouped bar per period.
