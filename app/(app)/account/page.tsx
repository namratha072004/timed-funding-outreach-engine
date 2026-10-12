import Link from "next/link";
import { cookies } from "next/headers";
import AccountActions from "@/components/AccountActions";
import { Card, PageHeader, StatusPill } from "@/components/ui";
import { anyCodeAccepted, COOKIE, cookieOk } from "@/lib/auth";
import { serverDb } from "@/lib/supabase";
import { telegramState } from "@/lib/telegram";

export default async function Account() {
  const [signedIn, tg] = await Promise.all([cookies().then((j) => cookieOk(j.get(COOKIE)?.value)), telegramState(serverDb())]);
  return (
    <>
      <PageHeader title="Account" sub="Who is using the dashboard, and what they can do." />
      <Card>
        <div className="fld">
          <div className="l"><div className="who" style={{ display: "flex", alignItems: "center", gap: 16 }}><i className="avatar" aria-hidden="true" style={{ width: 48, height: 48 }}>R</i><div><b>Rohit</b><p>Reviews the drafts. Sends nothing without a human decision.</p></div></div></div>
          <StatusPill tone={signedIn ? "ok" : "neutral"}>{signedIn ? "Signed in" : "Viewing only"}</StatusPill>
        </div>
        <div className="fld">
          <div className="l">
            <b>Access</b>
            <p>{signedIn ? "You can run scans, overrule rejects, move drafts and save settings. You are asked for the code again after 12 hours." : "Everyone can view the dashboard. Entering the access code lets you run scans, overrule rejects, move drafts and save settings."}{anyCodeAccepted() && <> <b>(testing mode: any access code is accepted)</b></>}</p>
          </div>
          <AccountActions signedIn={signedIn} />
        </div>
        <div className="fld">
          <div className="l"><b>Telegram reminders</b><p>{tg.chat ? (tg.enabled ? "On. You get a message when new drafts are ready." : "Connected, but paused.") : "Not connected."}</p></div>
          <Link className="btn" href="/settings?tab=notifications">Open notification settings</Link>
        </div>
      </Card>
    </>
  );
}
