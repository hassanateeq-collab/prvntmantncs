-- Repeat urgent room-assignment pushes until the room boy acknowledges.
--
-- The app rings its in-app bell every few seconds while it is open. When the
-- app is closed the only way to keep alerting the phone is a server-side push,
-- so pg_cron calls /api/push once a minute for every urgent assignment that is
-- still unacknowledged for today (Asia/Karachi). Acknowledging the room stops
-- the ringing automatically because this query no longer selects it.
--
-- `notificationId` is intentionally null: this is a repeat alert for an
-- existing notification, not a new one, so /api/push must not claim/skip it.

create extension if not exists pg_cron;

create or replace function public.repeat_urgent_room_boy_push()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  for r in
    select e.branch_code, e.room_no, e.assigned_to
      from public.room_boy_entries e
     where lower(coalesce(e.assignment_remarks, '')) = 'urgent'
       and e.assignment_acknowledged_at is null
       and e.report_date = (now() at time zone 'Asia/Karachi')::date
       and coalesce(e.assigned_to, '') <> ''
  loop
    perform net.http_post(
      url := 'https://hamsunlog.vercel.app/api/push',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'notificationId', null,
        'roomBoyName', r.assigned_to,
        'branchCode', r.branch_code,
        'roomNumber', r.room_no,
        'notificationType', 'room_assigned',
        'remark', 'Urgent',
        'tag', 'room-assign-' || r.branch_code || '-' || r.room_no,
        'repeat', true
      )
    );
  end loop;
end;
$function$;

-- Every 15 seconds while the app is closed. Falls back to once a minute on
-- pg_cron versions that only accept cron syntax.
do $do$
begin
  perform cron.unschedule('hamsun-urgent-room-push')
   where exists (select 1 from cron.job where jobname = 'hamsun-urgent-room-push');
exception when others then
  null;
end;
$do$;

select cron.schedule(
  'hamsun-urgent-room-push',
  '15 seconds',
  $cron$select public.repeat_urgent_room_boy_push();$cron$
);
