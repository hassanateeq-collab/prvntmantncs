/** Slack notifications via Vercel API proxy.
 *
 * The browser calls /api/slack which forwards to Slack's Incoming Webhook.
 * This avoids CORS issues with Slack's webhook endpoint.
 *
 * Set VITE_SLACK_WEBHOOK_URL in Vercel environment variables.
 * NOTE: Slack notifications are only sent for the EXT branch.
 */

const SLACK_API_URL = "/api/slack";

export const hasSlackConfig = Boolean(
  import.meta.env.VITE_SLACK_WEBHOOK_URL,
);

/** Post a message to the configured Slack channel via Vercel proxy. */
export async function postToSlack(message) {
  if (!hasSlackConfig) return;

  try {
    const response = await fetch(SLACK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      console.warn("Slack proxy failed:", response.status);
    }
  } catch {
    // Silently ignore; Slack notifications are best-effort.
  }
}

/** Convert 24-hour HH:MM time string to AM/PM format. */
function toAmPm(time24) {
  if (!time24) return "—";
  const [hours, minutes] = time24.split(":").map(Number);
  if (hours == null || minutes == null) return "—";
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

/** Notify when a supervisor completes a room inspection.
 * Single message sent only after supervisor inspection (not after room boy timeout).
 * Only for EXT branch.
 */
export async function notifyRoomInspected(params) {
  if (!hasSlackConfig) return;
  if (params.branchCode !== "EXT") return;

  const {
    branchCode,
    roomNumber,
    roomBoyName,
    timeIn,
    timeOut,
    inspectorName,
    inspectedAt,
    status,
    rating,
    date,
    guestPresence,
    roomStatus,
  } = params;

  const statusEmoji = status === "issue" ? "\u26A0" : "\u2705";
  const ratingText = rating ? ` \u00B7 Rating: ${rating}/5` : "";
  const guestText = guestPresence ? `\n*Guest Present:* ${guestPresence === "yes" ? "Yes" : "No"}` : "";
  const roomStatusText =
    roomStatus === "O/C"
      ? "Cleaning Done"
      : roomStatus === "C/O"
        ? "Check Out Done"
        : roomStatus === "V/C"
          ? "Vacant Cleaning Done"
          : roomStatus ?? "";

  await postToSlack({
    text: `${statusEmoji} *Room Inspection Complete*\n*Branch:* ${branchCode}\n*Room:* ${roomNumber}\n*Room Boy:* ${roomBoyName}\n*Time In:* ${toAmPm(timeIn)}\n*Time Out:* ${toAmPm(timeOut)}\n*Inspected By:* ${inspectorName}\n*Inspected At:* ${toAmPm(inspectedAt)}\n*Status:* ${status}${ratingText}${guestText}\n*Room Status:* ${roomStatusText}\n*Date:* ${date}`,
  });
}

/** Notify Slack when a room boy times out and guest was present (no inspection). */
export async function notifyGuestPresentYes(params) {
  if (!hasSlackConfig) return;
  if (params.branchCode !== "EXT") return;

  const { branchCode, roomNumber, roomBoyName, timeIn, timeOut, date } = params;

  await postToSlack({
    text: `\u2705 *Room Cleaning Complete*\n*Branch:* ${branchCode}\n*Room:* ${roomNumber}\n*Room Boy:* ${roomBoyName}\n*Time In:* ${toAmPm(timeIn)}\n*Time Out:* ${toAmPm(timeOut)}\n*Guest Present:* Yes\n*Inspected By:* N/A\n*Status:* Cleaning Done!\n*Room Status:* Cleaning Done\n*Date:* ${date}`,
  });
}

/** Request browser notification permission. Call on login / app load. */
export function requestNotificationPermission() {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  Notification.requestPermission().then((permission) => {
    if (permission === "granted") {
      // Permission granted; device notifications are now enabled.
    }
  });
  return Notification.permission === "granted";
}

/**
 * Show a persistent device notification. Uses the service worker when it is
 * available so the alert stays visible in an installed PWA, and falls back to
 * the page Notification API otherwise.
 */
export function showDeviceNotification(title, options = {}) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  const payload = {
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-96x96.png",
    ...options,
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => registration.showNotification(title, payload))
      .catch(() => {
        try {
          new Notification(title, payload);
        } catch {
          // Notifications are best-effort.
        }
      });
    return;
  }

  try {
    new Notification(title, payload);
  } catch {
    // Notifications are best-effort.
  }
}

/** Alert dispatchers and F&B managers when new PMS breakfast orders arrive. */
export function sendBreakfastNotification({ branchCode, orders, date }) {
  const list = Array.isArray(orders) ? orders : [];
  const rooms = list
    .map((order) => String(order?.room_number ?? "").trim())
    .filter(Boolean);
  const count = list.length || rooms.length || 1;

  const title =
    count === 1
      ? `🍳 New breakfast order — ${branchCode}`
      : `🍳 ${count} new breakfast orders — ${branchCode}`;
  const body = rooms.length
    ? `Room${rooms.length === 1 ? "" : "s"} ${rooms.join(", ")}`
    : "Open the breakfast log to view the new order.";

  showDeviceNotification(title, {
    body,
    tag: `breakfast-${branchCode}-${date ?? "today"}`,
    renotify: true,
    requireInteraction: true,
    data: {
      url: `/#/branch/${branchCode}/breakfast/${date ?? ""}`,
    },
  });
}

/** Initialize audio context on first user interaction. Call once on app load. */
let bellAudio = null;

export function initAudio() {
  if (!bellAudio) {
    bellAudio = new Audio("/notification-tone.mp3");
    bellAudio.volume = 1.0;
    bellAudio.preload = "auto";
  }
}

/** Play notification tone using the custom MP3 file. */
export function playBellSound() {
  // Vibrate on mobile devices (if supported) to make the alert harder to miss.
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([300, 100, 300, 100, 300]);
    }
  } catch {
    // Vibration is best-effort.
  }
  try {
    if (!bellAudio) {
      bellAudio = new Audio("/notification-tone.mp3");
      bellAudio.volume = 1.0;
      bellAudio.preload = "auto";
    }
    // Play once per interval (tone is 3s long; no overlapping/spam).
    try {
      if (!bellAudio) return;
      bellAudio.currentTime = 0;
      const p = bellAudio.play();
      if (p !== undefined) p.catch(() => {});
    } catch {
      // best-effort
    }
  } catch {
    // Audio playback is best-effort.
  }
}

/** Show device notification + bell sound when a room checks out. */
export function sendCheckoutNotification({ branchCode, roomNumber, guestName }) {
  const guest = guestName ? ` (${guestName})` : "";
  showDeviceNotification(`🧹 Room ${roomNumber} checked out — ${branchCode}`, {
    body: `Room ${roomNumber}${guest} has checked out. Please start the room turnover.`,
    tag: `checkout-${branchCode}-${roomNumber}`,
    renotify: true,
    requireInteraction: true,
    data: {
      url: `/#/branch/${branchCode}/inspection/${new Date()
        .toISOString()
        .slice(0, 10)}`,
    },
  });
  playBellSound();
}

/** Show device notification + bell sound when a room is assigned. */
export function sendRoomAssignmentNotification(params) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  const { branchCode, roomNumber, roomBoyName, assignedBy } = params;

  const title = `🏨 Room Assigned — ${branchCode}`;
  const body = `Room ${roomNumber} assigned to ${roomBoyName}\nAssigned by: ${assignedBy}`;

  const notification = new Notification(title, {
    body,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-96x96.png",
    tag: `room-assign-${branchCode}-${roomNumber}`,
    renotify: true,
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };

  playBellSound();
}
