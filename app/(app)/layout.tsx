import { cookies } from "next/headers";
import AccessGate from "@/components/AccessGate";
import AppShell from "@/components/AppShell";
import TopBar from "@/components/TopBar";
import { anyCodeAccepted } from "@/lib/auth";
import { paletteFrom } from "@/lib/theme";
import { tabCountsForNav, topStatus } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Every page is public and read-only. Anything that changes data asks for the access code (components/AccessGate).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [status, drafts, jar] = await Promise.all([topStatus(), tabCountsForNav(), cookies()]);
  return (
    <AccessGate testing={anyCodeAccepted()}>
      <TopBar status={status} palette={paletteFrom(jar.get("palette")?.value)} />
      <AppShell drafts={drafts}>{children}</AppShell>
    </AccessGate>
  );
}
