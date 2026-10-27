import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Trash2, RefreshCw, Plus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string | null;
  created_by: string | null;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return r;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay(); // 0=Sun
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

interface CalendarMonthProps {
  year: number;
  month: number;
  holidays: Set<string>;
  today: string;
  onToggle: (dateKey: string) => void;
}

function CalendarMonth({ year, month, holidays, today, onToggle }: CalendarMonthProps) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDow    = getFirstDayOfWeek(year, month);
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="bg-white dark:bg-[#0C1830] rounded-xl border border-gray-200 dark:border-blue-900/50 overflow-hidden">
      <div className="bg-gray-50 dark:bg-[#091526] px-4 py-2.5 border-b border-gray-200 dark:border-blue-900/50">
        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">
          {MONTHS[month]} {year}
        </span>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-7 mb-1">
          {DAYS.map(d => (
            <div key={d} className={`text-center text-[10px] font-bold pb-1 ${d === 'Sun' || d === 'Sat' ? 'text-orange-400' : 'text-gray-400 dark:text-gray-500'}`}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((day, i) => {
            if (!day) return <div key={i} />;
            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dow = (firstDow + day - 1) % 7;
            const isWeekend = dow === 0 || dow === 6;
            const isHoliday = holidays.has(dateKey);
            const isToday   = dateKey === today;
            let cls = 'relative h-8 w-full rounded-lg flex items-center justify-center text-[11px] font-semibold cursor-pointer transition-all select-none ';
            if (isHoliday) {
              cls += 'bg-red-500 text-white shadow-sm hover:bg-red-600 ';
            } else if (isWeekend) {
              cls += 'bg-orange-50 dark:bg-orange-900/15 text-orange-500 hover:bg-red-100 dark:hover:bg-red-900/20 ';
            } else {
              cls += 'bg-gray-50 dark:bg-[#091526] text-gray-700 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/15 ';
            }
            if (isToday) cls += 'ring-2 ring-[#F36B21] ';
            return (
              <button
                key={i}
                title={isHoliday ? 'Click to remove holiday' : 'Click to set as holiday'}
                className={cls}
                onClick={() => onToggle(dateKey)}
              >
                {day}
                {isHoliday && (
                  <span className="absolute top-0 right-0.5 text-[8px] leading-none">✕</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function WorkingDays() {
  const { user } = useAuth();
  const [holidays, setHolidays]   = useState<Holiday[]>([]);
  const [loading, setLoading]     = useState(true);
  const [viewDate, setViewDate]   = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [addDate, setAddDate]           = useState('');
  const [addName, setAddName]           = useState('');
  const [addSaving, setAddSaving]       = useState(false);

  const today = toDateKey(new Date());

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('holidays').select('*').order('date');
    if (data) setHolidays(data as Holiday[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchHolidays(); }, [fetchHolidays]);

  const holidaySet = new Set(holidays.map(h => h.date));

  async function handleToggle(dateKey: string) {
    const existing = holidays.find(h => h.date === dateKey);
    if (existing) {
      // Remove
      setHolidays(prev => prev.filter(h => h.id !== existing.id));
      await supabase.from('holidays').delete().eq('id', existing.id);
    } else {
      // Add
      const newH: Omit<Holiday, 'id'> = { date: dateKey, name: null, created_by: user?.username ?? null };
      const { data } = await supabase.from('holidays').insert(newH).select().single();
      if (data) setHolidays(prev => [...prev, data as Holiday].sort((a, b) => a.date.localeCompare(b.date)));
    }
  }

  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault();
    if (!addDate) return;
    setAddSaving(true);
    const newH = { date: addDate, name: addName.trim() || null, created_by: user?.username ?? null };
    const { data } = await supabase.from('holidays').upsert(newH, { onConflict: 'date' }).select().single();
    if (data) setHolidays(prev => {
      const filtered = prev.filter(h => h.date !== addDate);
      return [...filtered, data as Holiday].sort((a, b) => a.date.localeCompare(b.date));
    });
    setAddDate('');
    setAddName('');
    setAddSaving(false);
    setShowAddModal(false);
  }

  async function handleDelete(id: string) {
    setHolidays(prev => prev.filter(h => h.id !== id));
    await supabase.from('holidays').delete().eq('id', id);
  }

  const months = [viewDate, addMonths(viewDate, 1), addMonths(viewDate, 2)];
  const upcomingHolidays = holidays.filter(h => h.date >= today).slice(0, 20);

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarDays size={16} className="text-[#F36B21]" />
          <span className="font-black text-gray-800 dark:text-gray-100 text-sm tracking-wide">
            Working Days &amp; Holidays
          </span>
        </div>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          Click any date to toggle as holiday
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={fetchHolidays}
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-[#F36B21] border border-gray-200 dark:border-blue-900/50 rounded-lg bg-white dark:bg-[#0C1830] transition-all"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F36B21] hover:bg-[#D4591A] text-white text-[11px] font-bold rounded-lg transition-all active:scale-95"
          >
            <Plus size={11} /> Add Holiday
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Calendar view */}
        <div className="flex-1 min-w-0">
          {/* Month navigation */}
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setViewDate(d => addMonths(d, -1))}
              className="px-2.5 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-blue-900/50 rounded-lg bg-white dark:bg-[#0C1830] hover:bg-gray-50 dark:hover:bg-white/5 transition-all"
            >
              ‹ Prev
            </button>
            <button
              onClick={() => setViewDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
              className="px-2.5 py-1 text-xs font-bold text-white bg-[#F36B21] hover:bg-[#D4591A] rounded-lg transition-all"
            >
              Today
            </button>
            <button
              onClick={() => setViewDate(d => addMonths(d, 1))}
              className="px-2.5 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-blue-900/50 rounded-lg bg-white dark:bg-[#0C1830] hover:bg-gray-50 dark:hover:bg-white/5 transition-all"
            >
              Next ›
            </button>
            <div className="flex items-center gap-3 ml-3 text-[10px] text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-red-500 inline-block" /> Holiday
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-orange-100 dark:bg-orange-900/30 border border-orange-300 inline-block" /> Weekend
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {months.map((m, i) => (
              <CalendarMonth
                key={i}
                year={m.getFullYear()}
                month={m.getMonth()}
                holidays={holidaySet}
                today={today}
                onToggle={handleToggle}
              />
            ))}
          </div>
        </div>

        {/* Upcoming holidays list */}
        <div className="w-full lg:w-64 flex-shrink-0">
          <div className="bg-white dark:bg-[#0C1830] rounded-xl border border-gray-200 dark:border-blue-900/50 overflow-hidden h-full flex flex-col">
            <div className="px-4 py-2.5 border-b border-gray-200 dark:border-blue-900/50 bg-gray-50 dark:bg-[#091526] flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-bold text-gray-800 dark:text-gray-100">Upcoming Holidays</span>
              <span className="text-[10px] text-gray-400">{upcomingHolidays.length} รายการ</span>
            </div>
            <div className="overflow-y-auto flex-1">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-[#F36B21]/20 border-t-[#F36B21] rounded-full animate-spin" />
                </div>
              ) : upcomingHolidays.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-xs">No holidays configured</div>
              ) : (
                upcomingHolidays.map(h => {
                  const d = new Date(h.date + 'T00:00:00');
                  const dow = d.getDay();
                  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow];
                  return (
                    <div key={h.id} className="flex items-center gap-2 px-3 py-2 border-b border-gray-50 dark:border-blue-900/30 last:border-0 group hover:bg-red-50 dark:hover:bg-red-900/10 transition-all">
                      <div className="w-9 h-9 rounded-lg bg-red-500 flex flex-col items-center justify-center flex-shrink-0">
                        <span className="text-white text-[8px] font-bold leading-none">{dayName}</span>
                        <span className="text-white text-sm font-black leading-none">{d.getDate()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-100 truncate">
                          {h.name || 'Holiday'}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {MONTHS[d.getMonth()]} {d.getFullYear()}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(h.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-all"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add holiday modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white dark:bg-[#0C1830] rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-gray-900 dark:bg-[#060F22] px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays size={14} className="text-[#F36B21]" />
                <span className="text-white font-bold text-sm">Add Holiday</span>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-all">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleAddManual} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest mb-1.5">
                  Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={addDate}
                  onChange={e => setAddDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-blue-900/50 rounded-xl text-sm bg-white dark:bg-[#0A1628] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#F36B21]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest mb-1.5">
                  Holiday Name <span className="text-gray-400 font-normal normal-case">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. New Year's Day"
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-blue-900/50 rounded-xl text-sm bg-white dark:bg-[#0A1628] dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#F36B21]"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-blue-900/50 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-all">
                  Cancel
                </button>
                <button type="submit" disabled={addSaving}
                  className="flex-[2] px-4 py-2.5 text-sm font-bold text-white bg-[#F36B21] hover:bg-[#D4591A] disabled:opacity-50 rounded-xl transition-all">
                  {addSaving ? 'Saving...' : 'Add Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
