// app/setup/page.tsx
// First-run wizard. Server-gated: once the app is configured this route is
// closed and bounces to the login screen.
import { redirect } from "next/navigation";
import { DB_ENGINES, isConfigured } from "@/lib/app-config";
import SetupForm from "./setup-form";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (isConfigured()) redirect("/login");
  return <SetupForm engines={DB_ENGINES.map((e) => ({ ...e }))} />;
}
