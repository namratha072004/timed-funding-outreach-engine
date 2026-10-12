import Link from "next/link";
import NotificationsPanel from "@/components/NotificationsPanel";
import RubricForm, { type Criterion } from "@/components/RubricForm";
import { PageHeader } from "@/components/ui";
import { loadRubric } from "@/lib/config";
import { rubricScores } from "@/lib/queries";
import { REJECT_ON_NO_KEYS } from "@/lib/settings";
import { serverDb } from "@/lib/supabase";
import { botInfoCached, telegramState, telegramToken } from "@/lib/telegram";

// Plain-English help for the five checks; the names come from the database.
const HELP: Record<string, string> = {
  sector_fit: "Does the startup work in one of your sectors?",
  geography_fit: "Is it based in one of your countries?",
  product_traction: "Customers, revenue or pilots mentioned in the article.",
  team_signal: "Founder background. Partial credit is allowed here.",
  idea_clarity: "How clear and distinct the idea is.",
};

export default async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "notifications" ? "notifications" : "rubric";
  return (
    <>
      <PageHeader title="Settings" sub="How startups are scored, and how you hear about new drafts." />
      <div className="tabs" role="tablist">
        <Link href="/settings" className={tab === "rubric" ? "on" : ""} role="tab" aria-selected={tab === "rubric"}>Rubric</Link>
        <Link href="/settings?tab=notifications" className={tab === "notifications" ? "on" : ""} role="tab" aria-selected={tab === "notifications"}>Notifications</Link>
      </div>
      {tab === "rubric" ? <RubricTab /> : <NotificationsTab />}
    </>
  );
}

async function RubricTab() {
  const [r, s] = await Promise.all([loadRubric(serverDb()), rubricScores()]);
  const criteria: Criterion[] = r.criteria.map((c) => ({ key: c.key, name: c.name, help: HELP[c.key] ?? c.question }));
  return (
    <>
      <div className="note">Rubric version {r.version} is active. Changes apply from the next run. Startups rejected earlier may be re-checked once, because the scoring changed. Changing only the look-back window or the run limits does not trigger that.</div>
      <RubricForm
        initial={{
          passMark: r.passMark,
          weights: Object.fromEntries(r.criteria.map((c) => [c.key, c.weight])),
          rejectOnNo: Object.fromEntries(r.criteria.filter((c) => (REJECT_ON_NO_KEYS as readonly string[]).includes(c.key)).map((c) => [c.key, c.rejectOnNo])),
          sectors: r.thesisSectors,
          geographies: r.thesisGeographies,
          stages: r.allowedStages,
          lookbackHours: r.lookbackHours ?? 24,
        }}
        criteria={criteria}
        scores={s.scores}
        scoresLabel={s.label}
      />
    </>
  );
}

async function NotificationsTab() {
  const [state, bot] = await Promise.all([telegramState(serverDb()), botInfoCached()]);
  return <NotificationsPanel tokenSet={!!telegramToken()} bot={bot} connected={!!state.chat} enabled={state.enabled} />;
}
