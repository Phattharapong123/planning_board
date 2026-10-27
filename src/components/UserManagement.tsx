import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, User, Shield, RefreshCw, Save, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { SectionAccess } from '../types';

type UserRole = 'developer' | 'admin' | 'machine_planner' | 'planner' | 'viewer';

interface AppUser {
  id: string;
  username: string;
  role: UserRole;
  display_name: string;
  password_plain: string | null;
  section_access: SectionAccess;
  created_at: string;
}

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'developer',       label: 'Developer' },
  { value: 'admin',           label: 'Admin' },
  { value: 'machine_planner', label: 'Machine Planner' },
  { value: 'planner',         label: 'Planner' },
  { value: 'viewer',          label: 'Viewer' },
];

const ROLE_BADGE: Record<UserRole, string> = {
  developer:       'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800',
  admin:           'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800',
  machine_planner: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800',
  planner:         'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800',
  viewer:          'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700',
};

const SECTION_OPTIONS: { value: SectionAccess; label: string }[] = [
  { value: 'both',              label: 'ทั้ง 2 Section' },
  { value: 'smartproduction',   label: 'Smartproduction Board' },
  { value: 'production_control', label: 'Production Control Board' },
];

const SECTION_BADGE: Record<SectionAccess, string> = {
  both:              'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800',
  smartproduction:   'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800',
  production_control:'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800',
};

const SECTION_LABEL: Record<SectionAccess, string> = {
  both: 'ทั้ง 2 Section',
  smartproduction: 'Smartproduction',
  production_control: 'Production Control',
};

interface UserFormState {
  username: string;
  displayName: string;
  role: UserRole;
  password: string;
  sectionAccess: SectionAccess;
}

function blankForm(): UserFormState {
  return { username: '', displayName: '', role: 'planner', password: '', sectionAccess: 'both' };
}

interface UserDialogProps {
  editUser?: AppUser;
  callerRole: UserRole;
  onClose: () => void;
  onSaved: () => void;
}

function UserDialog({ editUser, callerRole, onClose, onSaved }: UserDialogProps) {
  const isEdit = !!editUser;
  const isDeveloper = callerRole === 'developer';
  const [form, setForm] = useState<UserFormState>(() =>
    editUser
      ? { username: editUser.username, displayName: editUser.display_name, role: editUser.role, password: '', sectionAccess: editUser.section_access ?? 'both' }
      : blankForm()
  );
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectableRoles = ROLE_OPTIONS.filter(r => isDeveloper || r.value !== 'developer');

  async function handleSave() {
    if (!form.username.trim() || !form.displayName.trim()) {
      setError('Username and Display Name are required');
      return;
    }
    if (!isEdit && !form.password.trim()) {
      setError('Password is required for new users');
      return;
    }
    if (!isDeveloper && form.role === 'developer') {
      setError('Only Developer accounts can create Developer users');
      return;
    }
    setSaving(true);
    const { error: rpcErr } = await supabase.rpc('admin_upsert_user', {
      p_username:      form.username.trim(),
      p_password:      form.password.trim(),
      p_role:          form.role,
      p_display_name:  form.displayName.trim(),
      p_section_access: form.sectionAccess,
    });
    setSaving(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    onSaved();
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-blue-900/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F36B21] bg-white dark:bg-[#091526] text-gray-800 dark:text-gray-200';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#0C1830] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-[#0A0B0D] dark:bg-[#070D1A] px-6 py-4 flex items-center justify-between border-b border-blue-900/50">
          <div className="flex items-center gap-2">
            <User size={14} className="text-[#F36B21]" />
            <span className="text-white font-bold text-sm">{isEdit ? 'Edit User' : 'Add User'}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X size={16} /></button>
        </div>
        <div className="p-6 flex flex-col gap-4">
          {error && <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 rounded-lg">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Username</label>
              <input
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                disabled={isEdit}
                className={inputCls + (isEdit ? ' opacity-50 cursor-not-allowed' : '')}
                placeholder="username"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Display Name</label>
              <input
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                className={inputCls}
                placeholder="Full Name"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Role</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))}
                className={inputCls}
              >
                {selectableRoles.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Section Access</label>
              <select
                value={form.sectionAccess}
                onChange={e => setForm(f => ({ ...f, sectionAccess: e.target.value as SectionAccess }))}
                className={inputCls}
              >
                {SECTION_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
              Password {isEdit && <span className="text-gray-400 font-normal">(leave blank to keep)</span>}
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className={inputCls + ' pr-10'}
                placeholder={isEdit ? '••••••••' : 'New password'}
              />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#F36B21] hover:bg-[#D4591A] text-white text-sm font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-gray-100 dark:bg-[#091526] hover:bg-gray-200 dark:hover:bg-[#0C1D3A] text-gray-700 dark:text-gray-300 text-sm font-semibold rounded-xl transition-all border border-transparent dark:border-blue-900/50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordCell({ password, canView }: { password: string | null; canView: boolean }) {
  const [visible, setVisible] = useState(false);
  if (!canView) return <span className="text-gray-300 dark:text-gray-600 text-xs select-none">••••••••</span>;
  if (!password) return <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-xs text-gray-700 dark:text-gray-300 select-all">
        {visible ? password : '•'.repeat(Math.min(password.length, 10))}
      </span>
      <button
        onClick={() => setVisible(v => !v)}
        className="p-0.5 text-gray-300 hover:text-[#F36B21] transition-colors"
        title={visible ? 'ซ่อนรหัส' : 'แสดงรหัส'}
      >
        {visible ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
    </div>
  );
}

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const callerRole = (currentUser?.role ?? 'viewer') as UserRole;
  const isDeveloper = callerRole === 'developer';

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<AppUser | undefined>(undefined);
  const [showDialog, setShowDialog] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('admin_list_users');
    if (data) setUsers(data as AppUser[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function deleteUser(user: AppUser) {
    if (!confirm(`Delete user "${user.display_name}" (${user.username})?`)) return;
    setDeletingId(user.id);
    await supabase.rpc('admin_delete_user', { p_username: user.username });
    await fetchUsers();
    setDeletingId(null);
  }

  function openAdd() { setEditingUser(undefined); setShowDialog(true); }
  function openEdit(u: AppUser) { setEditingUser(u); setShowDialog(true); }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-[#F36B21]" />
          <span className="font-bold text-gray-800 dark:text-gray-100 text-sm">User Management</span>
          <span className="bg-gray-100 dark:bg-[#0C1830] text-gray-600 dark:text-gray-400 text-xs font-semibold px-2 py-0.5 rounded-full border border-gray-200 dark:border-blue-900/50">{users.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchUsers}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-[#F36B21] border border-gray-200 dark:border-blue-900/50 rounded-xl bg-white dark:bg-[#0C1830] hover:bg-orange-50 dark:hover:bg-[#0C1D3A] transition-all"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-[#F36B21] hover:bg-[#D4591A] text-white text-sm font-bold rounded-xl transition-all active:scale-95"
          >
            <Plus size={14} /> Add User
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-2xl border border-gray-200 dark:border-blue-900/50 shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#0A0B0D] dark:bg-[#070D1A] sticky top-0 z-10">
              {['Display Name', 'Username', 'Password', 'Role', 'Section', 'Created', ''].map(h => (
                <th key={h} className="text-left text-xs font-bold text-gray-400 uppercase tracking-wider px-4 py-3 border-b border-white/10 whitespace-nowrap first:pl-5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12"><div className="w-8 h-8 border-2 border-[#F36B21]/20 border-t-[#F36B21] rounded-full animate-spin mx-auto" /></td></tr>
            ) : users.map((user, idx) => (
              <tr key={user.id} className={`border-b border-gray-100 dark:border-blue-900/30 hover:bg-orange-50/30 dark:hover:bg-blue-900/20 group transition-colors ${idx % 2 === 0 ? 'bg-white dark:bg-[#0C1830]' : 'bg-gray-50/40 dark:bg-[#081323]'}`}>
                <td className="px-4 py-3 pl-5 font-semibold text-gray-800 dark:text-gray-200">{user.display_name}</td>
                <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400 text-xs">{user.username}</td>
                <td className="px-4 py-3">
                  <PasswordCell password={user.password_plain} canView={isDeveloper} />
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${ROLE_BADGE[user.role]}`}>
                    {ROLE_OPTIONS.find(r => r.value === user.role)?.label ?? user.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${SECTION_BADGE[user.section_access ?? 'both']}`}>
                    {SECTION_LABEL[user.section_access ?? 'both']}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">
                  {new Date(user.created_at).toLocaleDateString('en-GB')}
                </td>
                <td className="pr-4 py-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    {(isDeveloper || user.role !== 'developer') && (
                      <button
                        onClick={() => openEdit(user)}
                        className="p-1.5 text-gray-400 hover:text-[#F36B21] hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg transition-all"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {(isDeveloper || (user.role !== 'developer' && callerRole === 'admin')) && (
                      <button
                        onClick={() => deleteUser(user)}
                        disabled={deletingId === user.id}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-30"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showDialog && (
        <UserDialog
          editUser={editingUser}
          callerRole={callerRole}
          onClose={() => setShowDialog(false)}
          onSaved={() => { setShowDialog(false); fetchUsers(); }}
        />
      )}
    </div>
  );
}
