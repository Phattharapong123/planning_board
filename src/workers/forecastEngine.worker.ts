// ── Forecast Import Engine — Web Worker ──────────────────────────────────────
// Fixed column positions (0-indexed). No header row in source data.
//
// Col  0  Item No        → ignore
// Col  1  Status         → ignore
// Col  2  UNC Code       → REQUIRED
// Col  3  Part Ref       → ignore
// Col  4  Customer       → REQUIRED
// Col  5  Customer Part  → ignore
// Col  6  P/O            → ignore
// Col  7  Due Date       → REQUIRED
// Col  8  Due Time       → ignore
// Col  9  Order Date     → ignore
// Col 10  Order Qty      → REQUIRED
// Col 11+ …              → ignore

const UNC_COL  = 2;
const CUST_COL = 4;
const DATE_COL = 7;
const QTY_COL  = 10;
const MIN_COLS = QTY_COL + 1;  // row must have at least 11 columns

const MONTHS: Record<string, number> = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
  jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
};

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDate(s: string): string | null {
  if (!s?.trim()) return null;
  const str = s.trim();

  // ISO: 2026-07-01
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD/MM/YYYY or DD-MM-YYYY (Thai/European format used in ERP)
  const slash = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    const d = parseInt(slash[1]), m = parseInt(slash[2]) - 1;
    const y = slash[3].length === 2 ? 2000 + parseInt(slash[3]) : parseInt(slash[3]);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : toISO(y, m, d);
  }

  // DD-Mon-YY(YY): "29-Jul-26", "29-Jul-2026", "1-Jul-26"
  const monD = str.match(/^(\d{1,2})[\-\/ ]([A-Za-z]{3,})[\-\/ ](\d{2,4})$/);
  if (monD) {
    const mon = MONTHS[monD[2].toLowerCase().slice(0, 3)];
    if (mon === undefined) return null;
    const d = parseInt(monD[1]);
    const y = parseInt(monD[3]) < 100 ? 2000 + parseInt(monD[3]) : parseInt(monD[3]);
    return toISO(y, mon, d);
  }

  // Mon-DD or Mon DD (e.g. "Jul 01", "Jul-01")
  const monFirst = str.match(/^([A-Za-z]{3,})[\-\/ ](\d{1,2})(?:[\-\/ ](\d{2,4}))?$/);
  if (monFirst) {
    const mon = MONTHS[monFirst[1].toLowerCase().slice(0, 3)];
    if (mon === undefined) return null;
    const d = parseInt(monFirst[2]);
    const y = monFirst[3]
      ? (parseInt(monFirst[3]) < 100 ? 2000 + parseInt(monFirst[3]) : parseInt(monFirst[3]))
      : new Date().getFullYear();
    return toISO(y, mon, d);
  }

  return null;
}

// ── Main handler ──────────────────────────────────────────────────────────────
self.onmessage = function (e: MessageEvent<{ tsv: string }>) {
  const { tsv } = e.data;

  const lines = tsv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  if (!lines.length) {
    self.postMessage({ success: false, error: 'No data found.' });
    return;
  }

  // Detect separator from first non-empty line
  const firstLine = lines.find(l => l.trim());
  if (!firstLine) {
    self.postMessage({ success: false, error: 'Empty paste.' });
    return;
  }
  const sep = firstLine.includes('\t') ? '\t' : ',';

  // ── Build both indexes in ONE pass — no header row ────────────────────────
  // INDEX 1: ForecastByCustomer  Map<UNC, Map<Customer, Map<DateISO, Qty>>>
  const byCustomer   = new Map<string, Map<string, Map<string, number>>>();
  // INDEX 2: ForecastAllCustomers Map<UNC, Map<DateISO, Qty>>
  const allCustomers = new Map<string, Map<string, number>>();

  const previewRows: Array<{ unc: string; customer: string; date: string; qty: number }> = [];

  let rowCount     = 0;
  let skippedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));

    // Must have at least 11 columns
    if (cells.length < MIN_COLS) { skippedCount++; continue; }

    const unc     = cells[UNC_COL].trim().toUpperCase();
    const cust    = cells[CUST_COL].trim().toUpperCase() || 'UNKNOWN';
    const dateRaw = cells[DATE_COL].trim();
    const qtyRaw  = cells[QTY_COL].trim().replace(/,/g, '');

    if (!unc) { skippedCount++; continue; }

    const dateISO = parseDate(dateRaw);
    if (!dateISO) { skippedCount++; continue; }

    const qty = parseFloat(qtyRaw);
    if (isNaN(qty) || qty <= 0) { skippedCount++; continue; }

    // ── Update INDEX 1: ForecastByCustomer ───────────────────────────────────
    if (!byCustomer.has(unc)) byCustomer.set(unc, new Map());
    const custMap = byCustomer.get(unc)!;
    if (!custMap.has(cust)) custMap.set(cust, new Map());
    const dm1 = custMap.get(cust)!;
    dm1.set(dateISO, (dm1.get(dateISO) ?? 0) + qty);

    // ── Update INDEX 2: ForecastAllCustomers (same pass) ─────────────────────
    if (!allCustomers.has(unc)) allCustomers.set(unc, new Map());
    const dm2 = allCustomers.get(unc)!;
    dm2.set(dateISO, (dm2.get(dateISO) ?? 0) + qty);

    rowCount++;
    if (previewRows.length < 200) previewRows.push({ unc, customer: cust, date: dateISO, qty });
  }

  if (rowCount === 0) {
    self.postMessage({
      success: false,
      error:
        `No valid rows processed. ` +
        `Expected: Col 3=UNC Code, Col 5=Customer, Col 8=Due Date (DD/MM/YYYY), Col 11=Order Qty. ` +
        `Skipped ${skippedCount} rows. Sample: ${firstLine.slice(0, 120)}`,
    });
    return;
  }

  self.postMessage({
    success:      true,
    byCustomer,
    allCustomers,
    rowCount,
    skippedCount,
    previewRows,
  });
};
