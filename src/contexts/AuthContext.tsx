import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { SectionAccess } from '../types';

export type UserRole = 'developer' | 'admin' | 'machine_planner' | 'planner' | 'viewer';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
  sectionAccess: SectionAccess;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string, remember: boolean) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => ({ success: false }),
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('auth_user');
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch { /* ignore */ }
    }
    setLoading(false);
  }, []);

  async function login(username: string, password: string, remember: boolean): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase.rpc('verify_login', {
      p_username: username,
      p_password: password,
    });
    if (error || !data || data.length === 0) {
      return { success: false, error: 'Invalid username or password' };
    }
    const row = data[0];
    const authUser: AuthUser = {
      id: row.id,
      username: row.username,
      role: row.role as UserRole,
      displayName: row.display_name,
      sectionAccess: (row.section_access as SectionAccess) ?? 'both',
    };
    setUser(authUser);
    if (remember) {
      localStorage.setItem('auth_user', JSON.stringify(authUser));
    } else {
      localStorage.removeItem('auth_user');
    }
    return { success: true };
  }

  function logout() {
    setUser(null);
    localStorage.removeItem('auth_user');
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Permission helpers
export const canCreate  = (r: UserRole) => r !== 'viewer';
export const canMove    = (r: UserRole) => r === 'developer' || r === 'machine_planner';
export const canEdit    = (r: UserRole) => r !== 'viewer' && r !== 'admin';
export const canConfirm = (r: UserRole) => r === 'developer' || r === 'admin' || r === 'machine_planner';
export const canDelete  = (r: UserRole) => r === 'developer' || r === 'admin';
