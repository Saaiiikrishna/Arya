'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api } from '@/lib/api';

interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  avatarUrl?: string;
  phone?: string;
  status?: string;
  teamId?: string;
  batchId?: string;
  hasPaid?: boolean;
}

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  role: string | null; // 'APPLICANT' | 'ADMIN' | 'SUPER_ADMIN' | 'MODERATOR' | null
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
  isAuthenticated: false,
  role: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      // Access token lives in memory only; attempt silent refresh if absent
      if (!api.getToken()) {
        const refreshed = await api.refreshAccessToken();
        if (!refreshed) {
          setLoading(false);
          return;
        }
      }
      // Try applicant profile first (most common user type)
      try {
        const applicantData = await api.getMyProfile();
        if (applicantData && applicantData.role === 'APPLICANT') {
          setUser(applicantData);
          setLoading(false);
          return;
        }
      } catch {
        // Not an applicant — try admin
      }
      // Fallback to admin endpoint
      const data = await api.getMe();
      setUser(data);
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 401 || status === 403) {
        api.logout();
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (user) {
        sessionStorage.setItem('arya_profile', JSON.stringify(user));
      } else {
        sessionStorage.removeItem('arya_profile');
      }
    }
  }, [user]);

  const login = async (email: string, password: string) => {
    if (typeof window !== 'undefined') sessionStorage.removeItem('arya_session_id');
    const data = await api.login(email, password);
    setUser(data.admin);
  };

  const logout = () => {
    if (typeof window !== 'undefined') sessionStorage.removeItem('arya_session_id');
    api.logout();
    setUser(null);
  };

  const role = user?.role || null;

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, isAuthenticated: !!user, role }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
