-- 004: the Drafts page has three tabs (To review / Approved / Done), so drafts get two more states.
--   new, pending_gmail, draft_failed -> To review      approved -> Approved      done, sent, skipped -> Done
-- 'sent' and 'skipped' stay allowed for rows written by the earlier version of the dashboard. The app never sends email;
-- 'done' only records that Rohit has finished with the draft.
alter table public.drafts drop constraint if exists drafts_status_check;
alter table public.drafts add constraint drafts_status_check
  check (status in ('new', 'approved', 'done', 'sent', 'skipped', 'pending_gmail', 'draft_failed'));

-- ET's official RSS directory (economictimes.indiatimes.com/rss.cms) lists Tech > Startups at this URL.
-- It is a different feed from "ET Entrepreneur" (small-biz/.../11993034.cms, listed there as Entrepreneurship).
insert into public.feeds (name, url, kind)
values ('ET Startups', 'https://economictimes.indiatimes.com/tech/startups/rssfeeds/78570540.cms', 'rss')
on conflict (url) do nothing;
