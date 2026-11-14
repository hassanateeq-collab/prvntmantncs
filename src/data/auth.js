import { createClient } from "@supabase/supabase-js";

// Portal logins and access control live in the Hamsun portal Supabase project.
// The live PMS data is read from a separate project (see src/data/pms.js).
const APP_SUPABASE_URL = (import.meta.env.VITE_APP_SUPABASE_URL ?? "").replace(
  /\/+$/,
  "",
);
const APP_SUPABASE_ANON_KEY =
  import.meta.env.VITE_APP_SUPABASE_ANON_KEY ?? "";

export const hasAuthConfig = Boolean(
  APP_SUPABASE_URL && APP_SUPABASE_ANON_KEY,
);

export const BRANCH_CODES = ["FSL", "CLF", "EXT", "DHA", "NST"];

const PROFILE_COLUMNS =
  "id,email,full_name,role,branch_code,department,is_active,created_at,updated_at";

export const VAPID_PUBLIC_KEY = "BLO0Gm-Tyxn5kTb5ZVciqzE9PigyXoZQcmFE179yg0J5E8WlG5eNxTuzefvAd-nTc0FgAYv1hjXymS___UN1qj0";

const authClient = hasAuthConfig
  ? createClient(APP_SUPABASE_URL, APP_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireClient() {
  if (!authClient) {
    throw new Error(
      "Login is not configured. Add VITE_APP_SUPABASE_URL and VITE_APP_SUPABASE_ANON_KEY to .env.",
    );
  }
  return authClient;
}

function readableError(error, fallback) {
  const message = error?.message ?? "";
  if (/invalid login credentials/i.test(message)) {
    return "Incorrect email or password.";
  }
  if (/email not confirmed/i.test(message)) {
    return "This login is not confirmed yet. Contact the administrator.";
  }
  return message || fallback;
}

async function fetchProfile(userId) {
  const client = requireClient();
  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(readableError(error, "Could not load your access profile."));
  }
  if (!data) {
    await client.auth.signOut();
    throw new Error(
      "No portal access is linked to this login. Contact the administrator.",
    );
  }
  if (!data.is_active) {
    await client.auth.signOut();
    throw new Error(
      "This login has been disabled by the administrator.",
    );
  }

  return data;
}

/** Restore an existing session on page load. Returns the profile or null. */
export async function loadSessionProfile() {
  const client = requireClient();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw new Error(readableError(error, "Could not restore your session."));
  }
  if (!data.session) return null;

  return fetchProfile(data.session.user.id);
}

/** Sign in with email and password, then load the portal profile. */
export async function signInWithPassword(email, password) {
  const client = requireClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    throw new Error(readableError(error, "Sign in failed."));
  }

  return fetchProfile(data.user.id);
}

export async function signOut() {
  if (!authClient) return;
  await authClient.auth.signOut();
}

/** Subscribe to Supabase auth state changes (login, logout, token refresh).
 *  Returns an unsubscribe function. */
/** Subscribe to push notifications and store the subscription in Supabase. */
export async function subscribeToPush(profile) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  if (!profile) return null;

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = subscription.toJSON();
    const client = requireClient();

    // If the push service previously rejected this endpoint (410 Gone), the
    // phone must rotate to a brand new subscription or alerts stay silent.
    try {
      const { data: existing, error: existingError } = await client
        .from("push_subscriptions")
        .select("endpoint, failed_at")
        .eq("user_email", profile.email);

      if (!existingError) {
        const mine = (existing ?? []).find(
          (row) => row.endpoint === json.endpoint,
        );
        const nothingRegistered = (existing ?? []).length === 0;

        if (mine?.failed_at || nothingRegistered) {
          try {
            await subscription.unsubscribe();
          } catch {
            // Ignore: we re-subscribe below either way.
          }
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        }
      }
    } catch {
      // Health check is best-effort; fall back to the current subscription.
    }

    const finalJson = subscription.toJSON();

    // Upsert the subscription
    await client.from("push_subscriptions").upsert(
      {
        user_email: profile.email,
        user_role: profile.role,
        branch_code: profile.branch_code || null,
        endpoint: finalJson.endpoint,
        p256dh: finalJson.keys.p256dh,
        auth: finalJson.keys.auth,
        failed_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );

    return subscription;
  } catch (err) {
    console.warn("Push subscription failed:", err);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Get push subscriptions for a user email. */
export async function getPushSubscriptions(userEmail) {
  const client = requireClient();
  const { data, error } = await client
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_email", userEmail);
  if (error) return [];
  return (data || []).map((row) => ({
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
  }));
}

/** Update the current user's own display name (for signatures). */
export async function updateOwnName(fullName) {
  const client = requireClient();
  const { data, error } = await client.rpc("update_own_name", {
    p_full_name: fullName,
  });
  if (error) {
    throw new Error(readableError(error, "Could not update your name."));
  }
  return data;
}

export function onAuthStateChange(callback) {
  if (!authClient) return () => {};
  const { data } = authClient.auth.onAuthStateChange((event, session) => {
    try {
      callback(event, session);
    } catch {
      // Best-effort; never throw out of the auth listener.
    }
  });
  return () => {
    try {
      data?.subscription?.unsubscribe?.();
    } catch {
      // ignore
    }
  };
}

/** Admin only: every portal login. RLS returns only the caller otherwise. */
export async function listStaff() {
  const client = requireClient();
  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .order("role", { ascending: true })
    .order("email", { ascending: true });

  if (error) {
    throw new Error(readableError(error, "Could not load portal logins."));
  }
  return data ?? [];
}

/** Admin only: create a new email/password login with a role and branch. */
export async function createStaff({
  email,
  password,
  fullName,
  role,
  branchCode,
  department,
}) {
  const client = requireClient();
  const { data, error } = await client.rpc("admin_create_staff", {
    p_email: email,
    p_password: password,
    p_full_name: fullName,
    p_role: role,
    p_branch_code: branchCode,
    p_department: department,
  });

  if (error) {
    throw new Error(readableError(error, "Could not create the login."));
  }
  return data;
}

/** Admin only: change a login's details, branch, status or password. */
export async function updateStaff({
  id,
  email,
  fullName,
  role,
  branchCode,
  department,
  isActive,
  password,
}) {
  const client = requireClient();
  const { data, error } = await client.rpc("admin_update_staff", {
    p_id: id,
    p_email: email,
    p_full_name: fullName,
    p_role: role,
    p_branch_code: branchCode,
    p_department: department,
    p_is_active: isActive,
    p_password: password || null,
  });

  if (error) {
    throw new Error(readableError(error, "Could not update the login."));
  }
  return data;
}

/** Record a PMS status event (check-in, check-out, pending, upcoming, vacant). */
export async function recordPmsStatusEvent({
  branchCode,
  roomNumber,
  bookingId,
  checkIn,
  checkOut,
  status,
  checkinStatus,
  guestName,
  eventType,
}) {
  const client = requireClient();
  const { data, error } = await client.from("pms_status_events").insert([
    {
      branch_code: branchCode,
      room_number: roomNumber,
      booking_id: bookingId || null,
      check_in: checkIn || null,
      check_out: checkOut || null,
      status,
      checkin_status: checkinStatus || null,
      guest_name: guestName || null,
      event_type: eventType,
      recorded_by: client.auth.getUser()?.id ?? null,
    },
  ]);

  if (error) {
    throw new Error(readableError(error, "Could not record PMS status event."));
  }
  return data;
}

/** Fetch PMS status events for a branch and room. */
export async function listPmsStatusEvents(branchCode, roomNumber) {
  const client = requireClient();
  const { data, error } = await client
    .from("pms_status_events")
    .select("*")
    .eq("branch_code", branchCode)
    .eq("room_number", roomNumber)
    .order("event_date", { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(readableError(error, "Could not load PMS status events."));
  }
  return data ?? [];
}

/** List active public areas for a branch (admin + staff can read). */
export async function listPublicAreas(branchCode) {
  const client = requireClient();
  const { data, error } = await client
    .from("public_areas")
    .select("*")
    .eq("branch_code", branchCode)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(readableError(error, "Could not load public areas."));
  }
  return data ?? [];
}

/**
 * Rewrite sort_order for a branch as 1..N so changing or deleting an area can
 * never leave duplicate or missing sequence numbers.
 */
export async function normalizePublicAreas(branchCode) {
  const client = requireClient();
  const { data, error } = await client
    .from("public_areas")
    .select("id,sort_order,updated_at")
    .eq("branch_code", branchCode)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: true });

  if (error) {
    throw new Error(readableError(error, "Could not renumber public areas."));
  }

  const rows = data ?? [];
  for (let index = 0; index < rows.length; index += 1) {
    const nextOrder = index + 1;
    if (rows[index].sort_order === nextOrder) continue;
    const { error: updateError } = await client
      .from("public_areas")
      .update({ sort_order: nextOrder })
      .eq("id", rows[index].id);
    if (updateError) {
      throw new Error(
        readableError(updateError, "Could not renumber public areas."),
      );
    }
  }
  return rows.length;
}

/** Admin only: create a new public area for a branch. */
export async function createPublicArea({
  branchCode,
  name,
  sortOrder,
}) {
  const client = requireClient();

  // A blank or zero sort order means "add to the end".
  let nextOrder = Number(sortOrder) || 0;
  if (nextOrder <= 0) {
    const { data: existing } = await client
      .from("public_areas")
      .select("sort_order")
      .eq("branch_code", branchCode)
      .eq("is_active", true)
      .order("sort_order", { ascending: false })
      .limit(1);
    nextOrder = (existing?.[0]?.sort_order ?? 0) + 1;
  }

  const { data, error } = await client.from("public_areas").insert([
    {
      branch_code: branchCode,
      name,
      sort_order: nextOrder,
      is_active: true,
    },
  ]);

  if (error) {
    throw new Error(readableError(error, "Could not create public area."));
  }
  await normalizePublicAreas(branchCode);
  return data;
}

/** Admin only: update a public area. */
export async function updatePublicArea({
  id,
  name,
  sortOrder,
  isActive,
}) {
  const client = requireClient();
  const { data, error } = await client
    .from("public_areas")
    .update({
      name,
      sort_order: sortOrder,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(readableError(error, "Could not update public area."));
  }
  if (data?.branch_code) {
    await normalizePublicAreas(data.branch_code);
  }
  return data;
}

/** Admin only: permanently delete a public area and renumber the rest. */
export async function deletePublicArea(id, branchCode) {
  const client = requireClient();
  const { error } = await client
    .from("public_areas")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(readableError(error, "Could not delete public area."));
  }
  if (branchCode) {
    await normalizePublicAreas(branchCode);
  }
}

/** List active assignment remark options (Urgent, Guest waiting, ...). */
export async function listRoomRemarkOptions() {
  const client = requireClient();
  const { data, error } = await client
    .from("room_remark_options")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(readableError(error, "Could not load remark options."));
  }
  return data ?? [];
}

/** Admin only: add a new assignment remark option. */
export async function createRoomRemarkOption(label) {
  const client = requireClient();
  const clean = String(label ?? "").trim();
  if (!clean) throw new Error("Enter a remark option.");

  const { data: existing } = await client
    .from("room_remark_options")
    .select("sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1;
  const { error } = await client
    .from("room_remark_options")
    .insert([{ label: clean, sort_order: nextOrder, is_active: true }]);

  if (error) {
    throw new Error(readableError(error, "Could not add the remark option."));
  }
}

/** Admin only: remove an assignment remark option. */
export async function deleteRoomRemarkOption(id) {
  const client = requireClient();
  const { error } = await client
    .from("room_remark_options")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(readableError(error, "Could not remove the remark option."));
  }
}

/** List public area inspection records for a branch and date. */
export async function listPublicInspectionRecords(branchCode, date) {
  const client = requireClient();
  const { data, error } = await client
    .from("public_inspection_records")
    .select("*")
    .eq("branch_code", branchCode)
    .eq("inspection_date", date)
    .order("area_id", { ascending: true });

  if (error) {
    throw new Error(readableError(error, "Could not load public area inspections."));
  }
  return data ?? [];
}

/**
 * Upsert a public inspection record (create or update).
 * Only the fields that are passed are written, so a sweeper updating the staff
 * check never overwrites the supervisor's check (and vice versa).
 */
export async function upsertPublicInspectionRecord({
  branchCode,
  date,
  areaId,
  shiftKey,
  staffChecked,
  supervisorChecked,
  supervisorName,
  managerChecked,
  managerName,
}) {
  const client = requireClient();
  const payload = {
    branch_code: branchCode,
    inspection_date: date,
    area_id: areaId,
    shift_key: shiftKey,
    updated_at: new Date().toISOString(),
  };
  if (staffChecked !== undefined) payload.staff_checked = staffChecked;
  if (supervisorChecked !== undefined) {
    payload.supervisor_checked = supervisorChecked;
    payload.supervisor_name = supervisorChecked ? supervisorName ?? null : null;
  }
  if (managerChecked !== undefined) {
    payload.manager_checked = managerChecked;
    payload.manager_name = managerChecked ? managerName ?? null : null;
  }

  const { data, error } = await client
    .from("public_inspection_records")
    .upsert(payload, {
      onConflict: "branch_code,inspection_date,area_id,shift_key",
    });

  if (error) {
    throw new Error(readableError(error, "Could not save inspection record."));
  }
  return data;
}

/** Subscribe to real-time public inspection record changes for a branch. */
export function subscribeToPublicInspectionRecords(branchCode, date, onChange) {
  const client = requireClient();
  const channel = client
    .channel(`public_inspection_${branchCode}_${date}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "public_inspection_records",
        filter: `branch_code=eq.${branchCode}`,
      },
      (payload) => {
        if (payload?.new?.inspection_date === date || payload?.old?.inspection_date === date) {
          onChange(payload);
        }
      },
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}

/** Load the shared header for a public area sheet (shift, names, remarks). */
export async function getPublicAreaSheet(branchCode, date) {
  const client = requireClient();
  const { data, error } = await client
    .from("public_area_sheets")
    .select("*")
    .eq("branch_code", branchCode)
    .eq("sheet_date", date)
    .maybeSingle();

  if (error) {
    throw new Error(readableError(error, "Could not load the cleaning sheet."));
  }
  return data;
}

/** Upsert the shared header for a public area sheet. */
export async function savePublicAreaSheet(branchCode, date, fields) {
  const client = requireClient();
  const payload = {
    branch_code: branchCode,
    sheet_date: date,
    updated_at: new Date().toISOString(),
  };
  Object.entries(fields ?? {}).forEach(([key, value]) => {
    if (value !== undefined) payload[key] = value;
  });

  const { data, error } = await client
    .from("public_area_sheets")
    .upsert(payload, { onConflict: "branch_code,sheet_date" });

  if (error) {
    throw new Error(readableError(error, "Could not save the cleaning sheet."));
  }
  return data;
}

/** Subscribe to real-time public area sheet header changes. */
export function subscribeToPublicAreaSheets(branchCode, date, onChange) {
  const client = requireClient();
  const channel = client
    .channel(`public_area_sheet_${branchCode}_${date}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "public_area_sheets",
        filter: `branch_code=eq.${branchCode}`,
      },
      (payload) => {
        if (payload?.new?.sheet_date === date || payload?.old?.sheet_date === date) {
          onChange(payload);
        }
      },
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}

/** Load the Room Boy Daily Report (header + rows) for a branch and date. */
export async function listRoomBoyReport(branchCode, date) {
  const client = requireClient();
  const [sheetResult, entriesResult] = await Promise.all([
    client
      .from("room_boy_sheets")
      .select("*")
      .eq("branch_code", branchCode)
      .eq("report_date", date)
      .maybeSingle(),
    client
      .from("room_boy_entries")
      .select("*")
      .eq("branch_code", branchCode)
      .eq("report_date", date)
      .order("room_no", { ascending: true }),
  ]);

  if (sheetResult.error) {
    throw new Error(
      readableError(sheetResult.error, "Could not load the room boy report."),
    );
  }
  if (entriesResult.error) {
    throw new Error(
      readableError(entriesResult.error, "Could not load the room boy report."),
    );
  }

  return {
    sheet: sheetResult.data ?? null,
    entries: entriesResult.data ?? [],
  };
}

/** List linen washing entries for a branch/date. */
/** List linen items for a branch. */
export async function listLinenItems(branchCode) {
  const client = requireClient();
  const { data, error } = await client
    .from("linen_items")
    .select("*")
    .eq("branch_code", branchCode)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(readableError(error, "Could not load linen items."));
  return data ?? [];
}

/** Add a linen item. */
export async function addLinenItem(branchCode, name) {
  const client = requireClient();
  const { data, error } = await client
    .from("linen_items")
    .insert({ branch_code: branchCode, name, sort_order: 999 })
    .select()
    .single();
  if (error) throw new Error(readableError(error, "Could not add linen item."));
  return data;
}

/** Rename a linen item. */
export async function renameLinenItem(id, name) {
  const client = requireClient();
  const { error } = await client.from("linen_items").update({ name }).eq("id", id);
  if (error) throw new Error(readableError(error, "Could not rename linen item."));
}

/** Delete (deactivate) a linen item. */
export async function deleteLinenItem(id) {
  const client = requireClient();
  const { error } = await client.from("linen_items").update({ is_active: false }).eq("id", id);
  if (error) throw new Error(readableError(error, "Could not delete linen item."));
}

/** List linen washing entries in a date range (aggregated). */
export async function listLinenWashingRange(branchCode, fromDate, toDate) {
  const client = requireClient();
  const { data, error } = await client
    .from("linen_washing_register")
    .select("*")
    .eq("branch_code", branchCode)
    .gte("report_date", fromDate)
    .lte("report_date", toDate);
  if (error) throw new Error(readableError(error, "Could not load linen range."));
  return data ?? [];
}

export async function listLinenWashing(branchCode, date) {
  const client = requireClient();
  const [itemsRes, sheetRes] = await Promise.all([
    client
      .from("linen_washing_register")
      .select("*")
      .eq("branch_code", branchCode)
      .eq("report_date", date),
    client
      .from("linen_washing_sheets")
      .select("*")
      .eq("branch_code", branchCode)
      .eq("report_date", date)
      .maybeSingle(),
  ]);
  if (itemsRes.error) {
    throw new Error(readableError(itemsRes.error, "Could not load linen register."));
  }
  if (sheetRes.error) {
    throw new Error(readableError(sheetRes.error, "Could not load linen sheet."));
  }
  return { items: itemsRes.data ?? [], sheet: sheetRes.data ?? null };
}

/** Upsert a single linen item row. */
export async function saveLinenWashingItem(branchCode, date, item, fields) {
  const client = requireClient();
  const payload = {
    branch_code: branchCode,
    report_date: date,
    item,
    updated_at: new Date().toISOString(),
  };
  Object.entries(fields ?? {}).forEach(([key, value]) => {
    if (value !== undefined) payload[key] = value;
  });
  const { error } = await client
    .from("linen_washing_register")
    .upsert(payload, { onConflict: "branch_code,report_date,item" });
  if (error) {
    throw new Error(readableError(error, "Could not save linen item."));
  }
}

/** Upsert the linen washing sheet header. */
export async function saveLinenWashingSheet(branchCode, date, fields) {
  const client = requireClient();
  const payload = {
    branch_code: branchCode,
    report_date: date,
    updated_at: new Date().toISOString(),
  };
  Object.entries(fields ?? {}).forEach(([key, value]) => {
    if (value !== undefined) payload[key] = value;
  });
  const { error } = await client
    .from("linen_washing_sheets")
    .upsert(payload, { onConflict: "branch_code,report_date" });
  if (error) {
    throw new Error(readableError(error, "Could not save linen sheet."));
  }
}
export async function saveRoomBoySheet(branchCode, date, fields) {
  const client = requireClient();
  const payload = {
    branch_code: branchCode,
    report_date: date,
    updated_at: new Date().toISOString(),
  };
  Object.entries(fields ?? {}).forEach(([key, value]) => {
    if (value !== undefined) payload[key] = value;
  });

  const { data, error } = await client
    .from("room_boy_sheets")
    .upsert(payload, { onConflict: "branch_code,report_date" });

  if (error) {
    throw new Error(readableError(error, "Could not save the room boy report."));
  }
  return data;
}

/** Upsert one room row of the Room Boy Daily Report. */
export async function saveRoomBoyEntry(branchCode, date, roomNo, fields) {
  const client = requireClient();
  const payload = {
    branch_code: branchCode,
    report_date: date,
    room_no: roomNo,
    updated_at: new Date().toISOString(),
  };
  Object.entries(fields ?? {}).forEach(([key, value]) => {
    if (value !== undefined) payload[key] = value;
  });

  const { data, error } = await client
    .from("room_boy_entries")
    .upsert(payload, { onConflict: "branch_code,report_date,room_no" });

  if (error) {
    throw new Error(readableError(error, "Could not save the room entry."));
  }
  return data;
}

/** Subscribe to real-time Room Boy Daily Report changes. */
export function subscribeToRoomBoyReport(branchCode, date, onChange) {
  const client = requireClient();
  const channel = client
    .channel(`room_boy_report_${branchCode}_${date}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_boy_sheets",
        filter: `branch_code=eq.${branchCode}`,
      },
      (payload) => {
        if (payload?.new?.report_date === date || payload?.old?.report_date === date) {
          onChange(payload);
        }
      },
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_boy_entries",
        filter: `branch_code=eq.${branchCode}`,
      },
      (payload) => {
        if (payload?.new?.report_date === date || payload?.old?.report_date === date) {
          onChange(payload);
        }
      },
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}

/** List active room boys for a branch (for supervisor assignment dropdown). */
export async function listRoomBoys(branchCode) {
  const client = requireClient();
  const { data, error } = await client
    .from("profiles")
    .select("id,email,full_name,role,branch_code,is_active")
    .eq("role", "room_boy")
    .eq("branch_code", branchCode)
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(readableError(error, "Could not load room boys."));
  }
  return data ?? [];
}

/** Upsert a room boy entry including assignment and status. */
export async function saveRoomBoyEntryFull(branchCode, date, roomNo, fields) {
  const client = requireClient();
  const payload = {
    branch_code: branchCode,
    report_date: date,
    room_no: roomNo,
    updated_at: new Date().toISOString(),
  };
  Object.entries(fields ?? {}).forEach(([key, value]) => {
    if (value !== undefined) payload[key] = value;
  });

  const { data, error } = await client
    .from("room_boy_entries")
    .upsert(payload, { onConflict: "branch_code,report_date,room_no" });

  if (error) {
    throw new Error(readableError(error, "Could not save the room entry."));
  }
  return data;
}

/** Record a supervisor rating for a room boy's cleaning of a room. */
export async function saveRoomBoyRating(branchCode, date, roomNo, rating, notes) {
  const client = requireClient();
  const { data, error } = await client
    .from("room_boy_entries")
    .upsert(
      {
        branch_code: branchCode,
        report_date: date,
        room_no: roomNo,
        supervisor_rating: rating,
        supervisor_notes: notes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "branch_code,report_date,room_no" },
    );

  if (error) {
    throw new Error(readableError(error, "Could not save the rating."));
  }
  return data;
}

/** Record that a supervisor has inspected a room boy's work.
 *
 * This is the only transition that may mark a room "completed". Until the
 * supervisor saves the inspection the room stays in "awaiting_inspection".
 */
export async function saveRoomBoyInspection(
  branchCode,
  date,
  roomNo,
  inspectorName,
  inspectorRole = "supervisor",
) {
  const client = requireClient();
  const { data, error } = await client
    .from("room_boy_entries")
    .upsert(
      {
        branch_code: branchCode,
        report_date: date,
        room_no: roomNo,
        inspected_by: inspectorName,
        inspected_at: new Date().toISOString(),
        inspected_role: inspectorRole,
        boy_status: "completed",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "branch_code,report_date,room_no" },
    );

  if (error) {
    throw new Error(readableError(error, "Could not save the inspection."));
  }
  return data;
}

/**
 * Clear a saved inspection so an inspected room can be reassigned.
 *
 * The database trigger only allows the assigned room boys to change when
 * inspected_at is cleared in the same statement, so this reset is the first
 * step of a reassignment. The room then needs a fresh inspection.
 */
export async function resetRoomBoyInspection({ branchCode, date, roomNo }) {
  const client = requireClient();
  const { error } = await client.rpc("reset_room_boy_inspection", {
    p_branch_code: branchCode,
    p_date: date,
    p_room_no: String(roomNo ?? ""),
  });

  if (error) {
    throw new Error(
      readableError(error, "Could not unlock the room for reassignment."),
    );
  }
}

/** Tell housekeeping management that a room boy started or finished a room.
 *
 * Uses a SECURITY DEFINER RPC so room boys cannot write staff notifications
 * directly. The reference column keeps repeated taps from ringing twice.
 */
export async function notifyRoomCleaning({
  branchCode,
  roomNumber,
  roomBoyName,
  phase,
  timeIn,
  timeOut,
  reference,
}) {
  const client = requireClient();
  const { data, error } = await client.rpc("notify_room_cleaning", {
    p_branch_code: branchCode,
    p_room_number: String(roomNumber ?? ""),
    p_room_boy_name: roomBoyName || null,
    p_phase: phase,
    p_time_in: timeIn || null,
    p_time_out: timeOut || null,
    p_reference: reference || null,
  });

  if (error) {
    throw new Error(
      readableError(error, "Could not create cleaning notification."),
    );
  }
  return data;
}

/** Load one Food & Beverages log for a branch and period. */
export async function getFnbLog(branchCode, logType, periodKey) {
  const client = requireClient();
  const { data, error } = await client
    .from("fnb_log_entries")
    .select("rows,updated_by_name,updated_at")
    .eq("branch_code", branchCode)
    .eq("log_type", logType)
    .eq("period_key", periodKey)
    .maybeSingle();

  if (error) {
    throw new Error(readableError(error, "Could not load the F&B log."));
  }
  return data ?? null;
}

/** Save (upsert) one Food & Beverages log for a branch and period. */
export async function saveFnbLog(
  branchCode,
  logType,
  periodKey,
  rows,
  updatedByName,
) {
  const client = requireClient();
  const { data, error } = await client
    .from("fnb_log_entries")
    .upsert(
      {
        branch_code: branchCode,
        log_type: logType,
        period_key: periodKey,
        rows: rows ?? [],
        updated_by_name: updatedByName ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "branch_code,log_type,period_key" },
    )
    .select("rows,updated_by_name,updated_at")
    .single();

  if (error) {
    throw new Error(readableError(error, "Could not save the F&B log."));
  }
  return data;
}

/** Load breakfast orders for a branch and date, sorted by order time. */
export async function listBreakfastOrders(branchCode, orderDate) {
  const client = requireClient();
  const { data, error } = await client
    .from("breakfast_orders")
    .select("*")
    .eq("branch_code", branchCode)
    .eq("order_date", orderDate)
    .order("order_time", { ascending: true, nullsfirst: true })
    .order("room_number", { ascending: true });

  if (error) {
    throw new Error(readableError(error, "Could not load breakfast orders."));
  }
  return data ?? [];
}

/** Save (upsert) a breakfast order row. */
export async function saveBreakfastOrder(
  branchCode,
  roomNumber,
  orderDate,
  fields,
  updatedByName,
) {
  const client = requireClient();
  const payload = {
    branch_code: branchCode,
    room_number: roomNumber,
    order_date: orderDate,
    updated_at: new Date().toISOString(),
    updated_by_name: updatedByName ?? null,
  };
  Object.entries(fields ?? {}).forEach(([key, value]) => {
    if (value !== undefined) payload[key] = value;
  });

  const { data, error } = await client
    .from("breakfast_orders")
    .upsert(payload, { onConflict: "branch_code,room_number,order_date" })
    .select("*")
    .single();

  if (error) {
    throw new Error(readableError(error, "Could not save breakfast order."));
  }
  return data;
}

/** Initialize breakfast order rows for all rooms of a branch on a date. */
export async function initBreakfastOrders(branchCode, orderDate, roomNumbers, updatedByName) {
  const client = requireClient();
  const rows = roomNumbers.map((roomNumber) => ({
    branch_code: branchCode,
    room_number: roomNumber,
    order_date: orderDate,
    items_checklist: [],
    items_verified: false,
    sent_at: null,
    tray_collected: false,
    tray_collected_at: null,
    created_by_name: updatedByName,
    updated_by_name: updatedByName,
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await client
    .from("breakfast_orders")
    .upsert(rows, { onConflict: "branch_code,room_number,order_date" });

  if (error) {
    throw new Error(readableError(error, "Could not initialize breakfast orders."));
  }
  return data;
}

/** Create a notification for a room boy (room assigned or rating received). */
export async function createRoomBoyNotification({
  branchCode,
  roomNumber,
  roomBoyName,
  notificationType,
  supervisorName,
  rating,
  ratingNotes,
  remark,
}) {
  const client = requireClient();
  // Generate the id here so the database trigger and the direct push call below
  // both reference the same notification. /api/push claims the id, so the phone
  // is alerted exactly once even though two independent paths can deliver it.
  const notificationId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : null;

  // Do not ask for the inserted row back: the room_boy_notifications SELECT
  // policy only exposes rows to the room boy himself, so a supervisor or
  // admin requesting the row would get a 403 and the insert would fail.
  const { error } = await client.from("room_boy_notifications").insert([
    {
      ...(notificationId ? { id: notificationId } : {}),
      branch_code: branchCode,
      room_number: roomNumber,
      room_boy_name: roomBoyName,
      notification_type: notificationType,
      supervisor_name: supervisorName ?? null,
      rating: rating ?? null,
      rating_notes: ratingNotes ?? null,
      remark: remark ?? null,
    },
  ]);

  if (error) {
    throw new Error(readableError(error, "Could not create notification."));
  }

  // Alert the phone even when the room boy's app is closed. The database
  // trigger also calls /api/push as a backup; the shared notification id keeps
  // that redundant delivery exactly-once.
  try {
    await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notificationId,
        roomBoyName,
        branchCode,
        roomNumber,
        notificationType,
        remark: remark ?? null,
      }),
    });
  } catch {
    // Push is best-effort; the database trigger remains as a fallback.
  }

  return notificationId;
}

/** List notifications for a room boy, including ones already marked done. */
export async function listRoomBoyNotifications(roomBoyName, branchCode) {
  const client = requireClient();
  const { data, error } = await client
    .from("room_boy_notifications")
    .select("*")
    .eq("room_boy_name", roomBoyName)
    .eq("branch_code", branchCode)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(readableError(error, "Could not load notifications."));
  }
  return data ?? [];
}

/** Mark all notifications for a room boy as read. */
export async function markRoomBoyNotificationsRead(roomBoyName, branchCode) {
  const client = requireClient();
  const { data, error } = await client
    .from("room_boy_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("room_boy_name", roomBoyName)
    .eq("branch_code", branchCode)
    .is("read_at", null);

  if (error) {
    throw new Error(readableError(error, "Could not mark notifications read."));
  }
  return data;
}

/** Mark one room boy notification as read (it stays in the list). */
export async function markRoomBoyNotificationRead(id) {
  const client = requireClient();
  const { error } = await client
    .from("room_boy_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);

  if (error) {
    throw new Error(readableError(error, "Could not mark the notification read."));
  }
}

/**
 * Room boy acknowledges a room assignment. Clears the repeating alert and
 * marks the related assignment notification as read.
 */
export async function acknowledgeRoomAssignment({
  branchCode,
  date,
  roomNo,
  roomBoyName,
}) {
  const client = requireClient();
  const now = new Date().toISOString();
  const changes = { assignment_acknowledged_at: now, updated_at: now };

  // The room boy may be the primary cleaner or a partner on the room.
  const { error } = await client
    .from("room_boy_entries")
    .update(changes)
    .eq("branch_code", branchCode)
    .eq("report_date", date)
    .eq("room_no", roomNo)
    .eq("assigned_to", roomBoyName);

  if (error) {
    throw new Error(readableError(error, "Could not acknowledge the assignment."));
  }

  const { error: partnerError } = await client
    .from("room_boy_entries")
    .update(changes)
    .eq("branch_code", branchCode)
    .eq("report_date", date)
    .eq("room_no", roomNo)
    .contains("assigned_partners", [roomBoyName]);

  if (partnerError) {
    throw new Error(readableError(partnerError, "Could not acknowledge the assignment."));
  }

  await client
    .from("room_boy_notifications")
    .update({ read_at: now })
    .eq("branch_code", branchCode)
    .eq("room_number", roomNo)
    .eq("room_boy_name", roomBoyName)
    .eq("notification_type", "room_assigned")
    .is("read_at", null);
}

/** Get all ratings received by a room boy (for performance section). */
export async function listRoomBoyRatings(roomBoyName, branchCode) {
  const client = requireClient();
  const { data, error } = await client
    .from("room_boy_notifications")
    .select("room_number, rating, rating_notes, supervisor_name, created_at")
    .eq("room_boy_name", roomBoyName)
    .eq("branch_code", branchCode)
    .eq("notification_type", "rating_received")
    .not("rating", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(readableError(error, "Could not load ratings."));
  }
  return data ?? [];
}

/** Report a PMS room checkout and notify the branch housekeeping team.
 *
 * Uses a SECURITY DEFINER RPC because supervisors, dispatchers and room boys
 * cannot insert staff notifications directly under RLS.
 */
export async function notifyRoomCheckout({
  branchCode,
  roomNumber,
  bookingId,
  guestName,
  reference,
}) {
  const client = requireClient();
  const { data, error } = await client.rpc("notify_room_checkout", {
    p_branch_code: branchCode,
    p_room_number: String(roomNumber ?? ""),
    p_booking_id: bookingId || null,
    p_guest_name: guestName || null,
    p_reference: reference || null,
  });

  if (error) {
    throw new Error(readableError(error, "Could not create checkout notification."));
  }
  return data;
}

/** Create a notification for any staff member. */
export async function createStaffNotification({
  staffEmail,
  staffRole,
  notificationType,
  title,
  message,
  branchCode,
}) {
  const client = requireClient();
  const { error } = await client
    .from("staff_notifications")
    .insert([
      {
        staff_email: staffEmail,
        staff_role: staffRole,
        notification_type: notificationType,
        title: title ?? "Notification",
        message: message ?? "",
        branch_code: branchCode ?? null,
      },
    ]);

  if (error) {
    throw new Error(readableError(error, "Could not create staff notification."));
  }
  return null;
}

/** List notifications for a staff member, including ones already marked done. */
export async function listStaffNotifications(staffEmail) {
  const client = requireClient();
  const { data, error } = await client
    .from("staff_notifications")
    .select("*")
    .eq("staff_email", staffEmail)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(readableError(error, "Could not load staff notifications."));
  }
  return data ?? [];
}

/** Mark all notifications for a staff member as read. */
export async function markStaffNotificationsRead(staffEmail) {
  const client = requireClient();
  const { data, error } = await client
    .from("staff_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("staff_email", staffEmail)
    .is("read_at", null);

  if (error) {
    throw new Error(readableError(error, "Could not mark staff notifications read."));
  }
  return data;
}

/** Mark one staff notification as read (it stays in the list). */
export async function markStaffNotificationRead(id) {
  const client = requireClient();
  const { error } = await client
    .from("staff_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);

  if (error) {
    throw new Error(readableError(error, "Could not mark the notification read."));
  }
}

/**
 * Save a housekeeping manager cross-check inspection. This never changes the
 * room lifecycle; it records the manager's check and rating of the supervisor
 * and notifies the branch supervisor.
 */
export async function saveManagerInspection({
  branchCode,
  date,
  roomNo,
  managerName,
  managerStatus,
  rating,
  notes,
  reference,
}) {
  const client = requireClient();
  const now = new Date().toISOString();

  const { error } = await client
    .from("room_boy_entries")
    .upsert(
      {
        branch_code: branchCode,
        report_date: date,
        room_no: roomNo,
        manager_inspected_by: managerName,
        manager_inspected_at: now,
        manager_status: managerStatus,
        manager_rating: rating ?? null,
        manager_notes: notes ?? null,
        updated_at: now,
      },
      { onConflict: "branch_code,report_date,room_no" },
    );

  if (error) {
    throw new Error(readableError(error, "Could not save the manager check."));
  }

  const { error: notifyError } = await client.rpc("notify_manager_inspection", {
    p_branch_code: branchCode,
    p_room_number: String(roomNo ?? ""),
    p_manager_name: managerName,
    p_manager_status: managerStatus,
    p_rating: rating ?? null,
    p_notes: notes ?? null,
    p_reference: reference ?? null,
  });

  if (notifyError) {
    throw new Error(
      readableError(notifyError, "Could not send the manager notification."),
    );
  }

  return { inspectedAt: now };
}

