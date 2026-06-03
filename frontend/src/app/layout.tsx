import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import GoogleProvider from "@/components/GoogleAuthProvider";
import { SettingsProvider } from "@/lib/settings";
import TrackerInit from "@/components/TrackerInit";

export const metadata: Metadata = {
  title: "Aryavartham — The Founder's Club",
  description: "Build a Startup in 180 Days. We don't invest in you — we build with you. A co-founder programme for the obsessive, the restless, and the relentlessly curious.",
  icons: { icon: "/logo-short.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
      </head>
      <body>
        <GoogleProvider>
          <AuthProvider>
            <SettingsProvider>
              <TrackerInit />
              {children}
            </SettingsProvider>
          </AuthProvider>
        </GoogleProvider>
      </body>
    </html>
  );
}

