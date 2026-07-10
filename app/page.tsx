// app/page.tsx
import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/app-config";

export const dynamic = "force-dynamic";

export default function Home() {
  // On a fresh install the operator lands in the first-run wizard; afterwards
  // the main dashboard is the landing page.
  redirect(isConfigured() ? "/dashboard" : "/setup");
}
