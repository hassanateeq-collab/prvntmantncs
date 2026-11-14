import { setVapidDetails, sendNotification } from "web-push";
import { createClient } from "@supabase/supabase-js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:altamash@hamsun.com";

const SUPABASE_URL =
  process.env.VITE_APP_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = parseBody(req.body);

    // Support Supabase webhook format (body.record contains the new row)
    const record = body.record || body;
    const roomBoyName = body.roomBoyName || record.room_boy_name;
    const branchCode = body.branchCode || record.branch_code;
    const roomNumber = body.roomNumber || record.room_number;
    const remark = body.remark !== undefined ? body.remark : record.remark;
    const notificationType =
      body.notificationType || record.notification_type || "room_assigned";
    const notificationId = body.notificationId || record.notification_id || null;

    const admin = getAdminClient();

    // Exactly-once delivery: both the database trigger and the supervisor's app
    // call this endpoint for the same notification. Whoever gets here first
    // claims it; the other call sees the claim and skips, so the phone never
    // rings twice for one assignment.
    if (notificationId && admin) {
      const { data: claim, error: claimError } = await admin
        .from("room_boy_notifications")
        .update({ push_sent_at: new Date().toISOString() })
        .eq("id", notificationId)
        .is("push_sent_at", null)
        .select("id");

      if (!claimError && Array.isArray(claim) && claim.length === 0) {
        return res.status(200).json({ skipped: true, reason: "already sent" });
      }
    }

    // Mode 1: Direct subscriptions provided
    let subscriptions = Array.isArray(body.subscriptions)
      ? body.subscriptions
      : null;

    // Mode 2: Room boy name provided — look up subscriptions from Supabase
    if ((!subscriptions || subscriptions.length === 0) && roomBoyName && admin) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("email")
        .eq("full_name", roomBoyName)
        .eq("role", "room_boy")
        .limit(1);

      const email = profiles?.[0]?.email;
      if (email) {
        const { data: subs } = await admin
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .eq("user_email", email);
        subscriptions = (subs || []).map((s) => ({
          id: s.id,
          endpoint: s.endpoint,
          p256dh: s.p256dh,
          auth: s.auth,
        }));
      }
    }

    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({ sent: 0, failed: 0, message: "No subscriptions" });
    }

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(500).json({ error: "VAPID keys not configured" });
    }

    const isUrgent = String(remark ?? "").trim().toLowerCase() === "urgent";

    let title;
    let notificationBody;

    if (body.title) {
      title = body.title;
    } else if (notificationType === "rating_received") {
      title = roomNumber ? `⭐ Inspection result — Room ${roomNumber}` : "⭐ Inspection result";
    } else if (notificationType === "test_notification") {
      title = "🔔 Hamsun Log Book test";
    } else if (isUrgent) {
      title = roomNumber ? `🚨 URGENT — Room ${roomNumber}` : "🚨 URGENT assignment";
    } else {
      title = "🏨 Room Assigned";
    }

    if (body.body) {
      notificationBody = body.body;
    } else if (notificationType === "rating_received") {
      notificationBody = roomNumber
        ? `Your cleaning of room ${roomNumber} has been inspected. Open the app to see the result.`
        : "Your cleaning has been inspected. Open the app to see the result.";
    } else if (notificationType === "test_notification") {
      notificationBody = "This is a test notification from Hamsun Log Book.";
    } else {
      notificationBody = roomNumber
        ? `Room ${roomNumber} assigned to you${remark ? ` — ${remark}` : ""}${branchCode ? ` (${branchCode})` : ""}. Open the app and acknowledge.`
        : "You have a new assignment";
    }
    const url =
      body.url ||
      (branchCode
        ? `/#/branch/${branchCode}/room-boy/${new Date().toISOString().slice(0, 10)}`
        : "/");
    const tag =
      body.tag ||
      (roomNumber
        ? `${notificationType === "rating_received" ? "room-inspect" : "room-assign"}-${branchCode}-${roomNumber}`
        : "hamsun-push");

    const payload = JSON.stringify({
      title,
      body: notificationBody,
      url,
      tag,
      urgent: isUrgent,
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
          // Urgent assignments must stay on screen until the room boy acts.
          isUrgent ? { TTL: 60 * 60, urgency: "high" } : { TTL: 60 * 60 * 6 },
        ),
      ),
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    // Flag endpoints the push service says are gone (410/404) so the phone can
    // rotate to a fresh subscription the next time it opens. Keeping the row
    // lets the app recognise its own dead endpoint instead of guessing.
    if (admin) {
      const deadIds = [];
      results.forEach((result, index) => {
        if (result.status !== "rejected") return;
        const statusCode = result.reason?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          const id = subscriptions[index]?.id;
          if (id) deadIds.push(id);
        }
      });
      if (deadIds.length > 0) {
        await admin
          .from("push_subscriptions")
          .update({ failed_at: new Date().toISOString() })
          .in("id", deadIds);
      }
    }

    const failures = results
      .map((r, index) =>
        r.status === "rejected"
          ? {
              endpoint: String(subscriptions[index]?.endpoint || "").slice(0, 60),
              statusCode: r.reason?.statusCode ?? null,
              message: r.reason?.message ?? String(r.reason),
            }
          : null,
      )
      .filter(Boolean);

    return res.status(200).json({ sent, failed, failures });
  } catch (error) {
    console.error("Push handler error:", error);
    // Never let the function crash: the database trigger relies on a response.
    return res
      .status(200)
      .json({ sent: 0, failed: 0, error: error?.message || String(error) });
  }
}
