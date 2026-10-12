import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { COOKIE, cookieOk } from "@/lib/auth";
import { runBanner, sidebarCounts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await cookieOk((await cookies()).get(COOKIE)?.value))) redirect("/unlock");
  const [counts, banner] = await Promise.all([sidebarCounts(), runBanner()]);
  return (
    <div className="shell">
      <Sidebar counts={counts} />
      <main className="main">
        {banner.running && <div className="banner run" role="status">A run is in progress. Numbers below update when it finishes.</div>}
        {banner.failed && <div className="banner error" role="alert">The last run started at its scheduled time but never finished (the function was cut off). Check Runs &amp; health.</div>}
        {children}
      </main>
    </div>
  );
}
