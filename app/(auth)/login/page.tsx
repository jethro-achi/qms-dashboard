// app/(auth)/login/page.tsx
// Server gate: an unconfigured install has no users to log in as, so send the
// operator to the first-run wizard instead of showing a dead login form.
import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/app-config";
import { hasLogo, logoVersion } from "@/lib/branding";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (!isConfigured()) redirect("/setup");
  const logoSrc = hasLogo() ? `/api/branding/logo?v=${logoVersion()}` : null;
  // Show the Microsoft SSO button only when Entra ID is configured.
  const ssoEnabled = Boolean(process.env.AUTH_MICROSOFT_ENTRA_ID_ID);
  return <LoginForm logoSrc={logoSrc} ssoEnabled={ssoEnabled} />;
}
