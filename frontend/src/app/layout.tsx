import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import GoogleProvider from "@/components/GoogleAuthProvider";
import { SettingsProvider } from "@/lib/settings";
import TrackerInit from "@/components/TrackerInit";

export const metadata: Metadata = {
  title: "Arya — Team Formation Platform",
  description: "Batch-based user onboarding and team formation pipeline",
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

