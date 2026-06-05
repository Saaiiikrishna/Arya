'use client';

/**
 * Admin → Communications.
 *
 * One section that merges the three previously-separate but same-category
 * surfaces — Announcements (global broadcasts), WhatsApp (template console +
 * direct sends), and the Notification delivery log — into a single tabbed hub.
 * Each tab renders the existing page component unchanged, so all behaviour and
 * data fetching is preserved; this only unifies the entry point.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Megaphone, MessageCircle, Bell, type LucideIcon } from 'lucide-react';
import AnnouncementsPage from '../announcements/page';
import AdminWhatsappPage from '../whatsapp/page';
import AdminNotificationsPage from '../notifications/page';

type Tab = 'announcements' | 'whatsapp' | 'notifications';

const TABS: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: 'announcements', label: 'Announcements', Icon: Megaphone },
  { id: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
  { id: 'notifications', label: 'Notification Log', Icon: Bell },
];

export default function CommunicationsPage() {
  const [tab, setTab] = useState<Tab>('announcements');

  return (
    <div className="text-ink animate-fade-in min-h-screen">
      <div className="px-4 sm:px-6 lg:px-8 pt-8 sm:pt-12 max-w-[1200px] 3xl:max-w-[1600px] mx-auto">
        <header className="mb-6">
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-2 inline-block hover:text-saffron-deep transition-colors">
            ← Command Center
          </Link>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold leading-none">Communications</h1>
        </header>

        <div className="flex items-center gap-2 border-b border-hairline">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 font-sans text-[11px] font-bold uppercase tracking-widest transition-colors -mb-px border-b-2 cursor-pointer ${
                tab === id ? 'border-forest text-forest' : 'border-transparent text-ink/45 hover:text-forest'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Each tab renders its page component in EMBEDDED mode so the hub owns the
          single header (the pages suppress their own title when embedded). */}
      <div>
        {tab === 'announcements' && <AnnouncementsPage embedded />}
        {tab === 'whatsapp' && <AdminWhatsappPage embedded />}
        {tab === 'notifications' && <AdminNotificationsPage embedded />}
      </div>
    </div>
  );
}
