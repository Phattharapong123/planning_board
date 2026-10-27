import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, List, LogOut, Bell, LayoutGrid, MapPin, Check, Shield, BarChart2, ChevronDown, User, KeyRound, Save, X, Menu, Moon, Sun, Activity, BookOpen, CalendarDays, Package, Monitor, ArrowRight, Code2 } from 'lucide-react';
import ProductionForm from './components/ProductionForm';
import ProductionBoard from './components/ProductionBoard';
import PlanBoard from './components/PlanBoard';
import WorkingDays from './components/WorkingDays';
import LoginPage from './components/LoginPage';
import UserManagement from './components/UserManagement';
import Dashboard from './components/Dashboard';
import DevDashboard from './components/DevDashboard';
import DeveloperControlCenter from './components/DeveloperControlCenter';
import PartList from './components/PartList';
import MasterPlan from './components/MasterPlan';
import NextPlanBoard from './components/NextPlanBoard';
import { useAuth, canCreate } from './contexts/AuthContext';
import { supabase } from './lib/supabase';
import type { AppNotification, SectionAccess } from './types';

type Page = 'board' | 'entry' | 'dashboard' | 'users' | 'devdash' | 'partlist' | 'workdays' | 'masterplan' | 'nextplan' | 'controlcenter';
type Section = 'smartproduction' | 'production_control';

const SECTION_META: Record<Section, { label: string; icon: typeof LayoutGrid; pages: Page[] }> = {
  smartproduction: {
    label: 'Smartproduction Board',
    icon: LayoutGrid,
    pages: ['board', 'entry', 'partlist', 'masterplan', 'dashboard', 'workdays', 'users'],
  },
  production_control: {
    label: 'Production Control Board',
    icon: Monitor,
    pages: ['nextplan', 'devdash', 'users'],
  },
};

function userSections(access: SectionAccess): Section[] {
  if (access === 'both') return ['smartproduction', 'production_control'];
  return [access];
}

interface NavItem { id: Page; label: string; icon: typeof LayoutGrid; adminOnly?: boolean; developerOnly?: boolean; plannerAccess?: boolean; masterPlanOnly?: boolean; section?: Section }
const NAV_ITEMS: NavItem[] = [
  { id: 'board',      label: 'Board',        icon: LayoutGrid, section: 'smartproduction' },
  { id: 'entry',      label: 'Plan List',    icon: List,      section: 'smartproduction' },
  { id: 'partlist',   label: 'Part List',    icon: BookOpen,  section: 'smartproduction' },
  { id: 'masterplan', label: 'Master Plan',  icon: Package, masterPlanOnly: true, section: 'smartproduction' },
  { id: 'dashboard',  label: 'Dashboard',    icon: BarChart2, section: 'smartproduction' },
  { id: 'workdays',   label: 'Working Days', icon: CalendarDays, plannerAccess: true, section: 'smartproduction' },
  { id: 'nextplan',   label: 'Production',   icon: Monitor,   developerOnly: false, section: 'production_control' },
  { id: 'devdash',    label: 'Analytics',    icon: Activity, developerOnly: true, section: 'production_control' },
  { id: 'controlcenter', label: 'Control Center', icon: Code2, developerOnly: true },
  { id: 'users',      label: 'Users',        icon: Shield, adminOnly: true },
];

const ROLE_LABEL: Record<string, string> = {
  developer: 'Developer',
  admin: 'Admin',
  machine_planner: 'Machine Planner',
  planner: 'Planner',
  viewer: 'Viewer',
};

// ── UNC Logo: image + "SMART / PRODUCTION BOARD" side by side ─────────────────
function UNCLogo({ dark }: { dark: boolean }) {
  return (
    <div className="flex items-center gap-2.5 flex-shrink-0 mr-4 pl-4">
      <img
        src={dark ? '/ChatGPT_Image_Jun_26,_2026,_01_21_02_PM.png' : '/Logo_UNC copy.png'}
        alt="UNC"
        style={{ height: dark ? 41 : 36, width: 'auto', objectFit: 'contain', display: 'block' }}
      />
      <div className="flex flex-col leading-[1.2]">
        <span className={`font-black italic text-[13px] tracking-wide whitespace-nowrap ${dark ? 'text-white' : 'text-gray-900'}`}>SMART</span>
        <span className={`font-black italic text-[11px] tracking-wide whitespace-nowrap ${dark ? 'text-gray-200' : 'text-gray-900'}`}>PRODUCTION BOARD</span>
      </div>
    </div>
  );
}

// ── Section Chooser (post-login) ────────────────────────────────────────────────
function SectionChooser({ sections, onPick }: { sections: Section[]; onPick: (s: Section) => void }) {
  return (
    <div className="h-screen bg-[#F1F0EF] dark:bg-[#070D1A] flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <img
            src={document.documentElement.classList.contains('dark') ? '/ChatGPT_Image_Jun_26,_2026,_01_21_02_PM.png' : '/Logo_UNC copy.png'}
            alt="UNC"
            style={{ height: 56, width: 'auto', objectFit: 'contain', display: 'block', margin: '0 auto 16px' }}
          />
          <h1 className="text-xl font-black text-gray-800 dark:text-white">เลือก Section</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">เลือก Section ที่ต้องการเข้าใช้งาน</p>
        </div>
        <div className="flex flex-col gap-3">
          {sections.map(s => {
            const meta = SECTION_META[s];
            const Icon = meta.icon;
            return (
              <button
                key={s}
                onClick={() => onPick(s)}
                className="group flex items-center gap-4 p-5 bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 rounded-2xl shadow-sm hover:shadow-md hover:border-[#F36B21] dark:hover:border-[#F36B21] transition-all active:scale-[0.98]"
              >
                <div className="w-12 h-12 rounded-xl bg-[#F36B21]/10 dark:bg-[#F36B21]/20 flex items-center justify-center flex-shrink-0 group-hover:bg-[#F36B21] group-hover:text-white transition-colors">
                  <Icon size={22} className="text-[#F36B21] group-hover:text-white transition-colors" />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-bold text-gray-800 dark:text-white text-sm">{meta.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{meta.pages.filter(p => p !== 'users').length} หน้างาน</div>
                </div>
                <ArrowRight size={18} className="text-gray-300 group-hover:text-[#F36B21] transition-colors" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
// ── Profile Edit Modal ─────────────────────────────────────────────────────────
function ProfileModal({ username, displayName, onClose, onSaved }: {
  username: string;
  displayName: string;
  onClose: () => void;
  onSaved: (newDisplayName: string) => void;
}) {
  const [name, setName]       = useState(displayName);
  const [curPw, setCurPw]     = useState('');
  const [pw, setPw]           = useState('');
  const [pw2, setPw2]         = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [ok, setOk]           = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!curPw) { setError('กรุณาใส่รหัสผ่านปัจจุบัน'); return; }
    if (pw && pw !== pw2) { setError('รหัสผ่านใหม่ไม่ตรงกัน'); return; }
    if (pw && pw.length < 4) { setError('รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร'); return; }
    setSaving(true);
    // Verify current password via verify_login
    const { data: verifyData } = await supabase.rpc('verify_login', { p_username: username, p_password: curPw });
    if (!verifyData || verifyData.length === 0) {
      setSaving(false);
      setError('รหัสผ่านปัจจุบันไม่ถูกต้อง');
      return;
    }
    const { data, error: rpcErr } = await supabase.rpc('update_own_profile', {
      p_username:     username,
      p_display_name: name.trim() || null,
      p_new_password: pw || null,
    });
    setSaving(false);
    if (rpcErr || !data) { setError(rpcErr?.message ?? 'เกิดข้อผิดพลาด'); return; }
    setOk(true);
    setTimeout(() => { onSaved(name.trim() || displayName); onClose(); }, 1200);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gray-900 dark:bg-gray-800 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User size={14} className="text-[#F36B21]" />
            <span className="text-white font-bold text-sm">แก้ไขโปรไฟล์</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-all">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSave} className="p-5 space-y-4">
          {ok && (
            <div className="bg-green-50 border border-green-300 rounded-xl px-3 py-2 text-green-700 text-sm font-semibold">
              บันทึกสำเร็จ!
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">Display Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F36B21] focus:border-transparent"
              placeholder={displayName} />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">รหัสผ่านใหม่ <span className="font-normal normal-case text-gray-400">(เว้นว่างถ้าไม่เปลี่ยน)</span></label>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F36B21] focus:border-transparent" />
          </div>
          {pw && (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">ยืนยันรหัสผ่านใหม่</label>
              <input type="password" value={pw2} onChange={e => setPw2(e.target.value)}
                placeholder="••••••••"
                className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F36B21] focus:border-transparent ${pw2 && pw !== pw2 ? 'border-red-400 bg-red-50' : 'border-gray-200'}`} />
            </div>
          )}
          <div className="border-t border-gray-100 pt-4">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
              <KeyRound size={10} /> รหัสผ่านปัจจุบัน <span className="text-red-400">*</span>
            </label>
            <input type="password" value={curPw} onChange={e => setCurPw(e.target.value)}
              placeholder="ใส่รหัสผ่านปัจจุบันเพื่อยืนยัน"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F36B21] focus:border-transparent" />
          </div>
          {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
          <button type="submit" disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#F36B21] hover:bg-[#D4591A] text-white text-sm font-bold rounded-xl transition-all shadow-md shadow-[#F36B21]/25 active:scale-95 disabled:opacity-60">
            <Save size={14} />
            {saving ? 'กำลังตรวจสอบ...' : 'บันทึก'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading, logout } = useAuth();
  const [page, setPage]           = useState<Page>('board');
  const [section, setSection]     = useState<Section | null>(null);
  const [showForm, setShowForm]   = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [highlightOrderId, setHighlightOrderId] = useState<string | null>(null);
  const [boardInitSearch, setBoardInitSearch] = useState<string | undefined>(undefined);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showBell, setShowBell]   = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sharedSizeGroup, setSharedSizeGroup] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isDark, setIsDark]       = useState(() => localStorage.getItem('theme') === 'dark');
  const bellRef     = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Clear eye-button search when leaving the board so returning to board starts fresh
  useEffect(() => {
    if (page !== 'board') setBoardInitSearch(undefined);
  }, [page]);

  // Apply dark class to html element
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('for_username', user.username)
      .order('created_at', { ascending: false })
      .limit(40);
    if (data) setNotifications(data as AppNotification[]);
  }, [user]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setShowBell(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function acknowledgeOne(notif: AppNotification) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id);
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
  }

  async function markAllRead() {
    if (!user) return;
    await supabase.from('notifications').update({ is_read: true }).eq('for_username', user.username);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  }

  function goToCard(notif: AppNotification) {
    if (!notif.order_id) return;
    setShowBell(false);
    setPage('board');
    setHighlightOrderId(notif.order_id);
    acknowledgeOne(notif);
    setTimeout(() => setHighlightOrderId(null), 3000);
  }

  if (loading) {
    return (
      <div className="h-screen bg-[#050708] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#F36B21] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const availableSections = userSections(user.sectionAccess);
  if (availableSections.length === 0) return <LoginPage />;
  if (!section) {
    if (availableSections.length === 1) {
      setSection(availableSections[0]);
      return null;
    }
    return <SectionChooser sections={availableSections} onPick={s => {
      setSection(s);
      setPage(SECTION_META[s].pages[0]);
    }} />;
  }
  if (section && !availableSections.includes(section)) {
    setSection(null);
    return null;
  }

  function handleSaved() { setShowForm(false); setRefreshKey(k => k + 1); }
  function handleCreated() { setRefreshKey(k => k + 1); }
  function handleGoToBoard(orderId: string) {
    setBoardInitSearch(orderId);
    setPage('board');
  }
  function handleProfileSaved(newDisplayName: string) {
    // Update the stored auth user's display name
    const stored = localStorage.getItem('auth_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        localStorage.setItem('auth_user', JSON.stringify({ ...parsed, displayName: newDisplayName }));
      } catch { /* ignore */ }
    }
    // Force page reload to reflect new display name
    window.location.reload();
  }

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const MASTER_PLAN_USERS = ['chawankorn', 'dev1'];
  const visibleNavItems = NAV_ITEMS.filter(item => {
    if (item.section && item.section !== section) return false;
    if (item.developerOnly) return user.role === 'developer';
    if (item.adminOnly) return user.role === 'admin' || user.role === 'developer';
    if (item.plannerAccess) return user.role === 'admin' || user.role === 'developer' || user.role === 'machine_planner';
    if (item.masterPlanOnly) return MASTER_PLAN_USERS.includes(user.username?.toLowerCase() ?? '');
    return true;
  });

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#F1F0EF] dark:bg-[#070D1A]">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="bg-white dark:bg-[#0A1628] border-b border-gray-200 dark:border-blue-900/50 sticky top-0 z-[60] shadow-sm">
        <div className="max-w-[1800px] mx-auto flex items-center h-14">
          <UNCLogo dark={isDark} />

          {/* Nav tabs — hidden on mobile */}
          <nav className="hidden md:flex items-center gap-1 ml-2">
            {visibleNavItems.map(item => {
              const Icon = item.icon;
              const active = page === item.id;
              return (
                <button key={item.id} onClick={() => setPage(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all ${
                    active ? 'bg-[#F36B21] text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <Icon size={14} />{item.label}
                </button>
              );
            })}
          </nav>

          {/* Right actions */}
          <div className="ml-auto flex items-center gap-1.5 pr-4">

            {/* Dark mode toggle */}
            <button
              onClick={() => setIsDark(v => !v)}
              className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-all"
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            {/* Notification Bell */}
            <div className="relative" ref={bellRef}>
              <button onClick={() => { setShowBell(v => !v); if (!showBell) fetchNotifications(); }}
                className="relative p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-all">
                <Bell size={15} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-extrabold rounded-full flex items-center justify-center px-0.5 ring-2 ring-white dark:ring-gray-900">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {showBell && (
                <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/60 rounded-xl shadow-2xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-blue-900/50">
                    <div className="flex items-center gap-2">
                      <Bell size={13} className="text-[#F36B21]" />
                      <span className="text-gray-800 dark:text-gray-100 text-sm font-bold">Notifications</span>
                      {unreadCount > 0 && <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{unreadCount}</span>}
                    </div>
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-[11px] text-[#F36B21] hover:text-orange-500 font-semibold">Mark all read</button>
                    )}
                  </div>
                  <div className="max-h-[360px] overflow-y-auto divide-y divide-gray-50 dark:divide-gray-700/50">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center text-gray-400 text-sm">No notifications</div>
                    ) : notifications.map(n => (
                      <div key={n.id} className={`px-4 py-3 ${n.is_read ? '' : 'bg-orange-50/60 dark:bg-orange-900/10'}`}>
                        <div className="flex items-start gap-2.5">
                          <span className={`mt-1 block w-2 h-2 rounded-full flex-shrink-0 ${n.is_read ? 'bg-gray-300' : 'bg-red-500'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-800 dark:text-gray-100 font-bold truncate">{n.order_ref}</div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 break-words leading-relaxed">{n.message}</div>
                            <div className="text-[10px] text-gray-400 mt-1">
                              {new Date(n.created_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </div>
                            <div className="flex items-center gap-2 mt-1.5">
                              {n.order_id && (
                                <button onClick={() => goToCard(n)}
                                  className="flex items-center gap-1 text-[10px] font-semibold text-[#F36B21] bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 px-2 py-1 rounded-md transition-all">
                                  <MapPin size={9} /> Go to
                                </button>
                              )}
                              {!n.is_read && (
                                <button onClick={() => acknowledgeOne(n)}
                                  className="flex items-center gap-1 text-[10px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 px-2 py-1 rounded-md transition-all">
                                  <Check size={9} /> Acknowledge
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* User menu */}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu(v => !v)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-all"
              >
                <div className="w-7 h-7 rounded-full bg-[#F36B21] flex items-center justify-center flex-shrink-0 shadow-sm">
                  <span className="text-white text-[11px] font-black leading-none">{user.displayName.charAt(0).toUpperCase()}</span>
                </div>
                <div className="hidden sm:flex flex-col leading-tight text-left">
                  <span className="text-[12px] font-bold text-gray-800 dark:text-gray-100">{user.displayName}</span>
                  <span className="text-[10px] text-gray-400">{SECTION_META[section].label}</span>
                </div>
                <ChevronDown size={12} className="text-gray-400 hidden sm:block" />
              </button>

              {showUserMenu && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/60 rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-100 dark:border-blue-900/50">
                    <div className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">{user.displayName}</div>
                    <div className="text-[10px] text-gray-400">{SECTION_META[section].label}</div>
                  </div>
                  {availableSections.length > 1 && (
                    <div className="py-1 border-b border-gray-100 dark:border-blue-900/50">
                      <div className="px-3 pt-1.5 pb-1 text-[9px] font-bold text-gray-400 uppercase tracking-wider">Switch Section</div>
                      {availableSections.filter(s => s !== section).map(s => {
                        const Meta = SECTION_META[s];
                        const Icon = Meta.icon;
                        return (
                          <button
                            key={s}
                            onClick={() => {
                              setShowUserMenu(false);
                              setSection(s);
                              setPage(SECTION_META[s].pages[0]);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                          >
                            <Icon size={13} className="text-[#F36B21]" /> {Meta.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <button
                    onClick={() => { setShowUserMenu(false); setShowProfile(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                  >
                    <User size={13} className="text-gray-400" /> แก้ไขโปรไฟล์
                  </button>
                  <button
                    onClick={() => { setShowUserMenu(false); setIsDark(v => !v); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all"
                  >
                    {isDark ? <Sun size={13} className="text-yellow-400" /> : <Moon size={13} className="text-gray-400" />}
                    {isDark ? 'Light Mode' : 'Dark Mode'}
                  </button>
                  <button
                    onClick={() => { setShowUserMenu(false); logout(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                  >
                    <LogOut size={13} /> ออกจากระบบ
                  </button>
                </div>
              )}
            </div>

            {/* Create Plan button */}
            {canCreate(user.role) && (
              <button onClick={() => setShowForm(true)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 bg-[#F36B21] hover:bg-[#D4591A] text-white text-sm font-bold rounded-xl shadow shadow-[#F36B21]/25 transition-all active:scale-95">
                <Plus size={13} />
                <span className="hidden lg:inline">CREATE PLAN</span>
                <span className="lg:hidden">New</span>
              </button>
            )}

            {/* Mobile hamburger */}
            <button onClick={() => setShowMobileMenu(v => !v)}
              className="md:hidden p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-lg transition-all">
              <Menu size={18} />
            </button>
          </div>
        </div>

        {/* Mobile nav menu */}
        {showMobileMenu && (
          <div className="md:hidden border-t border-gray-100 dark:border-blue-900/50 bg-white dark:bg-[#0A1628] px-4 py-3 flex flex-col gap-1">
            {visibleNavItems.map(item => {
              const Icon = item.icon;
              const active = page === item.id;
              return (
                <button key={item.id} onClick={() => { setPage(item.id); setShowMobileMenu(false); }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    active ? 'bg-[#F36B21] text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}>
                  <Icon size={15} />{item.label}
                </button>
              );
            })}
            {canCreate(user.role) && (
              <button onClick={() => { setShowForm(true); setShowMobileMenu(false); }}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-[#F36B21] border border-[#F36B21]/30 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all mt-1">
                <Plus size={15} /> Create Plan
              </button>
            )}
          </div>
        )}
      </header>

      {/* ── Main content ──────────────────────────────────────────── */}
      <main className={`flex-1 flex flex-col w-full py-3 min-h-0 overflow-hidden transition-all ${isFullscreen ? 'px-2' : 'max-w-[1800px] mx-auto px-3 md:px-4'}`}>
        {page === 'board' && section === 'smartproduction' && (
          <PlanBoard
            key={`board-${refreshKey}-${boardInitSearch ?? ''}`}
            role={user.role}
            highlightOrderId={highlightOrderId}
            initialSearch={boardInitSearch}
            sizeGroup={sharedSizeGroup}
            onSizeGroupChange={setSharedSizeGroup}
          />
        )}
        {page === 'entry' && section === 'smartproduction' && <ProductionBoard refresh={refreshKey} role={user.role} onGoToBoard={handleGoToBoard} />}
        {page === 'partlist' && section === 'smartproduction' && <PartList role={user.role} />}
        {page === 'masterplan' && section === 'smartproduction' && <MasterPlan />}
        {page === 'dashboard' && section === 'smartproduction' && <Dashboard role={user.role} sizeGroup={sharedSizeGroup} onSizeGroupChange={setSharedSizeGroup} />}
        {page === 'devdash' && section === 'production_control' && <DevDashboard />}
        {page === 'nextplan' && section === 'production_control' && <NextPlanBoard />}
        {page === 'controlcenter' && user.role === 'developer' && <DeveloperControlCenter />}
        {page === 'users' && (user.role === 'admin' || user.role === 'developer') && <UserManagement />}
        {page === 'workdays' && section === 'smartproduction' && (user.role === 'admin' || user.role === 'developer' || user.role === 'machine_planner') && <WorkingDays />}
      </main>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer className="bg-white dark:bg-[#0A1628] border-t border-gray-200 dark:border-blue-900/50 px-4 py-1.5 text-[10px] text-gray-400 flex items-center justify-between">
        <span className="font-black tracking-widest text-[#F36B21] text-xs">UNC</span>
        <span className="hidden sm:inline select-none">© {new Date().getFullYear()} UNC Smart Production Board System · Developed by Chawankorn.l PL Dep.</span>
      </footer>

      {showForm && (
        <ProductionForm onSaved={handleSaved} onCreated={handleCreated} onCancel={() => setShowForm(false)} />
      )}
      {showProfile && (
        <ProfileModal
          username={user.username}
          displayName={user.displayName}
          onClose={() => setShowProfile(false)}
          onSaved={handleProfileSaved}
        />
      )}
    </div>
  );
}
