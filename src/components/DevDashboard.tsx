import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { RefreshCw, TrendingUp, Package, CheckCircle2, Clock, Activity, Maximize2, Minimize2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ProductionOrder, Machine } from '../types';

const EPOCH_MS = new Date('2020-01-01').getTime();
const DAYS_LABEL = ['S','M','T','W','T','F','S'];

function todayEpochDays() { return Math.floor((Date.now() - EPOCH_MS) / 86400000); }

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function toStr(d: Date) { return d.toISOString().slice(0,10); }
function todayDate() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function getCustomer(id: string) { const m = id.match(/^([A-Za-z]+)/); return m ? m[1].toUpperCase() : 'OTHER'; }
function getQty(o: ProductionOrder) { return (o.qty_1??0)+(o.qty_2??0)+(o.qty_3??0)+(o.qty_4??0); }
function fmtQty(n: number) { return n>=1000000?`${(n/1000000).toFixed(1)}M`:n>=1000?`${(n/1000).toFixed(0)}k`:String(n); }
function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

interface HistoryRow {
  id: string; order_id: string|null; order_ref: string; unc_codes: string|null;
  event_type: string; field_name: string|null; old_value: string|null;
  new_value: string|null; changed_by: string|null; created_at: string;
}

const EVENT_BADGE: Record<string,{label:string;cls:string}> = {
  created:          { label:'New Plan',  cls:'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
  planned:          { label:'Planned',   cls:'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
  unplanned:        { label:'Unplanned', cls:'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
  updated:          { label:'Updated',   cls:'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
  urgent_confirmed: { label:'Confirmed', cls:'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' },
};

// ── Donut Chart (fluid viewBox) ──────────────────────────────────────────────

interface Seg { label: string; value: number; color: string; }

function DonutChart({ segments, isDark }: { segments: Seg[]; isDark: boolean }) {
  const total = segments.reduce((s,x)=>s+x.value, 0);
  const C = 2*Math.PI*30;
  let off = -C/4;
  return (
    <svg viewBox="0 0 100 100" width="100%" style={{ display:'block' }}>
      <circle cx={50} cy={50} r={30} fill="none" stroke={isDark?'#0c1830':'#f1f5f9'} strokeWidth={11}/>
      {total===0
        ? <circle cx={50} cy={50} r={30} fill="none" stroke={isDark?'#1e3a5f':'#e2e8f0'} strokeWidth={11}/>
        : segments.map((seg,i) => {
            const len=(seg.value/total)*C;
            const el=<circle key={i} cx={50} cy={50} r={30} fill="none" stroke={seg.color} strokeWidth={11}
              strokeDasharray={`${Math.max(0,len-1.2)} ${C-Math.max(0,len-1.2)}`} strokeDashoffset={-off}/>;
            off+=len; return el;
          })
      }
      <text x={50} y={47} textAnchor="middle" fontSize={13} fontWeight="800" fill={isDark?'#f1f5f9':'#1e293b'}>{total}</text>
      <text x={50} y={58} textAnchor="middle" fontSize={7} fill={isDark?'#94a3b8':'#64748b'}>Orders</text>
    </svg>
  );
}

// ── Daily Busy Chart — SVG, always 30 slots, scrollable, Y-axis, peak line ──

interface DayBusy { date: string; label: string; busyPct: number; busyCount: number; isActive: boolean; }

const BAR_SLOTS = 30;
const BAR_SLOT  = 17; // px per slot (bar + gap)
const BAR_W     = 11; // bar width in px
const MONTHS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pL=30, pR=62, pT=16, pB=28; // SVG padding

function DailyBusyChart({ data, isDark, totalMachines }: { data: DayBusy[]; isDark: boolean; totalMachines: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [svgH, setSvgH] = useState(120);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSvgH(Math.max(80, e.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!data.length) return <div className="flex-1 flex items-center justify-center text-[9px] text-gray-400">No data</div>;

  const iH  = Math.max(20, svgH - pT - pB);
  const iW  = BAR_SLOTS * BAR_SLOT;
  const svgW = pL + iW + pR;

  const maxY = Math.max(5, Math.ceil(Math.max(totalMachines, 1) / 5) * 5);
  const yTicks = Array.from({ length: maxY / 5 }, (_, i) => (i + 1) * 5);
  const scaleY = (v: number) => pT + iH - Math.max(0, Math.min(1, v / maxY)) * iH;
  const maxCount = Math.max(0, ...data.filter(d => d.isActive).map(d => d.busyCount));

  const gridC = isDark ? '#1e3a5f' : '#e2e8f0';
  const txtC  = isDark ? '#475569' : '#94a3b8';
  const lineC = isDark ? '#2d4a6e' : '#cbd5e1';

  return (
    <div ref={wrapRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden" style={{ scrollbarWidth:'thin' }}>
      <svg width={svgW} height={svgH} style={{ display:'block', overflow:'visible' }}>

        {/* Y-axis gridlines + labels */}
        {yTicks.map(v => {
          const y = scaleY(v);
          return (
            <g key={v}>
              <line x1={pL} y1={y} x2={pL+iW} y2={y} stroke={gridC} strokeWidth={0.5} strokeDasharray="2,2"/>
              <text x={pL-4} y={y+3.5} textAnchor="end" fontSize={6.5} fill={txtC}>{v}</text>
            </g>
          );
        })}

        {/* Y-axis line + baseline */}
        <line x1={pL} y1={pT} x2={pL} y2={pT+iH} stroke={lineC} strokeWidth={0.8}/>
        <line x1={pL} y1={pT+iH} x2={pL+iW} y2={pT+iH} stroke={lineC} strokeWidth={1}/>

        {/* Peak dashed line */}
        {maxCount > 0 && (
          <g>
            <line x1={pL} y1={scaleY(maxCount)} x2={pL+iW+12} y2={scaleY(maxCount)}
              stroke="#3B82F6" strokeWidth={0.9} strokeDasharray="3,2" opacity={0.85}/>
            <text x={pL+iW+14} y={scaleY(maxCount)+3.5} fontSize={7} fill={isDark?'#60A5FA':'#2563EB'} fontWeight="700">
              {`High: ${maxCount}`}
            </text>
          </g>
        )}

        {/* Bars, value labels, X-axis labels */}
        {data.map((d, i) => {
          const cx = pL + i * BAR_SLOT + BAR_SLOT / 2;
          const bx = cx - BAR_W / 2;
          const count = d.isActive ? d.busyCount : 0;
          const bH   = (count / maxY) * iH;
          const bY   = pT + iH - bH;
          const barC = !d.isActive
            ? (isDark ? '#1e3a5f' : '#e8eef4')
            : d.busyPct >= 70 ? '#22C55E' : d.busyPct >= 40 ? '#F59E0B' : '#EF4444';
          const dt    = new Date(d.date + 'T00:00:00');
          const dayN  = dt.getDate();
          const monS  = MONTHS[dt.getMonth()];
          const xC    = d.isActive ? txtC : (isDark ? '#1e3a5f' : '#d1dbe7');

          return (
            <g key={i}>
              {/* Bar — always visible (2px stub when 0) */}
              {bH >= 1
                ? <rect x={bx} y={bY} width={BAR_W} height={bH} fill={barC} rx={1} opacity={d.isActive?0.9:0.4}/>
                : <rect x={bx} y={pT+iH-2} width={BAR_W} height={2} fill={isDark?'#1e3a5f':'#d1dbe7'} rx={0.5}/>
              }
              {/* Value on top of bar */}
              {d.isActive && count > 0 && (
                <text x={cx} y={bY-2.5} textAnchor="middle" fontSize={5.5} fill={barC} fontWeight="700">{count}</text>
              )}
              {d.isActive && count === 0 && (
                <text x={cx} y={pT+iH-5} textAnchor="middle" fontSize={5.5} fill={txtC}>0</text>
              )}
              {/* X: day number */}
              <text x={cx} y={pT+iH+11} textAnchor="middle" fontSize={6.5} fill={xC} fontWeight={d.isActive?'600':'400'}>{dayN}</text>
              {/* X: month abbreviation */}
              <text x={cx} y={pT+iH+21} textAnchor="middle" fontSize={5.5} fill={xC}>{monS}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── HBar ─────────────────────────────────────────────────────────────────────

function HBar({ pct, color, thick=false }: { pct: number; color: string; thick?: boolean }) {
  return (
    <div className={`flex-1 ${thick?'h-3':'h-1.5'} bg-gray-100 dark:bg-[#0c1830] rounded-full overflow-hidden`}>
      <div className="h-full rounded-full" style={{ width:`${Math.min(100,pct)}%`, backgroundColor:color }}/>
    </div>
  );
}

// ── Card — inner div is flex col so children can flex-1 ───────────────────────

function Card({ title, children, className='' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border bg-white dark:bg-[#0C1830] border-gray-200 dark:border-blue-900/50 p-2 flex flex-col min-h-0 h-full ${className}`}>
      <div className="text-[8.5px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1 flex-none leading-none">{title}</div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{children}</div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

type DayOption = 1 | 7 | 15 | 30;

export default function DevDashboard() {
  const [orders,   setOrders]   = useState<ProductionOrder[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [history,  setHistory]  = useState<HistoryRow[]>([]);
  const [users,    setUsers]    = useState<{username:string;role:string}[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [selectedDays, setSelectedDays] = useState<DayOption>(7);
  const [isFS, setIsFS]         = useState(false);
  const [updatedAt, setUpdatedAt] = useState(new Date());
  const containerRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDark();

  useEffect(() => {
    const h = () => setIsFS(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  function toggleFS() {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data:oData }, { data:mData }, { data:hData }, { data:uData }] = await Promise.all([
      supabase.from('production_orders').select('*').eq('is_finished', false),
      supabase.from('machines').select('*').order('display_order'),
      supabase.from('plan_history').select('*').order('created_at', { ascending:false }).limit(50),
      supabase.from('app_users').select('username, role').in('role', ['planner','admin']),
    ]);
    if (oData) setOrders(oData as ProductionOrder[]);
    if (mData) setMachines(mData as Machine[]);
    if (hData) setHistory(hData as HistoryRow[]);
    if (uData) setUsers(uData as {username:string;role:string}[]);
    setLoading(false);
    setUpdatedAt(new Date());
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const todayStr    = toStr(todayDate());
  const tomorrowStr = toStr(addDays(todayDate(), 1));
  const wk1Str      = toStr(addDays(todayDate(), 7));
  const wk2Str      = toStr(addDays(todayDate(), 14));
  const todayD      = todayEpochDays();

  // KPI
  const stats = useMemo(() => ({
    total:           orders.length,
    planned:         orders.filter(o=>o.is_planned).length,
    unplanned:       orders.filter(o=>!o.is_planned).length,
    pendingConfirm:  orders.filter(o=>o.urgent).length,
    totalQtyPcs:     orders.reduce((s,o)=>s+getQty(o), 0),
  }), [orders]);

  // Machine loading (% machine-days WITH work in selected range)
  const machineLoading = useMemo(() => {
    const endD = todayD + selectedDays;
    return [450,350,300,250,150,100,50,30,5].flatMap(size => {
      const ms = machines.filter(m=>m.size_ton===size);
      if (!ms.length) return [];
      let workDays = 0;
      for (const machine of ms) {
        for (let d=todayD; d<endD; d++) {
          if (orders.some(o=>o.machine_id===machine.id&&o.x_offset!=null&&o.x_offset<=d&&d<o.x_offset+(o.leadtime??1)))
            workDays++;
        }
      }
      const total = ms.length * selectedDays;
      return [{ size, pct:total>0?Math.round(workDays/total*100):0, total:ms.length, workDays }];
    });
  }, [orders, machines, selectedDays, todayD]);

  // Qty by due date
  const qtyBuckets = useMemo(() => [
    { label:'Today',     qty:orders.filter(o=>o.due_date===todayStr).reduce((s,o)=>s+getQty(o),0),                                   color:'#EF4444', bg:'bg-red-50 dark:bg-red-900/10' },
    { label:'Tomorrow',  qty:orders.filter(o=>o.due_date===tomorrowStr).reduce((s,o)=>s+getQty(o),0),                                color:'#F36B21', bg:'bg-orange-50 dark:bg-orange-900/10' },
    { label:'This Week', qty:orders.filter(o=>o.due_date&&o.due_date>tomorrowStr&&o.due_date<=wk1Str).reduce((s,o)=>s+getQty(o),0), color:'#F59E0B', bg:'bg-amber-50 dark:bg-amber-900/10' },
    { label:'Next Week', qty:orders.filter(o=>o.due_date&&o.due_date>wk1Str&&o.due_date<=wk2Str).reduce((s,o)=>s+getQty(o),0),     color:'#3B82F6', bg:'bg-blue-50 dark:bg-blue-900/10' },
    { label:'2 Weeks+',  qty:orders.filter(o=>o.due_date&&o.due_date>wk2Str).reduce((s,o)=>s+getQty(o),0),                         color:'#22C55E', bg:'bg-green-50 dark:bg-green-900/10' },
    { label:'Total Qty', qty:orders.reduce((s,o)=>s+getQty(o),0),                                                                   color:'#8B5CF6', bg:'bg-purple-50 dark:bg-purple-900/10' },
  ], [orders, todayStr, tomorrowStr, wk1Str, wk2Str]);

  // Daily BUSY — always 30 slots; inactive slots beyond selectedDays show 0
  const dailyBusy = useMemo((): DayBusy[] => {
    return Array.from({ length: BAR_SLOTS }, (_, i) => {
      const d = todayD + i;
      const date = new Date(EPOCH_MS + d*86400000);
      const isActive = i < selectedDays;
      if (!isActive || !machines.length) return { date:toStr(date), label:'', busyPct:0, busyCount:0, isActive };
      const idleCount = machines.filter(m=>
        !orders.some(o=>o.machine_id===m.id&&o.x_offset!=null&&o.x_offset<=d&&d<o.x_offset+(o.leadtime??1))
      ).length;
      const busyCount = machines.length - idleCount;
      const busyPct = Math.round(busyCount / machines.length * 100);
      return { date:toStr(date), label:'', busyPct, busyCount, isActive };
    });
  }, [orders, machines, selectedDays, todayD]);

  // Status segs
  const statusSegs = useMemo((): Seg[] => {
    const a = orders.filter(o=>o.machine_id);
    return [
      { label:'Planned',         value:a.filter(o=>o.is_planned).length,                            color:'#22C55E' },
      { label:'Uses Operator',   value:a.filter(o=>!o.urgent&&!o.is_planned&&o.plan_type==='Yellow').length, color:'#F59E0B' },
      { label:'No Operator',     value:a.filter(o=>!o.urgent&&!o.is_planned&&o.plan_type==='White').length,  color:'#3B82F6' },
      { label:'Pending Confirm', value:a.filter(o=>o.urgent).length,                                color:'#F36B21' },
      { label:'Overdue',         value:orders.filter(o=>o.due_date&&o.due_date<todayStr).length,    color:'#EF4444' },
    ].filter(s=>s.value>0);
  }, [orders, todayStr]);

  // High qty parts in date range
  const highQtyParts = useMemo(() => {
    const endD = todayD + selectedDays;
    const inRange = orders.filter(o=>o.x_offset!=null&&o.x_offset<endD&&o.x_offset+(o.leadtime??1)>todayD);
    const map = new Map<string,{qty:number;orders:number}>();
    for (const o of inRange) {
      const pairs: [string|null,number|null][] = [[o.unc_code_1,o.qty_1],[o.unc_code_2,o.qty_2],[o.unc_code_3,o.qty_3],[o.unc_code_4,o.qty_4]];
      for (const [code,qty] of pairs) {
        if (code) { const e=map.get(code)??{qty:0,orders:0}; map.set(code,{qty:e.qty+(qty??0),orders:e.orders+1}); }
      }
    }
    return [...map.entries()].sort((a,b)=>b[1].qty-a[1].qty).map(([code,d])=>({code,...d}));
  }, [orders, selectedDays, todayD]);
  const maxHQty = useMemo(()=>Math.max(1,...highQtyParts.map(r=>r.qty)),[highQtyParts]);

  // Row 4 donuts
  const customerSegs = useMemo((): Seg[] => {
    const COLS=['#3B82F6','#22C55E','#F59E0B','#F36B21','#8B5CF6'];
    const map=new Map<string,number>();
    for(const o of orders){const c=getCustomer(o.order_id);map.set(c,(map.get(c)??0)+getQty(o));}
    const sorted=[...map.entries()].sort((a,b)=>b[1]-a[1]);
    const top5=sorted.slice(0,5).map(([l,v],i)=>({label:l,value:v,color:COLS[i]}));
    const oth=sorted.slice(5).reduce((s,[,v])=>s+v,0);
    if(oth>0)top5.push({label:'Others',value:oth,color:'#94A3B8'});
    return top5;
  }, [orders]);

  const sizeSegs = useMemo((): Seg[] => {
    const C:Record<number,string>={5:'#3B82F6',30:'#22C55E',50:'#F59E0B',100:'#F36B21',150:'#EF4444',250:'#8B5CF6',300:'#06B6D4',350:'#EC4899',450:'#84CC16'};
    const map=new Map<number,number>();
    for(const o of orders)if(o.size_ton)map.set(o.size_ton,(map.get(o.size_ton)??0)+o.size_ton);
    return [...map.entries()].sort((a,b)=>b[1]-a[1]).map(([s,v])=>({label:`${s}T`,value:v,color:C[s]??'#94A3B8'}));
  }, [orders]);

  const plannerPerf = useMemo(() => {
    // Seed with all known planner/admin users (0-count inclusive)
    const map = new Map<string,{total:number;planned:number;unplanned:number;urgent:number}>();
    for (const u of users) map.set(u.username, { total:0, planned:0, unplanned:0, urgent:0 });
    for (const o of orders) {
      const p = o.created_by ?? '(none)';
      const e = map.get(p) ?? { total:0, planned:0, unplanned:0, urgent:0 };
      map.set(p, { total:e.total+1, planned:e.planned+(o.is_planned?1:0), unplanned:e.unplanned+(!o.is_planned?1:0), urgent:e.urgent+(o.urgent?1:0) });
    }
    return [...map.entries()].sort((a,b)=>b[1].total-a[1].total).map(([n,d])=>({name:n,...d}));
  }, [orders, users]);

  const aging = useMemo(() => {
    const now=Date.now();
    const buckets=[
      {label:'0–3 Days', min:0,  max:3,       count:0, color:'#22C55E'},
      {label:'4–7 Days', min:4,  max:7,        count:0, color:'#F59E0B'},
      {label:'8–14 Days',min:8,  max:14,       count:0, color:'#F36B21'},
      {label:'15+ Days', min:15, max:Infinity, count:0, color:'#EF4444'},
    ];
    for(const o of orders.filter(o2=>!o2.is_planned)){
      const days=Math.floor((now-new Date(o.created_at).getTime())/86400000);
      const b=buckets.find(b=>days>=b.min&&days<=b.max);
      if(b)b.count++;
    }
    return buckets;
  }, [orders]);
  const maxAging=useMemo(()=>Math.max(1,...aging.map(b=>b.count)),[aging]);

  const fmtU=`${String(updatedAt.getHours()).padStart(2,'0')}:${String(updatedAt.getMinutes()).padStart(2,'0')}`;

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-[#F36B21] border-t-transparent rounded-full animate-spin"/>
    </div>
  );

  return (
    <div ref={containerRef} className={`flex flex-col h-full overflow-hidden gap-1 ${isFS?'bg-white dark:bg-[#070F1E] p-3':''}`}>

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between flex-none h-7">
        <div className="flex items-center gap-2">
          <Activity size={13} className="text-[#F36B21] flex-shrink-0"/>
          <span className="text-xs font-bold text-gray-800 dark:text-white">Production Analytics</span>
          <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-[#0A1628] rounded-lg p-0.5">
            {([1,7,15,30] as DayOption[]).map(d=>(
              <button key={d} onClick={()=>setSelectedDays(d)}
                className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${selectedDays===d?'bg-[#F36B21] text-white shadow-sm':'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                {d}D
              </button>
            ))}
          </div>
          <span className="text-[9px] text-gray-400 hidden sm:inline">update: {fmtU}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={fetchData} className="p-1.5 rounded-lg text-gray-400 hover:text-[#F36B21] hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all"><RefreshCw size={11}/></button>
          <button onClick={toggleFS} className="p-1.5 rounded-lg text-gray-400 hover:text-[#F36B21] hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all">
            {isFS?<Minimize2 size={11}/>:<Maximize2 size={11}/>}
          </button>
        </div>
      </div>

      {/* ── KPI Row (5 boxes) ── */}
      <div className="grid grid-cols-5 gap-1 flex-none">
        {[
          { label:'Total Orders',    value:stats.total,                    sub:'100%',                                                                icon:Package,      c:'#F36B21', bg:'bg-orange-50 dark:bg-orange-900/10' },
          { label:'Planned',         value:stats.planned,                  sub:stats.total?`${Math.round(stats.planned/stats.total*100)}%`:'0%',      icon:CheckCircle2, c:'#22C55E', bg:'bg-green-50 dark:bg-green-900/10' },
          { label:'Unplanned',       value:stats.unplanned,                sub:stats.total?`${Math.round(stats.unplanned/stats.total*100)}%`:'0%',    icon:Clock,        c:'#F59E0B', bg:'bg-amber-50 dark:bg-amber-900/10' },
          { label:'Pending Confirm', value:stats.pendingConfirm,           sub:stats.total?`${Math.round(stats.pendingConfirm/stats.total*100)}%`:'0%',icon:Activity,    c:'#F36B21', bg:'bg-orange-50 dark:bg-orange-900/10' },
          { label:'Total Qty (Pcs)', value:fmtQty(stats.totalQtyPcs),     sub:'All on Board',                                                        icon:TrendingUp,   c:'#3B82F6', bg:'bg-blue-50 dark:bg-blue-900/10' },
        ].map(({ label,value,sub,icon:Icon,c,bg }) => (
          <div key={label} className="rounded-xl border bg-white dark:bg-[#0C1830] border-gray-200 dark:border-blue-900/50 px-2.5 py-1.5 flex items-center gap-2">
            <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={12} style={{ color:c }}/>
            </div>
            <div className="min-w-0">
              <div className="text-[9px] text-gray-400 leading-none truncate">{label}</div>
              <div className="text-base font-extrabold text-gray-900 dark:text-white leading-tight">{typeof value==='number'?value.toLocaleString():value}</div>
              <div className="text-[9px] font-semibold leading-none" style={{ color:c }}>{sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── 3 Content Rows ── */}
      <div className="flex-1 min-h-0 flex flex-col gap-1">

        {/* ── Row 2 ── */}
        <div className="flex-1 min-h-0 grid grid-cols-3 gap-1">

          {/* Machine Loading */}
          <Card title="Machine Loading (%)">
            {machineLoading.length===0
              ? <div className="flex-1 flex items-center justify-center text-[9px] text-gray-400">No data</div>
              : machineLoading.map(({ size, pct }) => {
                  const c=pct>=70?'#22C55E':pct>=40?'#3B82F6':pct>=20?'#F59E0B':'#EF4444';
                  return (
                    <div key={size} className="flex-1 flex items-center gap-1.5 min-h-0">
                      <span className="w-9 text-[9px] font-bold text-gray-500 dark:text-gray-400 text-right flex-none">{size}T</span>
                      <HBar pct={pct} color={c} thick/>
                      <span className="w-7 text-[9px] font-bold text-right flex-none" style={{ color:c }}>{pct}%</span>
                    </div>
                  );
                })
            }
          </Card>

          {/* Qty Due Date */}
          <Card title="Qty Due Date (Pcs)">
            <div className="flex-1 min-h-0 grid grid-cols-2 gap-1">
              {qtyBuckets.map(({ label,qty,color,bg }) => (
                <div key={label} className={`rounded-lg ${bg} p-1.5 flex flex-col justify-between`}>
                  <span className="text-[8.5px] text-gray-500 dark:text-gray-400 font-medium leading-none">{label}</span>
                  <span className="text-lg font-extrabold leading-none mt-0.5 truncate" style={{ color }}>{fmtQty(qty)}</span>
                  <span className="text-[7.5px] text-gray-400 leading-none">Pcs</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Production Load by Day */}
          <Card title="Production Load by Day">
            <DailyBusyChart data={dailyBusy} isDark={isDark} totalMachines={machines.length}/>
          </Card>
        </div>

        {/* ── Row 3 ── */}
        <div className="flex-1 min-h-0 grid gap-1" style={{ gridTemplateColumns:'1fr 1.3fr 1.7fr' }}>

          {/* Status Distribution */}
          <Card title="Status Distribution">
            <div className="flex-1 min-h-0 flex gap-2">
              {/* Donut: 40% of card width, centered vertically */}
              <div className="flex-none flex items-center justify-center" style={{ width:'38%' }}>
                <div className="w-full">
                  <DonutChart segments={statusSegs} isDark={isDark}/>
                </div>
              </div>
              {/* Legend: evenly distributed */}
              <div className="flex-1 min-h-0 flex flex-col justify-evenly">
                {statusSegs.length===0
                  ? <div className="text-[9px] text-gray-400">No data</div>
                  : statusSegs.map(({ label,value,color }) => (
                    <div key={label} className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor:color }}/>
                      <span className="flex-1 text-[9px] text-gray-600 dark:text-gray-300 truncate">{label}</span>
                      <span className="text-[9px] font-bold text-gray-800 dark:text-white w-6 text-right">{value}</span>
                      <span className="text-[8px] text-gray-400 w-7 text-right">{stats.total?`${Math.round(value/stats.total*100)}%`:'0%'}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </Card>

          {/* High Qty Parts — div rows with flex-1 */}
          <Card title={`High Qty Parts – ${selectedDays}D`}>
            {/* Header */}
            <div className="flex items-center gap-1 border-b border-gray-100 dark:border-blue-900/30 pb-0.5 mb-0 flex-none">
              <span className="flex-1 text-[8px] font-semibold text-gray-400">UNC Code</span>
              <span className="w-14 text-right text-[8px] font-semibold text-gray-400">Qty (Pcs)</span>
              <span className="w-8 text-center text-[8px] font-semibold text-gray-400">Ord</span>
              <span className="w-16 pl-1 text-[8px] font-semibold text-gray-400"></span>
            </div>
            {highQtyParts.length===0
              ? <div className="flex-1 flex items-center justify-center text-[9px] text-gray-400">No data in range</div>
              : highQtyParts.slice(0,9).map(({ code,qty,orders:cnt }) => (
                <div key={code} className="flex-1 flex items-center gap-1 border-b border-gray-50 dark:border-blue-900/10 min-h-0">
                  <span className="flex-1 text-[9px] font-mono font-bold truncate" style={{ color:'#F36B21' }}>{code}</span>
                  <span className="w-14 text-right text-[9px] font-bold text-gray-700 dark:text-white">{fmtQty(qty)}</span>
                  <span className="w-8 text-center text-[9px] text-gray-500">{cnt}</span>
                  <div className="w-16 pl-1"><HBar pct={Math.round(qty/maxHQty*100)} color="#3B82F6"/></div>
                </div>
              ))
            }
          </Card>

          {/* Recent Activity */}
          <Card title="Recent Activity">
            <div className="flex-1 min-h-0 overflow-y-auto">
              {history.length===0
                ? <div className="text-[9px] text-gray-400 flex items-center justify-center h-full">No activity</div>
                : (
                  <table className="w-full text-[10px] border-collapse">
                    <thead className="sticky top-0 bg-white dark:bg-[#0C1830]">
                      <tr className="border-b border-gray-100 dark:border-blue-900/30">
                        <th className="text-left pb-0.5 text-[8px] font-semibold text-gray-400 whitespace-nowrap pr-2">Time</th>
                        <th className="text-left pb-0.5 text-[8px] font-semibold text-gray-400 pr-2">UNC Code</th>
                        <th className="text-left pb-0.5 text-[8px] font-semibold text-gray-400 pr-2">Change</th>
                        <th className="text-left pb-0.5 text-[8px] font-semibold text-gray-400">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map(h => {
                        const badge = EVENT_BADGE[h.event_type];
                        return (
                          <tr key={h.id} className="border-t border-gray-50 dark:border-blue-900/20 hover:bg-orange-50/20 dark:hover:bg-blue-900/20">
                            <td className="py-0.5 pr-2 text-[8.5px] text-gray-400 whitespace-nowrap font-mono">{fmtTime(h.created_at)}</td>
                            <td className="py-0.5 pr-2 text-[9px] font-bold whitespace-nowrap" style={{ color:'#F36B21' }}>{h.unc_codes||h.order_ref}</td>
                            <td className="py-0.5 pr-2 whitespace-nowrap">
                              {badge
                                ? <span className={`px-1 py-0.5 rounded-full text-[7.5px] font-bold ${badge.cls}`}>{badge.label}</span>
                                : <span className="text-[8.5px] text-gray-500">{h.field_name??h.event_type}</span>
                              }
                            </td>
                            <td className="py-0.5 text-[8.5px] text-gray-400 truncate max-w-[60px]">{h.changed_by||'—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              }
            </div>
          </Card>
        </div>

        {/* ── Row 4 ── */}
        <div className="flex-1 min-h-0 grid grid-cols-4 gap-1">

          {/* Customer Workload */}
          <Card title="Customer Workload (Pcs)">
            <div className="flex-1 min-h-0 flex gap-2">
              <div className="flex-none flex items-center justify-center" style={{ width:'40%' }}>
                <div className="w-full"><DonutChart segments={customerSegs} isDark={isDark}/></div>
              </div>
              <div className="flex-1 min-h-0 flex flex-col justify-evenly overflow-hidden">
                {customerSegs.length===0
                  ? <div className="text-[9px] text-gray-400">No data</div>
                  : customerSegs.map(({ label,value,color }) => (
                    <div key={label} className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor:color }}/>
                      <span className="flex-1 text-[9px] text-gray-500 dark:text-gray-400 truncate">{label}</span>
                      <span className="text-[9px] font-bold text-gray-700 dark:text-white">{fmtQty(value)}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </Card>

          {/* Size Distribution */}
          <Card title="Size Distribution (T)">
            <div className="flex-1 min-h-0 flex gap-2">
              <div className="flex-none flex items-center justify-center" style={{ width:'40%' }}>
                <div className="w-full"><DonutChart segments={sizeSegs} isDark={isDark}/></div>
              </div>
              <div className="flex-1 min-h-0 flex flex-col justify-evenly overflow-hidden">
                {sizeSegs.length===0
                  ? <div className="text-[9px] text-gray-400">No data</div>
                  : sizeSegs.map(({ label,value,color }) => (
                    <div key={label} className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor:color }}/>
                      <span className="flex-1 text-[9px] text-gray-500 dark:text-gray-400">{label}</span>
                      <span className="text-[9px] font-bold text-gray-700 dark:text-white">{value.toLocaleString()}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          </Card>

          {/* Planner Performance */}
          <Card title="Planner Performance">
            {/* Header */}
            <div className="flex items-center border-b border-gray-100 dark:border-blue-900/30 pb-0.5 flex-none">
              <span className="flex-1 text-[8px] font-semibold text-gray-400">Planner</span>
              <span className="w-8 text-right text-[8px] font-semibold text-gray-400">Tot</span>
              <span className="w-8 text-right text-[8px] font-semibold text-gray-400">Plan</span>
              <span className="w-9 text-right text-[8px] font-semibold text-gray-400">Unpl</span>
              <span className="w-8 text-right text-[8px] font-semibold text-gray-400">Urg</span>
            </div>
            {plannerPerf.length===0
              ? <div className="flex-1 flex items-center justify-center text-[9px] text-gray-400">No data</div>
              : plannerPerf.map(({ name,total,planned,unplanned,urgent }) => (
                <div key={name} className="flex-1 flex items-center border-b border-gray-50 dark:border-blue-900/10 min-h-0">
                  <span className="flex-1 text-[9px] font-medium text-gray-700 dark:text-gray-200 truncate">{name}</span>
                  <span className="w-8 text-right text-[9px] font-bold text-gray-800 dark:text-white">{total}</span>
                  <span className="w-8 text-right text-[9px] text-green-600 font-semibold">{planned}</span>
                  <span className="w-9 text-right text-[9px] text-amber-600 font-semibold">{unplanned}</span>
                  <span className="w-8 text-right text-[9px] text-orange-600 font-semibold">{urgent}</span>
                </div>
              ))
            }
          </Card>

          {/* Aging */}
          <Card title="Aging – Unplanned Orders">
            {aging.map(({ label,count,color }) => (
              <div key={label} className="flex-1 flex items-center gap-1.5 min-h-0">
                <span className="w-16 text-[9px] text-gray-500 dark:text-gray-400 flex-none">{label}</span>
                <HBar pct={Math.round(count/maxAging*100)} color={color}/>
                <span className="w-5 text-[9px] font-bold text-right flex-none" style={{ color }}>{count}</span>
              </div>
            ))}
            <div className="text-[7.5px] text-gray-400 flex-none mt-0.5">{orders.filter(o=>!o.is_planned).length} total unplanned</div>
          </Card>

        </div>
      </div>
    </div>
  );
}
