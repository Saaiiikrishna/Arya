'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api } from '@/lib/api';

interface Admin {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  avatarUrl?: string;
}

interface AuthContextType {
  admin: Admin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  admin: null,
  loading: true,
  login: async () => {},
  logout: () => {},
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const token = api.getToken();
      if (!token) {
        setLoading(false);
        return;
      }
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

  const login = async (email: string, password: string) => {
    const data = await api.login(email, password);
    setAdmin(data.admin);
  };

  const logout = () => {
    api.logout();
    setAdmin(null);
  };

  return (
    <AuthContext.Provider
      value={{ admin, loading, login, logout, isAuthenticated: !!admin }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
