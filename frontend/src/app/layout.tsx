import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { StoreAuthProvider } from "@/lib/storeAuth";
import { StoreCartProvider } from "@/lib/storeCart";
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
            {/*
              StoreAuthProvider currently lives at the ROOT so the store customer
              identity is available on every store/article surface without per-route
              wiring. It is independent of the platform AuthProvider (it touches only
              storeApi / arya_store_refresh), so the nesting order is purely so any
              future store code may also read useAuth(). Trade-off: it fires one silent
              customer refresh on cold load even on pure platform pages (/admin/*, /) —
              a no-op when arya_store_refresh is absent. At larger scale this should be
              hoisted into a store-scoped layout (e.g. app/store/layout.tsx,
              app/articles/layout.tsx) so it never hydrates on non-store pages.
            */}
            <StoreAuthProvider>
              {/*
                StoreCartProvider is hoisted to the root so the global navbar
                (Layout.tsx) can render the cart badge + slide-over drawer on
                every public surface without per-route wiring. It is thin and
                hydration-safe: on cold load it fetches the cart ONLY when a guest
                cart token or customer session already exists, so it is a no-op on
                pure platform pages (/admin/*, /). Store pages that wrap their own
                <StoreCartProvider> (e.g. /cart) still work — the nested provider
                simply shadows this root one for its subtree.
              */}
              <StoreCartProvider>
                <SettingsProvider>
                  <TrackerInit />
                  {children}
                </SettingsProvider>
              </StoreCartProvider>
            </StoreAuthProvider>
          </AuthProvider>
        </GoogleProvider>
      </body>
    </html>
  );
}

