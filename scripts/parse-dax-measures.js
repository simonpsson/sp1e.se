#!/usr/bin/env node
/**
 * parse-dax-measures.js
 *
 * Reads hemfrid_dax_measures.md → writes functions/api/_dax-data.ts
 *
 * Structure expected in the markdown:
 *   ## N. CATEGORY NAME        ← sets current subcategory
 *   ```dax
 *   // === SNIPPET TITLE ===   ← first line of code block is the title comment
 *   DAX code...
 *   ```
 *
 * Each ```dax block becomes one snippet.
 * Title is extracted from the first `// === ... ===` comment.
 * If no title comment, falls back to "Category heading (N)".
 *
 * Usage:
 *   node scripts/parse-dax-measures.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC  = path.join(ROOT, 'hemfrid_dax_measures.md');
const OUT  = path.join(ROOT, 'functions', 'api', '_dax-data.ts');

if (!fs.existsSync(SRC)) {
  console.error('ERROR: hemfrid_dax_measures.md not found at repo root.');
  process.exit(1);
}

// Subcategory mapping: fragment of lowercased H2 heading → subcategory id
const SUBCAT_MAP = [
  { keys: ['revenue', 'financial'],          id: 'pb-revenue'   },
  { keys: ['orders', 'bookings'],            id: 'pb-orders'    },
  { keys: ['customer'],                      id: 'pb-customers' },
  { keys: ['workforce', 'operations'],       id: 'pb-workforce' },
  { keys: ['geographic'],                    id: 'pb-geo'       },
  { keys: ['rut'],                           id: 'pb-rut'       },
  { keys: ['seasonal', 'trend'],             id: 'pb-seasonal'  },
  { keys: ['marketing', 'acquisition'],      id: 'pb-marketing' },
  { keys: ['quality', 'complaint'],          id: 'pb-quality'   },
  { keys: ['forecast', 'target'],            id: 'pb-forecast'  },
  { keys: ['ranking', 'comparative'],        id: 'pb-ranking'   },
  { keys: ['helper', 'utility'],             id: 'pb-utility'   },
];

// Default tags per subcategory
const TAGS_MAP = {
  'pb-revenue':   ['dax', 'revenue', 'kpi', 'hemfrid'],
  'pb-orders':    ['dax', 'orders', 'bookings', 'hemfrid'],
  'pb-customers': ['dax', 'customers', 'retention', 'hemfrid'],
  'pb-workforce': ['dax', 'workforce', 'operations', 'hemfrid'],
  'pb-geo':       ['dax', 'geographic', 'region', 'hemfrid'],
  'pb-rut':       ['dax', 'rut', 'rut-avdrag', 'hemfrid'],
  'pb-seasonal':  ['dax', 'seasonal', 'trend', 'hemfrid'],
  'pb-marketing': ['dax', 'marketing', 'acquisition', 'hemfrid'],
  'pb-quality':   ['dax', 'quality', 'complaints', 'hemfrid'],
  'pb-forecast':  ['dax', 'forecast', 'targets', 'hemfrid'],
  'pb-ranking':   ['dax', 'ranking', 'comparative', 'hemfrid'],
  'pb-utility':   ['dax', 'utility', 'helper', 'hemfrid'],
};

function resolveSubcat(heading) {
  const lower = heading.toLowerCase();
  for (const { keys, id } of SUBCAT_MAP) {
    if (keys.some(k => lower.includes(k))) return id;
  }
  return null;
}

// Extract title from the first `// === TITLE ===` comment in a code block.
// Returns null if no such comment exists.
function extractTitleFromCode(codeLines) {
  for (const line of codeLines) {
    const m = line.match(/^\/\/\s*={2,}\s*(.+?)\s*={0,}\s*$/);
    if (m) {
      // Capitalise first letter of each word, keep rest lowercase-ish
      return m[1].trim()
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
        // Restore common acronyms
        .replace(/\bYoy\b/gi, 'YoY')
        .replace(/\bMom\b/gi, 'MoM')
        .replace(/\bYtd\b/gi, 'YTD')
        .replace(/\bMtd\b/gi, 'MTD')
        .replace(/\bQtd\b/gi, 'QTD')
        .replace(/\bCagr\b/gi, 'CAGR')
        .replace(/\bRut\b/gi, 'RUT')
        .replace(/\bKpi\b/gi, 'KPI')
        .replace(/\bNps\b/gi, 'NPS');
    }
  }
  return null;
}

// Description map keyed by title fragment (lowercase)
const DESC_MAP = {
  'grundläggande':  'Grundläggande intäktsmått: Total Revenue, AOV, Gross Margin, EBITDA, kostnader',
  'tjänstetyp':     'Intäktsuppdelning per tjänst: Hemstäd, Kontorsstäd, Flyttstäd, Fönsterputs, etc.',
  'tidsintelligens':'Tidsintelligens: Year-over-Year, Month-over-Month, YTD, Rolling averages, CAGR',
  'orders':         'Ordermått: completion/cancellation rate, recurring orders, first-time vs repeat, lead time',
  'kundanalys':     'Kundmått: new/returning, retention, churn, CLV, cross-sell, top 10%',
  'kundsegmentering':'Segmentering: At Risk, Lost, VIP/Loyal/Active/New, NPS, churn risk',
  'workforce':      'Personal och drift: revenue per anställd, utilization, sjukfrånvaro, on-time rate',
  'geografisk':     'Regionmått: marknadsandel, revenue per capita, regional ranking, growth by area',
  'rut':            'RUT-avdrag: RUT-andel, utrymme kvar, kunder nära tak (75 000 kr)',
  'säsong':         'Säsongsmönster: seasonality index, holiday impact, summer dip, trend direction',
  'marketing':      'Marknadsföring: CAC, Marketing ROI, conversion rate, payback period, channel performance',
  'kvalitet':       'Kvalitetsmått: redo rate, klagomålshantering, resolution time, service quality score',
  'forecasting':    'Prognos: target achievement, run rate, projected year-end, gap to target',
  'comparative':    'Jämförelser: RANKX, percentiler, Pareto 80/20, index vs average, best month ever',
  'helper':         'Hjälpmått: data freshness, formatting, conditional formatting values, KPI-pilar',
};

function resolveDesc(title) {
  const lower = title.toLowerCase();
  for (const [key, desc] of Object.entries(DESC_MAP)) {
    if (lower.includes(key)) return desc;
  }
  return null;
}

// ── Parse ────────────────────────────────────────────
const src    = fs.readFileSync(SRC, 'utf8');
const lines  = src.split('\n');
const output = [];

let currentSubcat   = null;
let currentCategory = '';
let catBlockIdx     = 0;   // count of code blocks within current category
let inCode          = false;
let codeLines       = [];

function flushBlock() {
  if (!codeLines.length || !currentSubcat) { codeLines = []; return; }

  const title  = extractTitleFromCode(codeLines)
    ?? (catBlockIdx > 1 ? `${currentCategory} (${catBlockIdx})` : currentCategory);
  const code   = codeLines.join('\n').trimEnd();

  output.push({
    title,
    language:       'dax',
    code,
    description:    resolveDesc(title),
    subcategory_id: currentSubcat,
    tags:           TAGS_MAP[currentSubcat] ?? ['dax', 'hemfrid'],
  });

  codeLines = [];
}

for (const line of lines) {
  // H2 → new category
  if (/^## /.test(line) && !inCode) {
    flushBlock();
    const heading = line.replace(/^##\s+\d*\.?\s*/, '');
    currentSubcat   = resolveSubcat(heading);
    currentCategory = heading.split(/\s+/).slice(0, 4).join(' '); // short label
    catBlockIdx     = 0;
    continue;
  }

  // Code fence open
  if (/^```dax/.test(line) && !inCode) {
    inCode      = true;
    codeLines   = [];
    continue;
  }

  // Code fence close
  if (line.startsWith('```') && inCode) {
    inCode = false;
    catBlockIdx++;
    flushBlock();
    continue;
  }

  if (inCode) {
    codeLines.push(line);
  }
}

flushBlock(); // safety

// ── Emit TypeScript ──────────────────────────────────
function escape(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

const entries = output.map(s => {
  const desc = s.description ? JSON.stringify(s.description) : 'null';
  return `  {
    title:          ${JSON.stringify(s.title)},
    language:       "dax",
    code:           \`${escape(s.code)}\`,
    description:    ${desc},
    subcategory_id: ${JSON.stringify(s.subcategory_id)},
    tags:           ${JSON.stringify(s.tags)},
  }`;
}).join(',\n');

const ts = `/**
 * DAX measures data — AUTO-GENERATED by scripts/parse-dax-measures.js
 * Source: hemfrid_dax_measures.md
 * DO NOT EDIT MANUALLY — re-run the script to regenerate.
 */

export interface DaxMeasure {
  title:          string;
  language:       string;
  code:           string;
  description:    string | null;
  subcategory_id: string;
  tags:           string[];
}

export const DAX_MEASURES: DaxMeasure[] = [
${entries}
];
`;

fs.writeFileSync(OUT, ts);

// ── Summary ───────────────────────────────────────────
console.log(`\nWrote ${output.length} snippets to functions/api/_dax-data.ts\n`);
const byCat = {};
for (const s of output) byCat[s.subcategory_id] = (byCat[s.subcategory_id] ?? 0) + 1;
for (const [cat, n] of Object.entries(byCat)) {
  console.log(`  ${cat.padEnd(16)} ${n} snippet(s)  — "${output.find(s => s.subcategory_id === cat)?.title}"`);
}
console.log('');
