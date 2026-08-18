const company_short_codes = ['JKH', 'LVEF', 'VPEL', 'WIND']
/* ============================================================
   CONFIG — edit this to add companies or change sheet tab names
   ============================================================ */
const CONFIG = {
  // The ID from your Google Sheets URL:
  // https://docs.google.com/spreadsheets/d/THIS_PART/edit
  sheetId: '1OTwJtb1_VI7GKVfTRd4-d5y0KrS_TZOfIzjxxLfNvyc',

  companies: company_short_codes.map((code) => ({
    id: code.toLowerCase(),
    label: code,
    annualSheet: code,
    // Create a tab with this exact name when you add quarterly data.
    // Suggested layout for that tab (row 1 = headers, cumulative Q figures):
    //   ratio | Q1 24/25 | Q2 24/25 | Q3 24/25 | Q4 24/25 | Q1 25/26 | Q2 25/26 | ...
    // Use the same ratio names (column A) as the annual tab.
    quarterlySheet: `${code}_Quarterly`
  }))
};

/* ============================================================
   RATIO DEFINITIONS — label as it appears in column A, grouped
   and tagged with a unit so the chart can pick sensible axes
   ============================================================ */
const RATIO_GROUPS = [
  {
    name: 'Income statement', ratios: [
      { key: 'Revenue', unit: 'currency' },
      { key: 'Gross Profit', unit: 'currency' },
      { key: 'Profit Before Tax (PBT)', unit: 'currency' },
      { key: 'Profit After Tax (PAT)', unit: 'currency' },
      { key: 'Earnings Per Share (EPS)', unit: 'per_share' },
    ]
  },
  {
    name: 'Balance sheet', ratios: [
      { key: 'Non-Current Assets', unit: 'currency' },
      { key: 'Current Assets', unit: 'currency' },
      { key: 'Total Assets', unit: 'currency' },
      { key: 'Total Equity', unit: 'currency' },
      { key: 'Non Current Liabilities', unit: 'currency' },
      { key: 'Current Liabilities', unit: 'currency' },
      { key: 'Total Liabilities', unit: 'currency' },
      { key: 'Net Asset Value (NAV) per Share', unit: 'per_share' },
    ]
  },
  {
    name: 'Cash flow', ratios: [
      { key: 'Net Cash Flow from Operating Activities', unit: 'currency' },
      { key: 'Net Cash Flow from Investing Activities', unit: 'currency' },
      { key: 'Net Cash Flow from Financing Activities', unit: 'currency' },
    ]
  },
  {
    name: 'Ratios & margins', ratios: [
      { key: 'Price-to-Book Value', unit: 'multiple' },
      { key: 'Debt-to-Equity', unit: 'percent' },
      { key: 'Dividend Yield', unit: 'percent' },
      { key: 'Dividend Payout', unit: 'percent' },
      { key: 'Return on Equity (ROE)', unit: 'percent' },
      { key: 'Return on Assets (ROA)', unit: 'percent' },
    ]
  },
  {
    name: 'Other', ratios: [
      { key: 'Market Price (Closing)', unit: 'per_share' },

    ]
  },
];

const UNIT_LABEL = {
  currency: 'Rs. Mn',
  per_share: 'Rs. / share',
  percent: '%',
  multiple: 'x (times)'
};

const DEFAULT_SELECTED = ['Revenue', 'Profit After Tax (PAT)'];

// Fixed categorical palette, cycled if more ratios are selected than colors
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#d5518a', '#008300', '#7a68d6', '#e34948'];
const DASH_PATTERNS = [[], [6, 3], [2, 2], [8, 3, 2, 3], [1, 3], [4, 4, 1, 4]];

/* ============================================================
   STATE
   ============================================================ */
let state = {
  companyId: CONFIG.companies[0]?.id,
  period: 'annual',       // 'annual' | 'quarterly'
  quarterFilter: 'all',
  chartType: 'line',
  selected: new Set(DEFAULT_SELECTED),
  annualData: null,       // { periods:[...], rows: Map(ratioName -> {values:[...], raw:[...]}) }
  quarterlyData: null,
};

let chartInstance = null;

/* ============================================================
   DATA FETCH + PARSE
   ============================================================ */
function sheetCsvUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

async function fetchSheet(sheetName) {
  let res;
  try {
    res = await fetch(sheetCsvUrl(sheetName));
  } catch (networkErr) {
    throw new Error(
      `Network request blocked while loading "${sheetName}". This usually happens when the page is opened ` +
      `directly as a file:// URL. Serve the folder with "python3 -m http.server 8000" and open ` +
      `http://localhost:8000 instead — see README.md. (Underlying error: ${networkErr.message})`
    );
  }
  if (!res.ok) throw new Error(`Could not load tab "${sheetName}" (HTTP ${res.status}). Check the tab name and sharing settings.`);
  const csvText = await res.text();
  const parsed = Papa.parse(csvText.trim(), { skipEmptyLines: true });
  const rows = parsed.data;
  if (!rows.length) throw new Error(`Tab "${sheetName}" appears to be empty.`);

  const header = rows[0];
  const periods = header.slice(1).map(p => p.trim()).filter(p => p.length);
  const dataRows = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[0] || '').trim();
    if (!name) continue;
    const raw = row.slice(1, periods.length + 1);
    dataRows.set(name, raw);
  }
  return { periods, rows: dataRows };
}

function parseCellValue(rawText, unit) {
  if (rawText === undefined || rawText === null) return null;
  const text = String(rawText).trim();
  if (!text) return null;
  if (/not in source/i.test(text) || /^n\/?a$/i.test(text) || text === '-') return null;

  if (unit === 'currency') {
    // Prefer an explicit "... Mn" figure if present
    const mnMatch = text.match(/(\(?-?[\d,]+\.?\d*\)?)\s*mn/i);
    if (mnMatch) {
      const negative = mnMatch[1].includes('(');
      const num = parseFloat(mnMatch[1].replace(/[(),]/g, ''));
      return negative ? -Math.abs(num) : num;
    }
    // Otherwise treat the first number found as raw rupees and convert to Mn
    const rawMatch = text.match(/(\(?-?[\d,]+\.?\d*\)?)/);
    if (rawMatch) {
      const negative = rawMatch[1].includes('(');
      const num = parseFloat(rawMatch[1].replace(/[(),]/g, ''));
      return (negative ? -Math.abs(num) : num) / 1_000_000;
    }
    return null;
  }

  // per_share, percent, multiple: take the first numeric token in the string
  const numMatch = text.match(/-?[\d,]+\.?\d*/);
  if (!numMatch) return null;
  return parseFloat(numMatch[0].replace(/,/g, ''));
}

/* ============================================================
   PERIOD HELPERS (for sorting + quarter filtering)
   ============================================================ */
function parseQuarterLabel(label) {
  const m = label.match(/^Q([1-4])\s+(\d{2})\/(\d{2})$/i);
  if (!m) return null;
  return { quarter: parseInt(m[1], 10), yearStart: parseInt(m[2], 10) };
}

function sortKeyForPeriod(label, index) {
  const q = parseQuarterLabel(label);
  if (q) return q.yearStart * 4 + q.quarter;
  return index; // annual labels: keep sheet order
}

/* ============================================================
   RENDER: SIDEBAR RATIO CHECKLIST
   ============================================================ */
function buildRatioSidebar() {
  const wrap = document.getElementById('ratioGroups');
  wrap.innerHTML = '';
  let colorIdx = 0;
  const colorMap = new Map();
  RATIO_GROUPS.forEach(g => g.ratios.forEach(r => {
    colorMap.set(r.key, PALETTE[colorIdx % PALETTE.length]);
    colorIdx++;
  }));
  window.__ratioColorMap = colorMap;

  RATIO_GROUPS.forEach(group => {
    const details = document.createElement('details');
    details.className = 'ratio-group';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = group.name;
    details.appendChild(summary);

    group.ratios.forEach(r => {
      const row = document.createElement('div');
      row.className = 'ratio-row';
      const id = 'chk-' + r.key.replace(/\W+/g, '-');
      row.innerHTML = `
        <input type="checkbox" id="${id}" ${state.selected.has(r.key) ? 'checked' : ''}>
        <span class="swatch" style="background:${colorMap.get(r.key)}"></span>
        <label for="${id}">${r.key}</label>
        <span class="unit-tag">${UNIT_LABEL[r.unit]}</span>
      `;
      const checkbox = row.querySelector('input');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selected.add(r.key); else state.selected.delete(r.key);
        render();
      });
      details.appendChild(row);
    });
    wrap.appendChild(details);
  });
}

function ratioUnit(key) {
  for (const g of RATIO_GROUPS) for (const r of g.ratios) if (r.key === key) return r.unit;
  return 'currency';
}

/* ============================================================
   MAIN RENDER
   ============================================================ */
function currentDataset() {
  return state.period === 'annual' ? state.annualData : state.quarterlyData;
}

function getVisiblePeriods(dataset) {
  if (!dataset) return [];
  let periods = dataset.periods.map((label, index) => ({ label, index }));
  if (state.period === 'quarterly' && state.quarterFilter !== 'all') {
    periods = periods.filter(p => p.label.toUpperCase().startsWith(state.quarterFilter));
  }
  periods.sort((a, b) => sortKeyForPeriod(a.label, a.index) - sortKeyForPeriod(b.label, b.index));
  return periods;
}

function render() {
  const dataset = currentDataset();
  const emptyState = document.getElementById('emptyState');
  const chartWrap = document.getElementById('chartWrap');
  const legendEl = document.getElementById('chartLegend');

  if (!dataset) {
    emptyState.style.display = 'block';
    emptyState.textContent = state.period === 'quarterly'
      ? 'No quarterly data found yet for this company. Add a tab named as configured in CONFIG, then reload.'
      : 'No data loaded.';
    chartWrap.style.display = 'none';
    legendEl.innerHTML = '';
    document.getElementById('dataTable').innerHTML = '';
    return;
  }

  const periods = getVisiblePeriods(dataset);
  const selectedRatios = [...state.selected].filter(key => dataset.rows.has(key));

  if (!selectedRatios.length) {
    emptyState.style.display = 'block';
    emptyState.textContent = 'Select one or more ratios from the sidebar to see a chart.';
    chartWrap.style.display = 'none';
    legendEl.innerHTML = '';
    buildTable(dataset, periods, []);
    return;
  }

  emptyState.style.display = 'none';
  chartWrap.style.display = 'block';

  // Build datasets + figure out which unit groups are in play
  const unitsUsed = [];
  const datasets = selectedRatios.map((key, i) => {
    const unit = ratioUnit(key);
    if (!unitsUsed.includes(unit)) unitsUsed.push(unit);
    const raw = dataset.rows.get(key) || [];
    const data = periods.map(p => parseCellValue(raw[p.index], unit));
    const color = window.__ratioColorMap.get(key) || PALETTE[i % PALETTE.length];
    const dash = DASH_PATTERNS[i % DASH_PATTERNS.length];
    return {
      label: key,
      data,
      unit,
      yAxisID: 'y-' + unit,
      borderColor: color,
      backgroundColor: state.chartType === 'bar' ? color : color,
      borderWidth: 2,
      borderDash: state.chartType === 'line' ? dash : undefined,
      pointRadius: state.chartType === 'line' ? 3 : 0,
      pointBackgroundColor: color,
      spanGaps: false,
      borderRadius: state.chartType === 'bar' ? 3 : 0,
      maxBarThickness: 34,
    };
  });

  // custom legend
  legendEl.innerHTML = selectedRatios.map((key, i) => {
    const color = window.__ratioColorMap.get(key) || PALETTE[i % PALETTE.length];
    return `<span><span class="swatch" style="background:${color}"></span>${key} <span class="unit-tag">(${UNIT_LABEL[ratioUnit(key)]})</span></span>`;
  }).join('');

  // Build y-axes: first two units get a visible axis (left/right), rest are invisible scales
  const scales = {
    x: { grid: { display: false }, ticks: { color: '#8a8d96' } }
  };
  unitsUsed.forEach((unit, i) => {
    scales['y-' + unit] = {
      type: 'linear',
      position: i === 0 ? 'left' : 'right',
      display: i < 2,
      title: i < 2 ? { display: true, text: UNIT_LABEL[unit] } : undefined,
      grid: { drawOnChartArea: i === 0, color: '#e1e3e8' },
      ticks: { color: '#8a8d96' }
    };
  });

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(document.getElementById('ratioChart'), {
    type: state.chartType,
    data: { labels: periods.map(p => p.label), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              if (v === null || v === undefined) return `${ctx.dataset.label}: n/a`;
              return `${ctx.dataset.label}: ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${UNIT_LABEL[ctx.dataset.unit]}`;
            }
          }
        }
      },
      scales
    }
  });

  buildTable(dataset, periods, selectedRatios);
}

function buildTable(dataset, periods, selectedRatios) {
  const table = document.getElementById('dataTable');
  if (!selectedRatios.length || !periods.length) { table.innerHTML = ''; return; }

  let html = '<thead><tr><th>Ratio</th>' + periods.map(p => `<th>${p.label}</th>`).join('') + '</tr></thead><tbody>';
  selectedRatios.forEach(key => {
    const unit = ratioUnit(key);
    const raw = dataset.rows.get(key) || [];
    html += `<tr><td>${key}</td>`;
    periods.forEach(p => {
      const v = parseCellValue(raw[p.index], unit);
      const rawText = (raw[p.index] || '').trim();
      if (v === null) {
        html += `<td class="na" title="${rawText.replace(/"/g, '&quot;')}">n/a</td>`;
      } else {
        html += `<td title="${rawText.replace(/"/g, '&quot;')}">${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;
}

/* ============================================================
   DATA LOADING
   ============================================================ */
async function loadCompanyData() {
  const status = document.getElementById('status');
  const company = CONFIG.companies.find(c => c.id === state.companyId);
  if (!company) { status.textContent = 'No company configured.'; status.className = 'error'; return; }

  status.className = '';
  status.textContent = 'Loading…';
  state.annualData = null;
  state.quarterlyData = null;

  try {
    state.annualData = await fetchSheet(company.annualSheet);
  } catch (e) {
    status.className = 'error';
    status.textContent = 'Annual data error: ' + e.message;
  }

  try {
    state.quarterlyData = await fetchSheet(company.quarterlySheet);
  } catch (e) {
    // quarterly tab is optional — stay quiet unless the user switches to it
    state.quarterlyData = null;
  }

  if (state.annualData && !document.getElementById('status').classList.contains('error')) {
    status.textContent = 'Loaded ' + new Date().toLocaleTimeString();
  }
  render();
}

/* ============================================================
   WIRE UP CONTROLS
   ============================================================ */
function initControls() {
  const companySelect = document.getElementById('companySelect');
  companySelect.innerHTML = CONFIG.companies.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  companySelect.value = state.companyId;
  companySelect.addEventListener('change', () => {
    state.companyId = companySelect.value;
    loadCompanyData();
  });

  document.getElementById('reloadBtn').addEventListener('click', loadCompanyData);

  document.querySelectorAll('#periodSeg button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#periodSeg button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.period = btn.dataset.period;
      document.getElementById('quarterFilterWrap').classList.toggle('show', state.period === 'quarterly');
      render();
    });
  });

  document.getElementById('quarterFilter').addEventListener('change', (e) => {
    state.quarterFilter = e.target.value;
    render();
  });

  document.querySelectorAll('#chartTypeSeg button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#chartTypeSeg button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chartType = btn.dataset.chart;
      render();
    });
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    state.selected.clear();
    document.querySelectorAll('.ratio-row input[type=checkbox]').forEach(c => c.checked = false);
    render();
  });

  document.getElementById('defaultBtn').addEventListener('click', () => {
    state.selected = new Set(DEFAULT_SELECTED);
    document.querySelectorAll('.ratio-row input[type=checkbox]').forEach(c => {
      const label = c.nextElementSibling.nextElementSibling.textContent;
      c.checked = state.selected.has(label);
    });
    render();
  });
}

/* ============================================================
   INIT
   ============================================================ */
buildRatioSidebar();
initControls();
loadCompanyData();