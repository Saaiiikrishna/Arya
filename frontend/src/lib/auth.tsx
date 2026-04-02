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
  admin: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  role: string | null; // 'APPLICANT' | 'ADMIN' | 'SUPER_ADMIN' | 'MODERATOR' | null
}

const AuthContext = createContext<AuthContextType>({
  admin: null,
  loading: true,
  login: async () => {},
  logout: () => {},
  isAuthenticated: false,
  role: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const token = api.getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      // Try applicant profile first (most common user type)
      try {
        const applicantData = await api.getMyProfile();
        if (applicantData && applicantData.role === 'APPLICANT') {
          setAdmin(applicantData);
          setLoading(false);
          return;
        }
      } catch {
        // Not an applicant — try admin
      }
      // Fallback to admin endpoint
      const data = await api.getMe();
      setAdmin(data);
    } catch {
      api.logout();
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (admin) {
        localStorage.setItem('arya_profile', JSON.stringify(admin));
      } else {
        localStorage.removeItem('arya_profile');
      }
    }
  }, [admin]);

  const login = async (email: string, password: string) => {
    if (typeof window !== 'undefined') sessionStorage.removeItem('arya_session_id');
    const data = await api.login(email, password);
    setAdmin(data.admin);
  };

  const logout = () => {
    if (typeof window !== 'undefined') sessionStorage.removeItem('arya_session_id');
    api.logout();
    setAdmin(null);
  };

  const role = admin?.role || null;

  return (
    <AuthContext.Provider
      value={{ admin, loading, login, logout, isAuthenticated: !!admin, role }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
