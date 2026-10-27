import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Search, Trash2, RefreshCw, BookOpen, X, ChevronDown, Pencil, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SIZE_TON_OPTIONS } from '../types';
import type { PlanType, UserRole } from '../types';
import { canEdit } from '../contexts/AuthContext';

export interface UncPart {
  id: string;
  unc_code: string;
  unc_code_2: string | null;
  unc_code_3: string | null;
  unc_code_4: string | null;
  size_ton: number | null;
  plan_type: string;
  updated_at: string;
  created_at: string;
}

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

const PLAN_CLS: Record<string, string> = {
  White:  'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700/50',
  Yellow: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-yellow-300 border border-amber-200 dark:border-yellow-700/50',
};

interface EditState {
  id: string;
  unc_code: string;
  unc_code_2: string;
  unc_code_3: string;
  unc_code_4: string;
  size_ton: string;
  plan_type: string;
}

interface Props { role?: UserRole }

export default function PartList({ role = 'viewer' }: Props) {
  const isDark = useIsDark();
  const [parts, setParts]       = useState<UncPart[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [filterPlan, setFilterPlan] = useState<PlanType | 'All'>('All');
  const [deleteConfirm, setDeleteConfirm] = useState<UncPart | null>(null);
  const [editRow, setEditRow]   = useState<EditState | null>(null);
  const [saving, setSaving]     = useState(false);
  const canManage = canEdit(role);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('unc_parts')
      .select('*')
      .order('updated_at', { ascending: false });
    if (data) setParts(data as UncPart[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const filtered = useMemo(() => parts.filter(p => {
    if (filterPlan !== 'All' && p.plan_type !== filterPlan) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [p.unc_code, p.unc_code_2, p.unc_code_3, p.unc_code_4]
      .some(c => c?.toLowerCase().includes(q));
  }), [parts, search, filterPlan]);

  async function deletePart(part: UncPart) {
    await supabase.from('unc_parts').delete().eq('id', part.id);
    setParts(prev => prev.filter(p => p.id !== part.id));
    setDeleteConfirm(null);
  }

  function startEdit(part: UncPart) {
    setEditRow({
      id: part.id,
      unc_code: part.unc_code,
      unc_code_2: part.unc_code_2 ?? '',
      unc_code_3: part.unc_code_3 ?? '',
      unc_code_4: part.unc_code_4 ?? '',
      size_ton: part.size_ton != null ? String(part.size_ton) : '',
      plan_type: part.plan_type,
    });
  }

  async function saveEdit() {
    if (!editRow) return;
    setSaving(true);
    const { error } = await supabase.from('unc_parts').update({
      unc_code_2: editRow.unc_code_2.trim() || null,
      unc_code_3: editRow.unc_code_3.trim() || null,
      unc_code_4: editRow.unc_code_4.trim() || null,
      size_ton:   editRow.size_ton ? Number(editRow.size_ton) : null,
      plan_type:  editRow.plan_type,
      updated_at: new Date().toISOString(),
    }).eq('id', editRow.id);
    setSaving(false);
    if (!error) {
      setParts(prev => prev.map(p => p.id === editRow.id ? {
        ...p,
        unc_code_2: editRow.unc_code_2.trim() || null,
        unc_code_3: editRow.unc_code_3.trim() || null,
        unc_code_4: editRow.unc_code_4.trim() || null,
        size_ton:   editRow.size_ton ? Number(editRow.size_ton) : null,
        plan_type:  editRow.plan_type,
        updated_at: new Date().toISOString(),
      } : p));
      setEditRow(null);
    }
  }

  // Filter dropdown
  const [planOpen, setPlanOpen] = useState(false);
  const planRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!planRef.current?.contains(e.target as Node)) setPlanOpen(false); };
    if (planOpen) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [planOpen]);

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
      {/* Header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-brand-orange flex-shrink-0" />
          <span className="font-black text-gray-800 dark:text-gray-100 text-sm tracking-wide">Part List</span>
          <span className="text-xs text-gray-400 font-medium hidden sm:inline">— ข้อมูล UNC Code สำหรับช่วยคีย์แผน</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[11px] text-gray-400 font-medium">{parts.length} รายการ</span>
          <button onClick={fetch}
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-brand-orange border border-gray-200 dark:border-blue-900/50 rounded-lg bg-white dark:bg-[#0C1830] hover:bg-brand-orange-muted dark:hover:bg-orange-900/20 transition-all"
            title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" placeholder="ค้นหา UNC Code..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 text-sm border border-gray-200 dark:border-blue-900/50 rounded-xl bg-white dark:bg-[#0C1830] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-orange placeholder:text-gray-300 dark:placeholder:text-gray-600"
          />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={11}/></button>}
        </div>

        {/* Plan type filter */}
        <div ref={planRef} className="relative flex-shrink-0">
          <button onClick={() => setPlanOpen(v => !v)}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
              filterPlan !== 'All'
                ? 'bg-brand-orange border-brand-orange text-white'
                : 'bg-white dark:bg-[#0C1830] border-gray-200 dark:border-blue-900/50 text-gray-600 dark:text-gray-300'
            }`}>
            Type: <span className="font-bold">{filterPlan}</span>
            <ChevronDown size={10} className={`transition-transform ${planOpen ? 'rotate-180' : ''}`}/>
          </button>
          {planOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 rounded-xl shadow-xl overflow-hidden min-w-[110px]">
              {(['All','White','Yellow'] as const).map(v => (
                <button key={v} onClick={() => { setFilterPlan(v); setPlanOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 ${filterPlan===v ? 'bg-brand-orange/10 dark:bg-orange-900/20 text-brand-orange font-bold' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-blue-900/20 font-medium'}`}>
                  {v} {filterPlan===v && <span className="ml-auto text-brand-orange">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {(search || filterPlan !== 'All') && (
          <button onClick={() => { setSearch(''); setFilterPlan('All'); }}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-red-500 border border-red-200 dark:border-red-900/40 rounded-lg bg-red-50 dark:bg-red-900/10 hover:bg-red-100 transition-all flex-shrink-0">
            <X size={10}/> Clear
          </button>
        )}

        {(search || filterPlan !== 'All') && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            แสดง <span className="font-bold text-brand-orange">{filtered.length}</span> / {parts.length}
          </span>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-brand-orange/20 border-t-brand-orange rounded-full animate-spin"/>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 py-16 gap-2">
          <BookOpen size={32} className="opacity-20"/>
          <p className="text-sm">{search || filterPlan !== 'All' ? 'ไม่พบข้อมูล' : 'ยังไม่มีข้อมูล Part List — จะถูกเพิ่มอัตโนมัติเมื่อสร้างแผนการผลิต'}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-2xl border border-gray-200 dark:border-blue-900/50 shadow-sm min-h-0">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-brand-black dark:bg-[#070D1A] sticky top-0 z-10">
                {['UNC Code 1','UNC Code 2','UNC Code 3','UNC Code 4','Size Ton','Plan Type','Updated',''].map(h => (
                  <th key={h} className="text-left text-[11px] font-bold text-gray-400 uppercase tracking-wider px-3 py-2.5 border-b border-white/10 whitespace-nowrap first:pl-4 last:pr-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((part, idx) => {
                const isEditing = editRow?.id === part.id;
                const rowBg = idx % 2 === 0 ? 'bg-white dark:bg-[#0C1830]' : 'bg-gray-50/60 dark:bg-[#081323]';
                return (
                  <tr key={part.id} className={`border-b border-gray-100 dark:border-blue-900/30 transition-colors hover:bg-orange-50/30 dark:hover:bg-blue-900/10 group ${rowBg}`}>
                    {/* UNC Code 1 */}
                    <td className="px-3 py-2 pl-4">
                      <span className="font-mono font-black text-brand-black dark:text-gray-100 text-[13px]">{part.unc_code}</span>
                    </td>
                    {/* UNC Codes 2–4 */}
                    {(['unc_code_2','unc_code_3','unc_code_4'] as const).map(field => (
                      <td key={field} className="px-3 py-2">
                        {isEditing ? (
                          <input
                            value={editRow[field]}
                            onChange={e => setEditRow(prev => prev ? {...prev, [field]: e.target.value.toUpperCase()} : null)}
                            className="w-28 px-2 py-1 text-xs font-mono border border-blue-300 dark:border-blue-700 rounded-lg bg-white dark:bg-[#0A1628] text-gray-800 dark:text-gray-100 outline-none focus:ring-1 focus:ring-brand-orange"
                            placeholder="—"
                          />
                        ) : (
                          <span className="font-mono text-xs text-gray-600 dark:text-gray-300">
                            {part[field] ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </span>
                        )}
                      </td>
                    ))}
                    {/* Size Ton */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <select value={editRow.size_ton}
                          onChange={e => setEditRow(prev => prev ? {...prev, size_ton: e.target.value} : null)}
                          className="text-xs border border-blue-300 dark:border-blue-700 rounded-lg px-2 py-1 bg-white dark:bg-[#0A1628] text-gray-800 dark:text-gray-100 outline-none focus:ring-1 focus:ring-brand-orange">
                          <option value="">—</option>
                          {SIZE_TON_OPTIONS.map(v => <option key={v} value={v}>{v}T</option>)}
                        </select>
                      ) : (
                        <span className="text-gray-700 dark:text-gray-300 font-semibold text-xs">
                          {part.size_ton != null ? `${part.size_ton}T` : <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </span>
                      )}
                    </td>
                    {/* Plan Type */}
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <select value={editRow.plan_type}
                          onChange={e => setEditRow(prev => prev ? {...prev, plan_type: e.target.value} : null)}
                          className="text-xs border border-blue-300 dark:border-blue-700 rounded-lg px-2 py-1 bg-white dark:bg-[#0A1628] text-gray-800 dark:text-gray-100 outline-none focus:ring-1 focus:ring-brand-orange">
                          <option value="White">White</option>
                          <option value="Yellow">Yellow</option>
                        </select>
                      ) : (
                        <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold ${PLAN_CLS[part.plan_type] ?? ''}`}>
                          {part.plan_type}
                        </span>
                      )}
                    </td>
                    {/* Updated */}
                    <td className="px-3 py-2 text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {fmtDate(part.updated_at)}
                    </td>
                    {/* Actions */}
                    <td className="pr-3 py-2">
                      {canManage && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          {isEditing ? (
                            <>
                              <button onClick={saveEdit} disabled={saving}
                                className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-all" title="Save">
                                <Save size={13}/>
                              </button>
                              <button onClick={() => setEditRow(null)}
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/30 rounded-lg transition-all" title="Cancel">
                                <X size={13}/>
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(part)}
                                className="p-1.5 text-gray-400 hover:text-brand-orange hover:bg-brand-orange-muted dark:hover:bg-orange-900/20 rounded-lg transition-all" title="Edit">
                                <Pencil size={13}/>
                              </button>
                              <button onClick={() => setDeleteConfirm(part)}
                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all" title="Delete">
                                <Trash2 size={13}/>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0C1830] rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 dark:border-blue-900/50">
            <h3 className="font-black text-gray-900 dark:text-gray-100 text-base mb-2">ลบ Part?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              ลบ <span className="font-mono font-black text-brand-orange">{deleteConfirm.unc_code}</span> ออกจาก Part List?
              <br/><span className="text-xs text-gray-400">ข้อมูลคำสั่งผลิตไม่ถูกกระทบ</span>
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-blue-900/50 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-all">
                ยกเลิก
              </button>
              <button onClick={() => deletePart(deleteConfirm)}
                className="flex-1 px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl transition-all">
                ลบออก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
