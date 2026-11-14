-- Track push endpoints the push service rejected (410 Gone / 404) so the phone
-- can rotate to a fresh subscription on its next open instead of silently
-- missing every alert.
alter table if exists public.push_subscriptions
  add column if not exists failed_at timestamptz;

create index if not exists push_subscriptions_user_email_idx
  on public.push_subscriptions (user_email);
