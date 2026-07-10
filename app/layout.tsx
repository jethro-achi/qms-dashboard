// app/layout.tsx
import type { Metadata } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Sans, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { getAppTheme } from "@/lib/settings";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "QMS Analytics",
  description: "Queue Management System analytics dashboard",
};

// Every response carries a per-request CSP nonce (see middleware.ts), which is
// incompatible with static prerendering — a build-time page can't embed a
// runtime nonce. This app is entirely auth-gated and reads app-wide settings
// per request anyway, so force dynamic rendering everywhere.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // App-wide appearance chosen by the super admin. Colors are applied as inline
  // CSS variables that override the defaults from globals.css.
  const theme = await getAppTheme();
  // The per-request CSP nonce (set on the request headers by middleware.ts) so
  // next-themes' anti-flash script is allowed under the strict script policy.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // NOTE: deliberately do NOT override --accent. In shadcn, --accent is the
  // subtle hover/highlight background (used by selects, dropdowns, sidebar
  // hover). Driving it from a brand colour makes every hover that colour. So
  // the configured colours map to brand roles instead, and hovers stay neutral.
  const style: React.CSSProperties = {};
  const set = (k: string, v: string) => ((style as Record<string, string>)[k] = v);
  if (theme.primary) {
    set("--primary", theme.primary);
    set("--sidebar-primary", theme.primary);
    set("--chart-1", theme.primary);
  }
  if (theme.secondary) {
    set("--secondary", theme.secondary);
    set("--chart-4", theme.secondary);
  }
  if (theme.accent) {
    set("--ring", theme.accent); // focus outline
    set("--chart-2", theme.accent); // secondary chart series
  }

  return (
    <html
      lang="en"
      // Browser extensions (password managers, focus-visible polyfills, etc.)
      // mutate <html> attributes before React hydrates. suppressHydrationWarning
      // silences the resulting attribute-mismatch warning for THIS element only;
      // it does not affect children.
      suppressHydrationWarning
      className={cn(mono.variable, "font-sans", inter.variable)}
      style={style}
    >
      <body>
        <ThemeProvider defaultTheme={theme.mode} nonce={nonce}>
          {children}
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
