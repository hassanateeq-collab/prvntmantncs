-- Push delivery: exactly-once per notification.
--
-- Two independent paths can send the device push for a notification:
--   1. the database trigger below (works even if the browser closes early)
--   2. the supervisor's app right after it inserts the notification row
--
-- `push_sent_at` lets /api/push claim a notification atomically, so whichever
-- path arrives first sends it and the other one skips. That keeps alerts
-- reliable (a pg_net network hiccup no longer loses the alert) without ever
-- ringing the room boy's phone twice for one assignment.

alter table if exists public.room_boy_notifications
  add column if not exists push_sent_at timestamptz;

create or replace function public.notify_room_boy_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform net.http_post(
    url := 'https://hamsunlog.vercel.app/api/push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'notificationId', NEW.id,
      'roomBoyName', NEW.room_boy_name,
      'branchCode', NEW.branch_code,
      'roomNumber', NEW.room_number,
      'notificationType', NEW.notification_type,
      'remark', NEW.remark
    )
  );
  return NEW;
end;
$function$;
