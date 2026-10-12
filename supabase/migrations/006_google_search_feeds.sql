-- 006: funding news found by Google's own search (Google News search results), as extra sources next to the publishers' feeds.
-- The app swaps each Google redirect link for the publisher's real article address before reading it. Idempotent.
insert into public.feeds (name, url, kind) values
  ('Google Search: seed funding India',
   'https://news.google.com/rss/search?q=%28seed+OR+%22pre-seed%22+OR+%22seed+round%22%29+%28raises+OR+raised+OR+secures+OR+bags%29+India+startup+when%3A2d&hl=en-IN&gl=IN&ceid=IN%3Aen', 'rss'),
  ('Google Search: pre-seed India',
   'https://news.google.com/rss/search?q=%22pre-seed%22+funding+India+startup+when%3A2d&hl=en-IN&gl=IN&ceid=IN%3Aen', 'rss'),
  ('Google Search: led by (seed) India',
   'https://news.google.com/rss/search?q=%22seed+round%22+%22led+by%22+Indian+startup+when%3A2d&hl=en-IN&gl=IN&ceid=IN%3Aen', 'rss')
on conflict (url) do nothing;
