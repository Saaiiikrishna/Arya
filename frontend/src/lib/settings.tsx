'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

interface SiteSettings {
  logoMode: 'svg' | 'text';
  [key: string]: string;
}

interface SettingsContextType {
  settings: SiteSettings;
  loading: boolean;
  refresh: () => Promise<void>;
}

const defaultSettings: SiteSettings = {
  logoMode: 'text',
};

const SettingsContext = createContext<SettingsContextType>({
  settings: defaultSettings,
  loading: true,
  refresh: async () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  const fetchSettings = async () => {
    try {
      const data = await api.getPublicSettings();
      setSettings({ ...defaultSettings, ...data } as SiteSettings);
    } catch {
      // Use defaults on failure
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, refresh: fetchSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
