// Hamsun PMS (Supabase) integration.
//
// The portal signs in with the shared PMS account, reads the active properties,
// rooms and bookings, and turns them into a room-by-room occupancy snapshot for
// the selected inspection date. Everything is cached in localStorage so a page
// reload can still show the last successful sync if the network is unavailable.

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const PMS_EMAIL = import.meta.env.VITE_PMS_EMAIL ?? "";
const PMS_PASSWORD = import.meta.env.VITE_PMS_PASSWORD ?? "";

const SESSION_KEY = "hamsun-pms-session-v1";
const CATALOG_KEY = "hamsun-pms-catalog-v1";
const CATALOG_TTL = 10 * 60 * 1000;
const SESSION_MARGIN = 60 * 1000;

const PMS_BRANCH_CODES = ["FSL", "CLF", "EXT", "DHA"];

export const hasPmsConfig = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && PMS_EMAIL && PMS_PASSWORD,
);

function readStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Session still works in memory for this page load.
  }
}

function clearStoredSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function readCatalogCache() {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.fetchedAt) return null;
    if (Date.now() - new Date(cached.fetchedAt).getTime() > CATALOG_TTL) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function writeCatalogCache(catalog) {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  } catch {
    // Ignore storage failures.
  }
}

async function fetchWithRetry(url, options, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  throw lastError;
}

async function requestToken(grantType, body) {
  const response = await fetchWithRetry(
    `${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `PMS sign-in failed (${response.status}). ${detail.slice(0, 180)}`,
    );
  }

  const data = await response.json();
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  writeStoredSession(session);
  return session;
}

let sessionPromise = null;

async function getAccessToken(force = false) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "PMS is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.",
    );
  }

  const stored = readStoredSession();
  if (!force && stored?.access_token && stored.expires_at > Date.now() + SESSION_MARGIN) {
    return stored.access_token;
  }

  if (!sessionPromise) {
    sessionPromise = (async () => {
      if (stored?.refresh_token) {
        try {
          const refreshed = await requestToken("refresh_token", {
            refresh_token: stored.refresh_token,
          });
          return refreshed.access_token;
        } catch {
          // Refresh tokens can expire; fall through to a password sign-in.
        }
      }

      if (!PMS_EMAIL || !PMS_PASSWORD) {
        throw new Error(
          "PMS credentials are missing. Add VITE_PMS_EMAIL and VITE_PMS_PASSWORD to .env.",
        );
      }

      const session = await requestToken("password", {
        email: PMS_EMAIL,
        password: PMS_PASSWORD,
      });
      return session.access_token;
    })();

    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }

  try {
    return await sessionPromise;
  } finally {
    sessionPromise = null;
  }
}

async function rest(path, params, token, allowRetry = true) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetchWithRetry(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Profile": "public",
    },
  });

  if (response.status === 401 && allowRetry) {
    clearStoredSession();
    const freshToken = await getAccessToken(true);
    return rest(path, params, freshToken, false);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `PMS request failed (${response.status}). ${detail.slice(0, 180)}`,
    );
  }

  return response.json();
}

async function rpc(fn, params, token, allowRetry = true) {
  const response = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Profile": "public",
    },
    body: JSON.stringify(params),
  });

  if (response.status === 401 && allowRetry) {
    clearStoredSession();
    const freshToken = await getAccessToken(true);
    return rpc(fn, params, freshToken, false);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `PMS request failed (${response.status}). ${detail.slice(0, 180)}`,
    );
  }

  return response.json();
}

/**
 * Breakfast orders and kitchen requirements for one branch and date, read from
 * the PMS RPCs used by the PMS app itself.
 */
export async function fetchPmsBreakfast(branchCode, date) {
  const empty = { orders: [], mains: [], outlook: [] };
  if (!hasPmsConfig) return empty;

  const catalog = await loadPmsCatalog();
  const branch = catalog.branches[branchCode];
  if (!branch) return empty;

  const token = await getAccessToken();
  const [requirements, outlook] = await Promise.all([
    rpc(
      "pms_fnb_kitchen_requirements",
      { p_property_id: branch.property.id, p_date: date },
      token,
    ),
    rpc(
      "pms_fnb_daily_outlook",
      { p_property_id: branch.property.id, p_days: 14 },
      token,
    ),
  ]);

  return {
    orders: Array.isArray(requirements?.orders) ? requirements.orders : [],
    mains: Array.isArray(requirements?.mains) ? requirements.mains : [],
    outlook: Array.isArray(outlook) ? outlook : [],
  };
}

/**
 * Lightweight breakfast-order poll used by the dispatcher alert. It skips the
 * daily outlook RPC so it can run every 30 seconds without extra load.
 */
export async function fetchPmsBreakfastOrders(branchCode, date) {
  if (!hasPmsConfig) return [];

  const catalog = await loadPmsCatalog();
  const branch = catalog.branches[branchCode];
  if (!branch) return [];

  const token = await getAccessToken();
  const requirements = await rpc(
    "pms_fnb_kitchen_requirements",
    { p_property_id: branch.property.id, p_date: date },
    token,
  );

  return Array.isArray(requirements?.orders) ? requirements.orders : [];
}

let catalogPromise = null;

export function loadPmsCatalog(force = false) {
  if (force) {
    catalogPromise = null;
    try {
      localStorage.removeItem(CATALOG_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  if (catalogPromise) return catalogPromise;

  const cached = readCatalogCache();
  if (cached) {
    catalogPromise = Promise.resolve(cached);
    return catalogPromise;
  }

  catalogPromise = (async () => {
    const token = await getAccessToken();

    const properties = await rest(
      "properties",
      {
        select: "id,name,code,short_name",
        is_active: "eq.true",
        order: "name.asc",
      },
      token,
    );

    const linked = properties.filter((property) =>
      PMS_BRANCH_CODES.includes(property.code),
    );

    const entries = await Promise.all(
      linked.map(async (property) => {
        const rooms = await rest(
          "rooms",
          {
            select: "id,room_number",
            property_id: `eq.${property.id}`,
            is_active: "eq.true",
            order: "room_number.asc",
          },
          token,
        );

        return [
          property.code,
          {
            property,
            rooms: rooms.map((room) => ({
              id: room.id,
              number: String(room.room_number),
            })),
          },
        ];
      }),
    );

    const catalog = {
      fetchedAt: new Date().toISOString(),
      branches: Object.fromEntries(entries),
    };
    writeCatalogCache(catalog);
    return catalog;
  })();

  catalogPromise.catch(() => {
    catalogPromise = null;
  });

  return catalogPromise;
}

function toDateString(value) {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function guestName(booking) {
  const guest = Array.isArray(booking.guests)
    ? booking.guests[0]
    : booking.guests;
  return [guest?.first_name, guest?.last_name].filter(Boolean).join(" ").trim();
}

/**
 * Returns the PMS room list for a branch on a given date, with occupancy and
 * the aligned check-in / check-out dates for the current stay.
 *
 * A room counts as occupied when a live booking covers the date:
 *   check_in <= date < check_out
 *
 * PMS status bars (shown below the dates):
 *   green  = CHECKED_IN   (guest has checked in, room is occupied now)
 *   yellow = PENDING      (booking confirmed, check-in pending)
 *   red    = CHECKED_OUT  (guest checked out, room needs turnover)
 *
 * Upcoming check-ins (check_in > date) are also returned so the UI can show
 * "check-in coming" with the date. Checked-out rooms (check_out <= date) are
 * returned so they show immediately.
 */
export async function fetchBranchSnapshot(branchCode, date, options = {}) {
  const catalog = await loadPmsCatalog(Boolean(options.forceCatalog));
  const branch = catalog.branches[branchCode];

  if (!branch) {
    throw new Error(`No PMS property is linked to the ${branchCode} branch.`);
  }

  const token = await getAccessToken();

  // 1. Current stay: check_in <= date < check_out
  const currentBookings = await rest(
    "bookings",
    {
      select:
        "id,check_in,check_out,status,checkin_status,room_id,guests!left(first_name,last_name)",
      property_id: `eq.${branch.property.id}`,
      check_in: `lte.${date}`,
      check_out: `gte.${date}`,
      status: "in.(NEW,CONFIRMED,BLOCKED)",
      order: "check_in.asc",
    },
    token,
  );

  // 2. Checked out on or before the selected date
  const checkedOutBookings = await rest(
    "bookings",
    {
      select:
        "id,check_in,check_out,status,checkin_status,room_id,guests!left(first_name,last_name)",
      property_id: `eq.${branch.property.id}`,
      check_out: `lte.${date}`,
      checkin_status: "eq.CHECKED_OUT",
      status: "in.(NEW,CONFIRMED,BLOCKED)",
      order: "check_out.desc",
    },
    token,
  );

  // 3. Upcoming check-ins after the selected date (within next 7 days)
  // NOTE: check_in is passed once as gt.date; duplicate keys in a JS object
  // would overwrite each other, so we filter the 7-day window client-side.
  const upcomingBookings = await rest(
    "bookings",
    {
      select:
        "id,check_in,check_out,status,checkin_status,room_id,guests!left(first_name,last_name)",
      property_id: `eq.${branch.property.id}`,
      check_in: `gt.${date}`,
      status: "in.(NEW,CONFIRMED)",
      order: "check_in.asc",
    },
    token,
  );

  // Filter to only show check-ins within the next 7 days after the selected date.
  const upcomingStart = shiftDate(date, 1);
  const upcomingEnd = shiftDate(date, 7);
  const futureUpcoming = upcomingBookings.filter(
    (booking) => {
      const checkIn = toDateString(booking.check_in);
      return checkIn >= upcomingStart && checkIn <= upcomingEnd;
    },
  );

  // Build a per-room view of all relevant bookings.
  const bookingsByRoom = new Map();

  const addBooking = (booking, kind) => {
    if (!booking) return;
    const list = bookingsByRoom.get(booking.room_id) ?? [];
    list.push({ ...booking, _kind: kind });
    bookingsByRoom.set(booking.room_id, list);
  };

  currentBookings.forEach((b) => addBooking(b, "current"));
  checkedOutBookings.forEach((b) => addBooking(b, "checked_out"));
  futureUpcoming.forEach((b) => addBooking(b, "upcoming"));

  const rooms = branch.rooms.map((room) => {
    const roomBookings = bookingsByRoom.get(room.id) ?? [];

    // Pick the most relevant booking for display:
    //   current stay takes priority, then checked-out, then upcoming.
    const current = roomBookings.find((b) => b._kind === "current");
    const checkedOut = roomBookings.find((b) => b._kind === "checked_out");
    const upcoming = roomBookings.find((b) => b._kind === "upcoming");

    const booking = current ?? checkedOut ?? upcoming ?? null;

    let occupancy = "vacant";
    let pmsStatus = ""; // "checked_in" | "pending" | "checked_out" | "upcoming" | ""

    if (current) {
      if (current.checkin_status === "CHECKED_OUT") {
        // The guest checked out today. The stay still overlaps the date, but the
        // room is vacant and needs turnover, so surface it as checked out.
        occupancy = "vacant";
        pmsStatus = "checked_out";
      } else {
        occupancy = "occupied";
        if (current.checkin_status === "CHECKED_IN") {
          pmsStatus = "checked_in"; // green
        } else if (current.checkin_status === "PENDING") {
          pmsStatus = "pending"; // yellow
        } else {
          pmsStatus = "confirmed";
        }
      }
    } else if (checkedOut) {
      occupancy = "vacant";
      pmsStatus = "checked_out"; // red
    } else if (upcoming) {
      occupancy = "vacant";
      pmsStatus = "upcoming"; // blue/info
    }

    const checkIn = booking ? toDateString(booking.check_in) : "";
    const checkOut = booking ? toDateString(booking.check_out) : "";

    return {
      id: room.id,
      number: room.number,
      bookingId: booking?.id ?? "",
      occupancy,
      checkIn,
      checkOut,
      guest: booking ? guestName(booking) : "",
      bookingStatus: booking?.status ?? "",
      checkinStatus: booking?.checkin_status ?? "",
      pmsStatus,
      upcomingCheckIn: upcoming ? toDateString(upcoming.check_in) : "",
      upcomingCheckOut: upcoming ? toDateString(upcoming.check_out) : "",
      upcomingGuest: upcoming ? guestName(upcoming) : "",
    };
  });

  return {
    branchCode,
    propertyName: branch.property.name,
    date,
    fetchedAt: new Date().toISOString(),
    rooms,
  };
}

/** Live room numbers for a branch, straight from the PMS catalog. */
export async function fetchBranchRoomNumbers(branchCode) {
  if (!hasPmsConfig) return [];
  const catalog = await loadPmsCatalog();
  const branch = catalog.branches[branchCode];
  if (!branch) return [];
  return branch.rooms.map((room) => room.number);
}
