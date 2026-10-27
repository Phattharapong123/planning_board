import {
  useState, useRef, useCallback, useEffect, useMemo,
} from 'react';
import {
  Upload, ClipboardPaste, Trash2, RefreshCw, Check,
  AlertTriangle, Zap, ArrowRight, Database, Users, Hash,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useForecast, ForecastByCustomerMap, ForecastAllCustomersMap } from '../contexts/ForecastContext';

// ── Types ─────────────────────────────────────────────────────────────────────
interface PreviewRow { unc: string; customer: string; date: string; qty: number }

interface EngineResult {
  byCustomer:   ForecastByCustomerMap;
  allCustomers: ForecastAllCustomersMap;
  rowCount:     number;
  skippedCount: number;
  previewRows:  PreviewRow[];
}

type EngineState = 'idle' | 'parsing' | 'ready' | 'updating' | 'success' | 'error';

// ── Fixed column positions (0-indexed, no header row) ─────────────────────────
const UNC_COL  = 2;   // UNC Code
const CUST_COL = 4;   // Customer
const DATE_COL = 7;   // Due Date
const QTY_COL  = 10;  // Order Qty
const MIN_COLS = QTY_COL + 1;

// ── Date parser ───────────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
};

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDate(s: string): string | null {
  if (!s?.trim()) return null;
  const str = s.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const slash = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    const d = parseInt(slash[1]), m = parseInt(slash[2]) - 1;
    const y = slash[3].length === 2 ? 2000 + parseInt(slash[3]) : parseInt(slash[3]);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : toISO(y, m, d);
  }

  const monD = str.match(/^(\d{1,2})[\-\/ ]([A-Za-z]{3,})[\-\/ ](\d{2,4})$/);
  if (monD) {
    const mon = MONTHS[monD[2].toLowerCase().slice(0, 3)];
    if (mon === undefined) return null;
    const d = parseInt(monD[1]);
    const y = parseInt(monD[3]) < 100 ? 2000 + parseInt(monD[3]) : parseInt(monD[3]);
    return toISO(y, mon, d);
  }

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

// ── Core parser (main thread) ─────────────────────────────────────────────────
function parseForecastData(tsv: string): { ok: true } & EngineResult | { ok: false; error: string } {
  const lines = tsv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const firstLine = lines.find(l => l.trim());
  if (!firstLine) return { ok: false, error: 'Empty paste.' };

  const sep = firstLine.includes('\t') ? '\t' : ',';

  const byCustomer   = new Map<string, Map<string, Map<string, number>>>();
  const allCustomers = new Map<string, Map<string, number>>();
  const previewRows: PreviewRow[] = [];
  let rowCount = 0, skippedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
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

    // INDEX 1: ForecastByCustomer
    if (!byCustomer.has(unc)) byCustomer.set(unc, new Map());
    const custMap = byCustomer.get(unc)!;
    if (!custMap.has(cust)) custMap.set(cust, new Map());
    const dm1 = custMap.get(cust)!;
    dm1.set(dateISO, (dm1.get(dateISO) ?? 0) + qty);

    // INDEX 2: ForecastAllCustomers (same pass)
    if (!allCustomers.has(unc)) allCustomers.set(unc, new Map());
    const dm2 = allCustomers.get(unc)!;
    dm2.set(dateISO, (dm2.get(dateISO) ?? 0) + qty);

    rowCount++;
    if (previewRows.length < 200) previewRows.push({ unc, customer: cust, date: dateISO, qty });
  }

  if (rowCount === 0) {
    return {
      ok: false,
      error:
        `No valid rows found. Expected: Col 3=UNC Code, Col 5=Customer, ` +
        `Col 8=Due Date (DD/MM/YYYY), Col 11=Order Qty. ` +
        `${skippedCount} rows skipped. Sample: ${firstLine.slice(0, 120)}`,
    };
  }

  return { ok: true, byCustomer, allCustomers, rowCount, skippedCount, previewRows };
}

// ── Constants ─────────────────────────────────────────────────────────────────
const ROW_H    = 28;
const BUFFER   = 8;
const COL_W_ROW = 46;
const COL_W_UNC = 100;
const COL_W_STD = 110;
const COL_W_QTY = 80;

// ── Formatters ────────────────────────────────────────────────────────────────
function formatDateShort(iso: string): string {
  const [, m, d] = iso.split('-');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)}/${mo[parseInt(m) - 1]}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

// ── Virtual-scrolled preview grid ─────────────────────────────────────────────
function PreviewGrid({ rows, dark }: { rows: PreviewRow[]; dark: boolean }) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerH = 400;
  const tableW = COL_W_ROW + COL_W_UNC + COL_W_STD + COL_W_STD + COL_W_QTY;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const endIdx   = Math.min(rows.length, Math.ceil((scrollTop + containerH) / ROW_H) + BUFFER);
  const visible  = rows.slice(startIdx, endIdx);

  const bd = dark ? 'border-gray-700' : 'border-gray-200';
  const hd = dark ? 'bg-gray-800 text-gray-300' : 'bg-gray-50 text-gray-600';
  const rowEven  = dark ? 'bg-gray-900' : 'bg-white';
  const rowOdd   = dark ? 'bg-gray-800/40' : 'bg-gray-50/60';
  const stickyBg = dark ? 'bg-gray-900' : 'bg-white';

  return (
    <div
      className={`overflow-auto border rounded-xl ${bd}`}
      style={{ height: containerH }}
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ minWidth: tableW }}>
        <table className="border-collapse text-[11px] w-full" style={{ tableLayout: 'fixed', width: tableW }}>
          <colgroup>
            <col style={{ width: COL_W_ROW }} />
            <col style={{ width: COL_W_UNC }} />
            <col style={{ width: COL_W_STD }} />
            <col style={{ width: COL_W_STD }} />
            <col style={{ width: COL_W_QTY }} />
          </colgroup>
          <thead>
            <tr>
              {['#', 'UNC Code', 'Customer', 'Due Date', 'Order Qty'].map((h, i) => (
                <th key={h}
                  className={`sticky top-0 text-center border-r border-b px-1 py-1.5 font-bold whitespace-nowrap ${hd} ${bd}`}
                  style={{ height: ROW_H, zIndex: i <= 1 ? 30 - i * 10 : 10, left: i === 0 ? 0 : i === 1 ? COL_W_ROW : undefined }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {startIdx > 0 && <tr style={{ height: startIdx * ROW_H }}><td colSpan={5} /></tr>}
            {visible.map((row, vi) => {
              const idx = startIdx + vi;
              const bg  = idx % 2 === 0 ? rowEven : rowOdd;
              return (
                <tr key={idx} className={bg} style={{ height: ROW_H }}>
                  <td className={`sticky left-0 z-10 text-center border-r border-b px-1 font-mono tabular-nums ${stickyBg} ${bd} ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{idx + 1}</td>
                  <td className={`sticky border-r border-b px-2 font-bold text-[#F36B21] truncate ${stickyBg} ${bd}`} style={{ left: COL_W_ROW }}>{row.unc}</td>
                  <td className={`border-r border-b px-2 truncate ${bd} ${dark ? 'text-blue-300' : 'text-blue-700'}`}>{row.customer}</td>
                  <td className={`border-r border-b px-2 tabular-nums ${bd} ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{formatDateShort(row.date)}</td>
                  <td className={`border-r border-b px-2 text-right font-semibold tabular-nums ${bd} ${dark ? 'text-green-300' : 'text-green-700'}`}>{row.qty.toLocaleString()}</td>
                </tr>
              );
            })}
            {endIdx < rows.length && <tr style={{ height: (rows.length - endIdx) * ROW_H }}><td colSpan={5} /></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── ByCustomer summary ────────────────────────────────────────────────────────
function ByCustomerTable({ byCustomer, dark }: { byCustomer: ForecastByCustomerMap; dark: boolean }) {
  const rows = useMemo(() => {
    const out: Array<{ unc: string; customer: string; dates: number; total: number }> = [];
    for (const [unc, custMap] of byCustomer) {
      for (const [cust, dateMap] of custMap) {
        let total = 0;
        for (const q of dateMap.values()) total += q;
        out.push({ unc, customer: cust, dates: dateMap.size, total });
      }
    }
    return out.sort((a, b) => a.unc.localeCompare(b.unc) || a.customer.localeCompare(b.customer));
  }, [byCustomer]);

  const [scrollTop, setScrollTop] = useState(0);
  const containerH = 400;
  const startIdx   = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const endIdx     = Math.min(rows.length, Math.ceil((scrollTop + containerH) / ROW_H) + BUFFER);
  const visible    = rows.slice(startIdx, endIdx);
  const tableW     = COL_W_ROW + COL_W_UNC + COL_W_STD + 70 + 100;
  const bd = dark ? 'border-gray-700' : 'border-gray-200';
  const hd = dark ? 'bg-gray-800 text-gray-300' : 'bg-gray-50 text-gray-600';

  return (
    <div className={`overflow-auto border rounded-xl ${bd}`} style={{ height: containerH }}
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ minWidth: tableW }}>
        <table className="border-collapse text-[11px] w-full" style={{ tableLayout: 'fixed', width: tableW }}>
          <colgroup>
            <col style={{ width: COL_W_ROW }} /><col style={{ width: COL_W_UNC }} />
            <col style={{ width: COL_W_STD }} /><col style={{ width: 70 }} /><col style={{ width: 100 }} />
          </colgroup>
          <thead>
            <tr>
              {['#', 'UNC Code', 'Customer', 'Dates', 'Total Qty'].map(h => (
                <th key={h} className={`sticky top-0 z-10 text-center border-r border-b px-1 py-1.5 font-bold ${hd} ${bd}`} style={{ height: ROW_H }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {startIdx > 0 && <tr style={{ height: startIdx * ROW_H }}><td colSpan={5} /></tr>}
            {visible.map((row, vi) => {
              const idx = startIdx + vi;
              const bg = idx % 2 === 0 ? (dark ? 'bg-gray-900' : 'bg-white') : (dark ? 'bg-gray-800/40' : 'bg-gray-50/60');
              return (
                <tr key={idx} className={bg} style={{ height: ROW_H }}>
                  <td className={`text-center border-r border-b px-1 font-mono tabular-nums ${bd} ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{idx + 1}</td>
                  <td className={`border-r border-b px-2 font-bold text-[#F36B21] ${bd}`}>{row.unc}</td>
                  <td className={`border-r border-b px-2 ${bd} ${dark ? 'text-blue-300' : 'text-blue-700'}`}>{row.customer}</td>
                  <td className={`border-r border-b px-2 text-center tabular-nums ${bd} ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{row.dates}</td>
                  <td className={`border-r border-b px-2 text-right font-semibold tabular-nums ${bd} ${dark ? 'text-green-300' : 'text-green-700'}`}>{row.total.toLocaleString()}</td>
                </tr>
              );
            })}
            {endIdx < rows.length && <tr style={{ height: (rows.length - endIdx) * ROW_H }}><td colSpan={5} /></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── AllCustomers summary ──────────────────────────────────────────────────────
function AllCustomersTable({ allCustomers, dark }: { allCustomers: ForecastAllCustomersMap; dark: boolean }) {
  const rows = useMemo(() => {
    const out: Array<{ unc: string; dates: number; total: number }> = [];
    for (const [unc, dateMap] of allCustomers) {
      let total = 0;
      for (const q of dateMap.values()) total += q;
      out.push({ unc, dates: dateMap.size, total });
    }
    return out.sort((a, b) => a.unc.localeCompare(b.unc));
  }, [allCustomers]);

  const [scrollTop, setScrollTop] = useState(0);
  const containerH = 400;
  const startIdx   = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
  const endIdx     = Math.min(rows.length, Math.ceil((scrollTop + containerH) / ROW_H) + BUFFER);
  const visible    = rows.slice(startIdx, endIdx);
  const tableW     = COL_W_ROW + COL_W_UNC + 70 + 100;
  const bd = dark ? 'border-gray-700' : 'border-gray-200';
  const hd = dark ? 'bg-gray-800 text-gray-300' : 'bg-gray-50 text-gray-600';

  return (
    <div className={`overflow-auto border rounded-xl ${bd}`} style={{ height: containerH }}
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ minWidth: tableW }}>
        <table className="border-collapse text-[11px] w-full" style={{ tableLayout: 'fixed', width: tableW }}>
          <colgroup>
            <col style={{ width: COL_W_ROW }} /><col style={{ width: COL_W_UNC }} />
            <col style={{ width: 70 }} /><col style={{ width: 100 }} />
          </colgroup>
          <thead>
            <tr>
              {['#', 'UNC Code', 'Dates', 'Total Qty'].map(h => (
                <th key={h} className={`sticky top-0 z-10 text-center border-r border-b px-1 py-1.5 font-bold ${hd} ${bd}`} style={{ height: ROW_H }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {startIdx > 0 && <tr style={{ height: startIdx * ROW_H }}><td colSpan={4} /></tr>}
            {visible.map((row, vi) => {
              const idx = startIdx + vi;
              const bg = idx % 2 === 0 ? (dark ? 'bg-gray-900' : 'bg-white') : (dark ? 'bg-gray-800/40' : 'bg-gray-50/60');
              return (
                <tr key={idx} className={bg} style={{ height: ROW_H }}>
                  <td className={`text-center border-r border-b px-1 font-mono tabular-nums ${bd} ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{idx + 1}</td>
                  <td className={`border-r border-b px-2 font-bold text-[#F36B21] ${bd}`}>{row.unc}</td>
                  <td className={`border-r border-b px-2 text-center tabular-nums ${bd} ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{row.dates}</td>
                  <td className={`border-r border-b px-2 text-right font-semibold tabular-nums ${bd} ${dark ? 'text-green-300' : 'text-green-700'}`}>{row.total.toLocaleString()}</td>
                </tr>
              );
            })}
            {endIdx < rows.length && <tr style={{ height: (rows.length - endIdx) * ROW_H }}><td colSpan={4} /></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── useIsDark ─────────────────────────────────────────────────────────────────
function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark'))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ForecastImport() {
  const { user }                        = useAuth();
  const { currentVersion, setForecast } = useForecast();
  const dark                            = useIsDark();

  const [engineState,  setEngineState]  = useState<EngineState>('idle');
  const [engineResult, setEngineResult] = useState<EngineResult | null>(null);
  const [errorMsg,     setErrorMsg]     = useState('');
  const [activeTab,    setActiveTab]    = useState<'preview' | 'byCustomer' | 'allCustomers'>('preview');
  const [isPasting,    setIsPasting]    = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteAreaRef = useRef<HTMLTextAreaElement>(null);

  // ── Process raw TSV — main thread with deferred execution ─────────────────
  const processRaw = useCallback((raw: string) => {
    if (!raw.trim()) return;
    setEngineState('parsing');
    setErrorMsg('');
    setIsPasting(false);

    // Defer to next tick so the loading state renders before heavy work begins
    setTimeout(() => {
      const result = parseForecastData(raw);
      if (!result.ok) {
        setErrorMsg(result.error);
        setEngineState('error');
        return;
      }
      setEngineResult({
        byCustomer:   result.byCustomer,
        allCustomers: result.allCustomers,
        rowCount:     result.rowCount,
        skippedCount: result.skippedCount,
        previewRows:  result.previewRows,
      });
      setEngineState('ready');
      setActiveTab('preview');
    }, 16);
  }, []);

  // ── Paste handler ──────────────────────────────────────────────────────────
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) processRaw(text);
  }

  // ── File import ────────────────────────────────────────────────────────────
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { const t = ev.target?.result as string; if (t) processRaw(t); };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  // ── Clear ──────────────────────────────────────────────────────────────────
  function handleClear() {
    setEngineResult(null);
    setEngineState('idle');
    setErrorMsg('');
  }

  // ── Update Forecast ────────────────────────────────────────────────────────
  async function handleUpdate() {
    if (!engineResult) return;
    setEngineState('updating');
    const { error } = await setForecast(
      engineResult.byCustomer,
      engineResult.allCustomers,
      { updatedBy: user?.username ?? 'unknown', rowCount: engineResult.rowCount },
    );
    if (error) { setErrorMsg(error); setEngineState('error'); }
    else        setEngineState('success');
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const hasData   = !!engineResult && engineResult.rowCount > 0;
  const canUpdate = hasData && engineState === 'ready';
  const uncCount  = engineResult?.allCustomers.size ?? 0;
  const custCount = useMemo(() => {
    if (!engineResult) return 0;
    let n = 0;
    for (const m of engineResult.byCustomer.values()) n += m.size;
    return n;
  }, [engineResult]);

  // ── Styles ─────────────────────────────────────────────────────────────────
  const bg    = dark ? 'bg-gray-900' : 'bg-gray-50';
  const card  = dark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const text  = dark ? 'text-gray-200' : 'text-gray-800';
  const muted = dark ? 'text-gray-500' : 'text-gray-400';
  const btn   = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed select-none';
  const tabCls = (active: boolean) =>
    `px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${active
      ? 'bg-[#F36B21] text-white shadow'
      : dark ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-100'}`;

  return (
    <div className={`flex-1 flex flex-col min-h-0 ${bg}`}>

      {/* ── Top bar ── */}
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0 flex-wrap ${dark ? 'bg-gray-900 border-gray-700/60' : 'bg-white border-gray-200'}`}>
        <div className="flex items-center gap-2 mr-2">
          <div className="w-8 h-8 rounded-xl bg-[#F36B21]/10 flex items-center justify-center">
            <Zap size={15} className="text-[#F36B21]" />
          </div>
          <div>
            <div className={`text-[9px] font-bold uppercase tracking-widest ${muted}`}>Master Plan</div>
            <div className={`text-sm font-black leading-tight ${text}`}>Update New Order</div>
          </div>
        </div>

        <div className={`w-px h-5 ${dark ? 'bg-gray-700' : 'bg-gray-200'}`} />

        <button className={`${btn} ${dark ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          onClick={() => fileInputRef.current?.click()}>
          <Upload size={13} /> Import File
        </button>
        <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFile} />

        <button
          className={`${btn} ${dark ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          onClick={() => { setIsPasting(true); setTimeout(() => pasteAreaRef.current?.focus(), 50); }}>
          <ClipboardPaste size={13} /> Paste Excel
        </button>

        {hasData && (
          <button className={`${btn} ${dark ? 'text-red-400 hover:bg-gray-700' : 'text-red-500 hover:bg-red-50'}`} onClick={handleClear}>
            <Trash2 size={13} /> Clear
          </button>
        )}

        <button disabled={!canUpdate} onClick={handleUpdate}
          className={`${btn} ml-auto shadow-md ${
            engineState === 'success'
              ? 'bg-green-500 text-white shadow-green-200/40'
              : canUpdate
              ? 'bg-[#F36B21] text-white hover:bg-[#D4591A] shadow-orange-200/40'
              : 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500 shadow-none'
          }`}>
          {engineState === 'updating' ? <><RefreshCw size={13} className="animate-spin" /> Updating…</>
           : engineState === 'success' ? <><Check size={13} /> Order Updated!</>
           : <><Zap size={13} /> Update New Order</>}
        </button>
      </div>

      {/* ── Info bar ── */}
      <div className={`flex items-center gap-5 px-4 py-2 border-b flex-shrink-0 flex-wrap ${dark ? 'bg-gray-900 border-gray-700/60' : 'bg-white border-gray-100'}`}>
        {[
          { icon: <Hash size={10} />,     label: 'Imported Rows',      val: engineResult ? engineResult.rowCount.toLocaleString() : '—',  hi: !!engineResult },
          { icon: <Database size={10} />, label: 'UNC Codes',           val: uncCount > 0 ? uncCount.toLocaleString() : '—',               hi: uncCount > 0 },
          { icon: <Users size={10} />,    label: 'Cust-UNC Pairs',      val: custCount > 0 ? custCount.toLocaleString() : '—',             hi: custCount > 0 },
          { icon: <Hash size={10} />,     label: 'Skipped',             val: engineResult ? engineResult.skippedCount.toLocaleString() : '—', hi: false },
          { icon: <Check size={10} />,    label: 'Active Version',      val: currentVersion ? `v${currentVersion.version_number}` : 'None', hi: !!currentVersion },
          { icon: <Database size={10} />, label: 'Last Updated By',     val: currentVersion?.updated_by ?? '—',                           hi: !!currentVersion },
        ].map(({ icon, label, val, hi }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={muted}>{icon}</span>
            <div>
              <div className={`text-[9px] font-bold uppercase tracking-wider ${muted}`}>{label}</div>
              <div className={`text-xs font-bold ${hi ? 'text-[#F36B21]' : muted}`}>{val}</div>
            </div>
          </div>
        ))}

        {errorMsg && (
          <div className={`ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg max-w-sm truncate ${dark ? 'bg-red-900/20 border border-red-800 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
            <AlertTriangle size={11} className="flex-shrink-0" />
            <span className="truncate">{errorMsg}</span>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto p-4 space-y-4 min-h-0">

        {/* Parsing state */}
        {engineState === 'parsing' && (
          <div className={`flex flex-col items-center justify-center py-20 rounded-2xl border ${card}`}>
            <div className="relative w-16 h-16 mb-4">
              <div className="absolute inset-0 rounded-full border-4 border-[#F36B21]/20" />
              <div className="absolute inset-0 rounded-full border-4 border-[#F36B21] border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Zap size={18} className="text-[#F36B21]" />
              </div>
            </div>
            <div className={`text-sm font-bold ${text}`}>Building Forecast Indexes…</div>
            <div className={`text-xs mt-1 ${muted}`}>ForecastByCustomer + ForecastAllCustomers</div>
          </div>
        )}

        {/* Loaded state */}
        {hasData && engineResult && (
          <>
            {/* Fixed column info */}
            <div className={`rounded-xl border px-4 py-3 ${card}`}>
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-2.5 ${muted}`}>Fixed Column Format — No Header Row</div>
              <div className="flex flex-wrap gap-2">
                {[
                  { col: 3,  field: 'UNC Code',  active: true  },
                  { col: 5,  field: 'Customer',  active: true  },
                  { col: 8,  field: 'Due Date',  active: true  },
                  { col: 11, field: 'Order Qty', active: true  },
                  { col: 1,  field: 'Item No',   active: false },
                  { col: 2,  field: 'Status',    active: false },
                  { col: 4,  field: 'Part Ref',  active: false },
                  { col: 6,  field: 'Cust Part', active: false },
                  { col: 7,  field: 'P/O',       active: false },
                  { col: 9,  field: 'Due Time',  active: false },
                  { col: 10, field: 'Ord Date',  active: false },
                  { col: 12, field: 'Remain',    active: false },
                ].map(({ col, field, active }) => (
                  <div key={col} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${
                    active
                      ? (dark ? 'bg-[#F36B21]/20 border-[#F36B21]/50 text-[#F36B21]' : 'bg-orange-50 border-orange-300 text-orange-700')
                      : (dark ? 'bg-gray-800 border-gray-700 text-gray-600' : 'bg-gray-50 border-gray-200 text-gray-400')
                  }`}>
                    <span className={`text-[9px] font-black ${active ? '' : 'opacity-50'}`}>C{col}</span>
                    <span>{field}</span>
                    {active && <Check size={9} />}
                  </div>
                ))}
              </div>
              <div className={`mt-2 text-[10px] ${muted}`}>
                {engineResult.skippedCount > 0
                  ? `${engineResult.skippedCount.toLocaleString()} rows skipped (too few columns, invalid date, or zero qty)`
                  : 'All rows processed successfully'}
              </div>
            </div>

            {/* Index stats */}
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  icon:  <Database size={16} className="text-[#F36B21]" />,
                  title: 'ForecastByCustomer',
                  sub:   'Map<UNC, Map<Customer, Map<Date, Qty>>>',
                  stats: [{ label: 'UNC Codes', val: engineResult.byCustomer.size }, { label: 'Cust Pairs', val: custCount }],
                },
                {
                  icon:  <Database size={16} className="text-blue-500" />,
                  title: 'ForecastAllCustomers',
                  sub:   'Map<UNC, Map<Date, Qty>>',
                  stats: [{ label: 'UNC Codes', val: engineResult.allCustomers.size }, { label: 'Rows Used', val: engineResult.rowCount }],
                },
              ].map(({ icon, title, sub, stats }) => (
                <div key={title} className={`rounded-xl border px-4 py-3 ${card}`}>
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5">{icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-black font-mono ${text}`}>{title}</div>
                      <div className={`text-[10px] font-mono mt-0.5 truncate ${muted}`}>{sub}</div>
                      <div className="flex gap-4 mt-2">
                        {stats.map(({ label, val }) => (
                          <div key={label}>
                            <div className={`text-[9px] font-bold uppercase tracking-wider ${muted}`}>{label}</div>
                            <div className="text-base font-black text-[#F36B21]">{val.toLocaleString()}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1.5 px-1">
              <button className={tabCls(activeTab === 'preview')}      onClick={() => setActiveTab('preview')}>
                Preview ({Math.min(engineResult.previewRows.length, 200)} rows)
              </button>
              <button className={tabCls(activeTab === 'byCustomer')}   onClick={() => setActiveTab('byCustomer')}>
                ForecastByCustomer ({custCount})
              </button>
              <button className={tabCls(activeTab === 'allCustomers')} onClick={() => setActiveTab('allCustomers')}>
                ForecastAllCustomers ({uncCount} UNCs)
              </button>
            </div>

            {activeTab === 'preview'      && <PreviewGrid      rows={engineResult.previewRows} dark={dark} />}
            {activeTab === 'byCustomer'   && <ByCustomerTable  byCustomer={engineResult.byCustomer} dark={dark} />}
            {activeTab === 'allCustomers' && <AllCustomersTable allCustomers={engineResult.allCustomers} dark={dark} />}
          </>
        )}

        {/* Idle / Error state */}
        {(engineState === 'idle' || engineState === 'error') && !hasData && (
          <div
            className={`rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center py-16 px-8 ${dark ? 'border-gray-700' : 'border-gray-300'}`}
            style={{ minHeight: 380 }}
          >
            <div className="w-20 h-20 rounded-2xl bg-[#F36B21]/10 flex items-center justify-center mb-5">
              <Zap size={34} className="text-[#F36B21]" />
            </div>
            <h3 className={`text-lg font-black mb-1 ${text}`}>Update New Order</h3>
            <p className={`text-sm mb-6 max-w-md ${muted}`}>
              Copy rows from Excel (no header row needed), click <b>Paste Excel</b>, then press&nbsp;
              <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono border ${dark ? 'border-gray-600 bg-gray-800' : 'border-gray-300 bg-gray-100'}`}>Ctrl+V</kbd>.
            </p>

            {/* Fixed column reference */}
            <div className={`max-w-lg text-left text-[11px] rounded-xl border px-5 py-4 space-y-3 ${dark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
              <div className={`text-xs font-bold ${text}`}>Fixed column positions — no header row:</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                {[
                  { col: 3,  field: 'UNC Code',  active: true  },
                  { col: 5,  field: 'Customer',  active: true  },
                  { col: 8,  field: 'Due Date',  active: true  },
                  { col: 11, field: 'Order Qty', active: true  },
                  { col: 1,  field: 'Item No',   active: false },
                  { col: 2,  field: 'Status',    active: false },
                  { col: 7,  field: 'P/O',       active: false },
                  { col: 9,  field: 'Due Time',  active: false },
                ].map(({ col, field, active }) => (
                  <div key={col} className={`flex items-center gap-1.5 ${active ? (dark ? 'text-[#F36B21]' : 'text-orange-700') : muted}`}>
                    <span className="font-black font-mono w-5 text-right">{col}</span>
                    <ArrowRight size={8} className="opacity-40 flex-shrink-0" />
                    <span className={active ? 'font-bold' : ''}>{field}{active ? '' : ' (ignored)'}</span>
                  </div>
                ))}
              </div>
              <div className={`text-[10px] pt-1 border-t ${dark ? 'border-gray-700 text-gray-500' : 'border-gray-200 text-gray-400'}`}>
                Date format: DD/MM/YYYY · Tab-separated (Excel copy/paste)
              </div>
            </div>

            {errorMsg && (
              <div className={`mt-4 flex items-start gap-2 px-4 py-3 rounded-xl border text-xs max-w-lg w-full text-left ${dark ? 'bg-red-900/20 border-red-800 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Paste modal ── */}
      {isPasting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className={`w-full max-w-xl rounded-2xl shadow-2xl border overflow-hidden ${dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className={`flex items-center justify-between px-4 py-3 border-b ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
              <div>
                <div className={`text-[10px] font-bold uppercase tracking-wider ${muted}`}>Copy rows in Excel → Press Ctrl+V here</div>
                <div className={`text-sm font-black ${text}`}>Paste from Excel</div>
              </div>
              <button onClick={() => setIsPasting(false)} className={`text-xl font-bold px-2 leading-none ${dark ? 'text-gray-400 hover:text-white' : 'text-gray-400 hover:text-gray-700'}`}>×</button>
            </div>
            <div className="p-4">
              <textarea
                ref={pasteAreaRef}
                autoFocus
                onPaste={handlePaste}
                readOnly
                className={`w-full rounded-xl border p-3 text-xs font-mono outline-none resize-none focus:ring-2 focus:ring-[#F36B21] ${dark ? 'bg-gray-800 border-gray-600 text-gray-200 placeholder:text-gray-600' : 'bg-gray-50 border-gray-200 text-gray-800 placeholder:text-gray-400'}`}
                style={{ height: 180 }}
                placeholder="Ctrl+V to paste here…"
              />
              <p className={`text-[10px] mt-2 text-center ${muted}`}>
                No header row needed. The engine reads fixed column positions automatically.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
