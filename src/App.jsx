import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { roomLists, roomListSources, pmsBranchCodes } from "./data/roomLists";
import { fetchBranchSnapshot, fetchBranchRoomNumbers, fetchPmsBreakfast, fetchPmsBreakfastOrders, hasPmsConfig } from "./data/pms";
import {
  BRANCH_CODES,
  acknowledgeRoomAssignment,
  createPublicArea,
  createRoomRemarkOption,
  createStaff,
  deletePublicArea,
  deleteRoomRemarkOption,
  getFnbLog,
  getPublicAreaSheet,
  hasAuthConfig,
  listPmsStatusEvents,
  listPublicAreas,
  listPublicInspectionRecords,
  listRoomBoyReport,
  listLinenWashing,
  listLinenWashingRange,
  saveLinenWashingItem,
  saveLinenWashingSheet,
  listLinenItems,
  addLinenItem,
  renameLinenItem,
  deleteLinenItem,
  listRoomBoys,
  listRoomRemarkOptions,
  listStaff,
  requireClient,
  loadSessionProfile,
  onAuthStateChange,
  subscribeToPush,
  getPushSubscriptions,
  updateOwnName,
  recordPmsStatusEvent,
  saveFnbLog,
  savePublicAreaSheet,
  listBreakfastOrders,
  saveBreakfastOrder,
  initBreakfastOrders,
  saveRoomBoyEntry,
  saveRoomBoyEntryFull,
  saveRoomBoyInspection,
  resetRoomBoyInspection,
  saveRoomBoyRating,
  saveRoomBoySheet,
  saveManagerInspection,
  signInWithPassword,
  signOut,
  subscribeToPublicAreaSheets,
  subscribeToPublicInspectionRecords,
  subscribeToRoomBoyReport,
  updatePublicArea,
  updateStaff,
  upsertPublicInspectionRecord,
} from "./data/auth";
import {
  notifyRoomInspected as slackNotifyRoomInspected,
  notifyGuestPresentYes as slackNotifyGuestPresentYes,
} from "./data/slack";
import {
  createRoomBoyNotification,
  listRoomBoyNotifications,
  markRoomBoyNotificationsRead,
  markRoomBoyNotificationRead,
  listRoomBoyRatings,
  createStaffNotification,
  listStaffNotifications,
  markStaffNotificationsRead,
  markStaffNotificationRead,
  notifyRoomCheckout,
  notifyRoomCleaning,
} from "./data/auth";
import {
  requestNotificationPermission,
  playBellSound,
  sendRoomAssignmentNotification,
  sendBreakfastNotification,
  sendCheckoutNotification,
  showDeviceNotification,
} from "./data/slack";

const branches = [
  { code: "FSL", tone: "fsl", department: "housekeeping" },
  { code: "CLF", tone: "clf", department: "housekeeping" },
  { code: "EXT", tone: "ext", department: "food_beverages" },
  { code: "DHA", tone: "dha", department: "housekeeping" },
  { code: "NST", tone: "nst", department: "housekeeping" },
];

const emptyRoute = { page: "overview", branch: null, checklist: null, date: null };

// Signature directory. Signatures are fixed per branch so every printed sheet
// carries the right name regardless of who is logged in on that device.
const BRANCH_SIGNATURES = {
  FSL: { supervisor: "Ataullah", manager: "Hammad Salafi" },
  CLF: { supervisor: "Shahid", manager: "Zafar Abid" },
  EXT: { supervisor: "Nawab", manager: "Kumail Hussain" },
  DHA: { supervisor: "Zahid", manager: "Areeba Mansoor" },
  NST: { supervisor: "", manager: "" },
};

// Kamran is the housekeeping manager, so manager sign-offs carry his name.
const MANAGER_SIGNATURE = "Kamran";

function getBranchSupervisorSignature(branchCode, fallback = "") {
  return BRANCH_SIGNATURES[branchCode]?.supervisor || fallback;
}

function getBranchManagerSignature(branchCode, fallback = "") {
  return BRANCH_SIGNATURES[branchCode]?.manager || fallback;
}

function getInitials(value) {
  const words = String(value ?? "")
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "HK";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

const STAFF_ROLE_LABELS = {
  superadmin: "Super Admin",
  admin: "Administrator",
  supervisor: "Supervisor",
  room_boy: "Room Boy",
  sweeper: "Sweeper",
  fnb_manager: "F&B Manager",
  tray_collector: "Tray Collector",
  kitchen_incharge: "Kitchen In-charge",
  dispatcher: "Breakfast Dispatcher",
  branch_manager: "Branch Manager",
};

const BRANCH_SCOPED_ROLES = [
  "supervisor",
  "room_boy",
  "sweeper",
  "tray_collector",
  "kitchen_incharge",
  "dispatcher",
  "branch_manager",
];

const DEPARTMENT_LABELS = {
  housekeeping: "Housekeeping",
  food_beverages: "Food & Beverages",
};

function getStaffRoleLabel(role) {
  return STAFF_ROLE_LABELS[role] ?? role ?? "Staff";
}

function isBranchScopedRole(role) {
  return BRANCH_SCOPED_ROLES.includes(role);
}

function getDepartmentForRole(role) {
  if (role === "superadmin") return null;
  if (
    role === "admin" ||
    role === "supervisor" ||
    role === "sweeper" ||
    role === "room_boy" ||
    role === "branch_manager"
  ) {
    return "housekeeping";
  }
  if (
    role === "fnb_manager" ||
    role === "tray_collector" ||
    role === "kitchen_incharge" ||
    role === "dispatcher"
  ) {
    return "food_beverages";
  }
  return null;
}

/** Superadmins, housekeeping admins and F&B managers can open Access settings. */
function canManageAccess(profile) {
  return Boolean(
    profile &&
      ["superadmin", "admin", "fnb_manager"].includes(profile.role),
  );
}

/** Everyone who signs documents can open settings to set their signature name. */
function canOpenSettings(profile) {
  return Boolean(
    profile &&
      [
        "superadmin",
        "admin",
        "fnb_manager",
        "supervisor",
        "sweeper",
        "branch_manager",
      ].includes(profile.role),
  );
}

/** Roles each manager may assign. Superadmins can assign everything. */
function getManageableRoles(profile) {
  if (!profile) return [];
  if (profile.role === "superadmin") {
    return [
      "supervisor",
      "room_boy",
      "sweeper",
      "tray_collector",
      "kitchen_incharge",
      "dispatcher",
      "admin",
      "fnb_manager",
      "superadmin",
      "branch_manager",
    ];
  }
  if (profile.role === "admin") {
    return ["supervisor", "room_boy", "sweeper", "branch_manager"];
  }
  if (profile.role === "fnb_manager") {
    return ["tray_collector", "kitchen_incharge", "dispatcher"];
  }
  return [];
}

/** Managers are locked to their own department; superadmins are not. */
function getManagerDepartment(profile) {
  if (!profile) return null;
  if (profile.role === "admin") return "housekeeping";
  if (profile.role === "fnb_manager") return "food_beverages";
  return null;
}

function getRoleLabel(profile) {
  if (!profile) return "Guest";
  if (profile.role === "dispatcher") {
    return profile.branch_code
      ? `${profile.branch_code} Dispatcher`
      : "Breakfast Dispatcher";
  }
  if (profile.role === "room_boy") {
    return profile.branch_code
      ? `${profile.branch_code} Room Boy`
      : "Room Boy";
  }
  if (profile.role === "sweeper") {
    return profile.branch_code
      ? `${profile.branch_code} Sweeper`
      : "Sweeper";
  }
  if (profile.role === "supervisor") {
    return profile.branch_code
      ? `${profile.branch_code} Supervisor`
      : "Supervisor";
  }
  if (profile.role === "branch_manager") {
    return profile.branch_code
      ? `${profile.branch_code} Branch Manager`
      : "Branch Manager";
  }
  return getStaffRoleLabel(profile.role);
}

/** Room lifecycle labels. Legacy "done" rows are awaiting a supervisor. */
function getRoomBoyStatusLabel(status) {
  if (status === "progress") return "Cleaning";
  if (status === "awaiting_inspection" || status === "done") {
    return "Supervisor Inspection Required";
  }
  if (status === "completed") return "Completed";
  return status || "Pending";
}

function getRoomBoyStatusTone(status) {
  if (status === "progress") return "progress";
  if (status === "awaiting_inspection" || status === "done") return "awaiting";
  if (status === "completed") return "complete";
  return "pending";
}

function getVisibleBranches(profile) {
  if (!profile) return [];
  if (profile.role === "superadmin") return branches;
  if (profile.role === "admin") {
    // Administrators (Kamran) oversee every department, including F&B (EXT).
    return branches;
  }
  if (profile.role === "fnb_manager") {
    // F&B keeps its own logs for every branch, not only the EXT branch.
    return branches;
  }
  if (profile.role === "tray_collector" || profile.role === "kitchen_incharge") {
    // Tray collectors and kitchen incharges see only their assigned branch.
    return branches.filter((branch) => branch.code === profile.branch_code);
  }
  return branches.filter((branch) => branch.code === profile.branch_code);
}

const checklists = [
  {
    id: "inspection",
    title: "Supervisor Daily Room Inspection Checklist",
    description:
      "Room-by-room quality inspection with supervisor notes and sign-off.",
    icon: "clipboard",
    tag: "Daily",
    index: "01",
  },
  {
    id: "public",
    title: "Public Area Cleaning sheet",
    description:
      "Daily cleaning record for lobbies, corridors and shared guest areas.",
    icon: "spray",
    tag: "Daily",
    index: "02",
  },
  {
    id: "roomboy",
    title: "Room Boy Daily Report",
    description:
      "Room-by-room cleaning record with status, time in, time out and signature.",
    icon: "bed",
    tag: "Daily",
    index: "03",
  },
  {
    id: "linen",
    title: "Daily Linen Washing Send, Receive & Pending Register",
    description:
      "Daily linen washing send, receive and pending register for housekeeping.",
    icon: "layers",
    tag: "Daily",
    index: "04",
  },
  {
    id: "deep",
    title: "Deep cleaning schedule",
    description: "Planned deep-cleaning work with owners and completion dates.",
    icon: "calendar",
    tag: "Schedule",
    index: "04",
  },
];

const fnbChecklists = [
  {
    id: "breakfast",
    title: "Breakfast Log",
    description:
      "Daily breakfast service by room and guest, with pax, items served and remarks.",
    icon: "utensils",
    tag: "Daily",
    index: "01",
    period: "day",
    columns: [
      { key: "room", label: "Room / Guest", placeholder: "Room 101" },
      { key: "guest", label: "Guest name", placeholder: "Guest name" },
      { key: "pax", label: "Pax", type: "number", width: "72px" },
      { key: "items", label: "Breakfast items", placeholder: "Items served" },
      { key: "time", label: "Time", type: "time", width: "112px" },
      { key: "remarks", label: "Remarks", placeholder: "Notes" },
    ],
  },
  {
    id: "utensils",
    title: "Guest Kitchen Monthly Utensils and Crockery Register",
    description:
      "Monthly stock register for guest kitchen utensils, crockery and breakage.",
    icon: "layers",
    tag: "Monthly",
    index: "02",
    period: "month",
    columns: [
      { key: "item", label: "Item", placeholder: "Item name", width: "180px" },
      { key: "par_qty", label: "Par Qty", type: "number", width: "70px" },
      { key: "opening", label: "Opening", type: "number", width: "70px" },
      { key: "closing", label: "Closing", type: "number", width: "70px" },
      { key: "broken", label: "Broken", type: "number", width: "70px" },
      { key: "missing", label: "Missing", type: "number", width: "70px" },
      { key: "loss_pkr", label: "Loss (PKR)", type: "number", width: "90px" },
      { key: "remarks", label: "Remarks", placeholder: "Notes", width: "140px" },
    ],
  },
  {
    id: "wastage",
    title: "Wastage of Food Items",
    description:
      "Daily record of food wastage with quantity, reason and action taken.",
    icon: "spray",
    tag: "Daily",
    index: "03",
    period: "day",
    columns: [
      { key: "item", label: "Food item", placeholder: "Item name" },
      { key: "quantity", label: "Quantity", placeholder: "0" },
      { key: "unit", label: "Unit", placeholder: "kg / pcs / litres" },
      { key: "reason", label: "Reason", placeholder: "Reason for wastage" },
      { key: "action", label: "Action taken", placeholder: "Action taken" },
      { key: "recordedBy", label: "Recorded by", placeholder: "Staff name" },
    ],
  },
  {
    id: "deep_cleaning",
    title: "Deep Cleaning Log",
    description:
      "Daily deep-cleaning work by area, task, chemical and staff member.",
    icon: "calendar",
    tag: "Daily",
    index: "04",
    period: "day",
    columns: [
      { key: "area", label: "Area", placeholder: "Kitchen / store / service area" },
      { key: "task", label: "Cleaning task", placeholder: "Task completed" },
      { key: "chemical", label: "Chemical / agent", placeholder: "Chemical used" },
      { key: "doneBy", label: "Done by", placeholder: "Staff name" },
      { key: "time", label: "Time", type: "time", width: "112px" },
      { key: "remarks", label: "Remarks", placeholder: "Notes" },
    ],
  },
  {
    id: "fumigation",
    title: "Fumigation Log",
    description:
      "Monthly fumigation visits by area, chemical, dosage and next due date.",
    icon: "shield",
    tag: "Monthly",
    index: "05",
    period: "month",
    columns: [
      { key: "date", label: "Date", type: "date", width: "132px" },
      { key: "area", label: "Area treated", placeholder: "Area" },
      { key: "chemical", label: "Chemical", placeholder: "Chemical used" },
      { key: "dosage", label: "Dosage", placeholder: "Dosage" },
      { key: "doneBy", label: "Done by", placeholder: "Technician / staff" },
      { key: "nextDue", label: "Next due", type: "date", width: "132px" },
      { key: "remarks", label: "Remarks", placeholder: "Notes" },
    ],
  },
];

const fnbChecklistIds = new Set(fnbChecklists.map((item) => item.id));

function getChecklistsForProfile(profile) {
  if (!profile) return [];
  if (profile.role === "fnb_manager") return fnbChecklists;
  if (profile.role === "superadmin") return [...checklists, ...fnbChecklists];
  return checklists;
}

const inspectionSections = [
  {
    title: "Bedroom",
    items: [
      { id: "bed", label: "Bed & linen" },
      { id: "surfaces", label: "Dusting & surfaces" },
      { id: "floor", label: "Floor & carpet" },
      { id: "windows", label: "Windows & mirrors" },
      { id: "amenities", label: "Amenities & supplies" },
    ],
  },
  {
    title: "Bathroom",
    items: [
      { id: "bathroom", label: "Bathroom cleanliness" },
      { id: "towels", label: "Towels & toiletries" },
    ],
  },
  {
    title: "Safety & maintenance",
    items: [
      { id: "maintenance", label: "Maintenance & damages" },
      { id: "fixtures", label: "Safety & fixtures" },
    ],
  },
];

const publicShifts = [
  { key: "shift1", label: "First time" },
  { key: "shift2", label: "Second time" },
  { key: "shift3", label: "Third time" },
];

const inspectionItems = inspectionSections.flatMap((section) => section.items);
const itemStatuses = [
  { value: "pass", label: "Pass" },
  { value: "issue", label: "Issue" },
  { value: "na", label: "N/A" },
];
const STORAGE_PREFIX = "hamsun-daily-inspection-v1";

const today = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
}).format(new Date());

function getTodayISO() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function isNearCheckOut(checkOut, date) {
  if (!checkOut) return false;
  return checkOut === date || checkOut === shiftDate(date, 1);
}

function formatDisplayDate(dateString) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${dateString}T00:00:00`));
}

function getCurrentMonth() {
  return getTodayISO().slice(0, 7);
}

function shiftMonth(monthString, delta) {
  const [year, month] = monthString.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDisplayMonth(monthString) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${monthString}-01T00:00:00`));
}

function formatSyncTime(value) {
  if (!value) return "just now";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

/** Turn a stored 24-hour "HH:MM" clock (or ISO timestamp) into AM/PM. */
function formatClock(value) {
  if (!value) return "—";
  const text = String(value);
  if (text.includes("T")) {
    const stamp = new Date(text);
    if (!Number.isNaN(stamp.getTime())) {
      return stamp.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
  }
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return text;
  const date = new Date();
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Friendly AM/PM timestamp for notifications. */
function formatNotificationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const MANAGER_STATUS_LABELS = {
  verified: "Verified",
  issue: "Issue",
  redo: "Re-clean",
};

function formatManagerStatus(value) {
  if (!value) return "";
  return MANAGER_STATUS_LABELS[value] ?? value;
}

function notificationTypeLabel(type) {
  switch (type) {
    case "room_assigned":
      return "🏨 Room assigned";
    case "room_checkout":
      return "🧹 Room checked out";
    case "room_cleaning":
      return "🧽 Room cleaning";
    case "manager_inspection":
      return "✅ Manager check";
    case "test_notification":
      return "🔔 Notification";
    case "rating_received":
      return "⭐ Rating received";
    default:
      return "🔔 Notification";
  }
}

function getFloor(room) {
  if (!room) return "—";
  if (/^room/i.test(room)) return "Room 8";
  if (room.startsWith("G")) return "Ground";

  const block = room.match(/^([A-C])\d/i);
  if (block) return `Block ${block[1].toUpperCase()}`;

  const floor = room.match(/^(\d)/);
  if (!floor) return "—";

  const number = Number(floor[1]);
  const suffix =
    number === 1 ? "st" : number === 2 ? "nd" : number === 3 ? "rd" : "th";
  return `${number}${suffix} floor`;
}

function getRecordStatus(record) {
  if (!record?.savedAt) return "pending";
  if (Object.values(record.items ?? {}).includes("issue")) return "issue";
  return "complete";
}

function countIssues(record) {
  return Object.values(record?.items ?? {}).filter((value) => value === "issue")
    .length;
}

function emptyDaily() {
  return { rooms: {}, supervisor: "", updatedAt: null };
}

function getStorageKey(branchCode, date) {
  return `${STORAGE_PREFIX}:${branchCode}:${date}`;
}

function loadDaily(branchCode, date) {
  try {
    const raw = localStorage.getItem(getStorageKey(branchCode, date));
    if (!raw) return emptyDaily();
    const parsed = JSON.parse(raw);
    return {
      rooms: parsed.rooms ?? {},
      supervisor: parsed.supervisor ?? "",
      updatedAt: parsed.updatedAt ?? null,
    };
  } catch {
    return emptyDaily();
  }
}

function saveDaily(branchCode, date, data) {
  try {
    localStorage.setItem(getStorageKey(branchCode, date), JSON.stringify(data));
  } catch {
    // The checklist still works for this session if storage is unavailable.
  }
}

const PUBLIC_AREA_PREFIX = "hamsun-public-area-v1";

function getPublicAreaStorageKey(branchCode, date) {
  return `${PUBLIC_AREA_PREFIX}:${branchCode}:${date}`;
}

function emptyPublicArea() {
  return {
    date: "",
    shift: "",
    areas: {},
    supervisorName: "",
    supervisorRemarks: "",
    supervisorSignature: "",
    attendantSignature: "",
    updatedAt: null,
  };
}

function loadPublicArea(branchCode, date) {
  try {
    const raw = localStorage.getItem(getPublicAreaStorageKey(branchCode, date));
    if (!raw) return emptyPublicArea();
    const parsed = JSON.parse(raw);
    return {
      date: parsed.date ?? "",
      shift: parsed.shift ?? "",
      areas: parsed.areas ?? {},
      supervisorName: parsed.supervisorName ?? "",
      supervisorRemarks: parsed.supervisorRemarks ?? "",
      supervisorSignature: parsed.supervisorSignature ?? "",
      attendantSignature: parsed.attendantSignature ?? "",
      updatedAt: parsed.updatedAt ?? null,
    };
  } catch {
    return emptyPublicArea();
  }
}

function savePublicArea(branchCode, date, data) {
  try {
    localStorage.setItem(
      getPublicAreaStorageKey(branchCode, date),
      JSON.stringify(data),
    );
  } catch {
    // The checklist still works for this session if storage is unavailable.
  }
}

const STAY_REMARKS_PREFIX = "hamsun-stay-remarks-v1";

function getStayRemarksKey(branchCode) {
  return `${STAY_REMARKS_PREFIX}:${branchCode}`;
}

function loadStayRemarks(branchCode) {
  try {
    const raw = localStorage.getItem(getStayRemarksKey(branchCode));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStayRemarks(branchCode, store) {
  try {
    localStorage.setItem(getStayRemarksKey(branchCode), JSON.stringify(store));
  } catch {
    // The remarks still work for this session if storage is unavailable.
  }
}

function getStayRemark(branchCode, room) {
  const store = loadStayRemarks(branchCode);
  return store[room] ?? null;
}

function setStayRemark(branchCode, room, entry) {
  const store = loadStayRemarks(branchCode);
  store[room] = entry;
  saveStayRemarks(branchCode, store);
}

// A new check-in starts a new stay, so remarks from the previous guest are
// cleared. While the room is vacant the remarks remain visible until the next
// check-in actually begins.
function reconcileStayRemarks(branchCode, rooms) {
  const store = loadStayRemarks(branchCode);
  let changed = false;

  rooms.forEach((room) => {
    if (room.occupancy !== "occupied") return;

    const entry = store[room.number];
    if (!entry) return;

    const bookingChanged =
      room.bookingId && entry.bookingId
        ? room.bookingId !== entry.bookingId
        : (entry.checkIn ?? "") !== (room.checkIn ?? "");

    if (bookingChanged) {
      delete store[room.number];
      changed = true;
    }
  });

  if (changed) saveStayRemarks(branchCode, store);
}

function getRoomRemarks(branchCode, room, record) {
  const stored = getStayRemark(branchCode, room);
  if (stored) return stored.remarks ?? "";

  const remarks = record?.remarks ?? "";
  if (!remarks) return "";

  if (record?.occupancy === "occupied" && record?.checkIn) {
    return record?.remarksStay === record.checkIn ? remarks : "";
  }

  return remarks;
}

function migrateDailyRemarks(branchCode, daily) {
  const store = loadStayRemarks(branchCode);
  let changed = false;

  Object.entries(daily.rooms).forEach(([room, record]) => {
    if (!record?.remarks || store[room]) return;

    store[room] = {
      bookingId: record.pmsBookingId ?? "",
      checkIn: record.checkIn ?? "",
      remarks: record.remarks,
      updatedAt: record.savedAt ?? null,
    };
    changed = true;
  });

  if (changed) saveStayRemarks(branchCode, store);
}

function formatLongDate(value) {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  switch (name) {
    case "clipboard":
      return (
        <svg {...common}>
          <path d="M9 4.5h6" />
          <path d="M9 3.5h6a1 1 0 0 1 1 1v1.8a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
          <path d="M8 5.8H6.6A1.6 1.6 0 0 0 5 7.4v12.1a1.6 1.6 0 0 0 1.6 1.6h10.8a1.6 1.6 0 0 0 1.6-1.6V7.4a1.6 1.6 0 0 0-1.6-1.6H16" />
          <path d="m8.5 13 1.6 1.6 3.1-3.2" />
        </svg>
      );
    case "spray":
      return (
        <svg {...common}>
          <path d="M9 8.5h6.2a2.8 2.8 0 0 1 2.8 2.8v7.2a2 2 0 0 1-2 2H8.2a2 2 0 0 1-2-2v-7.2A2.8 2.8 0 0 1 9 8.5Z" />
          <path d="M8.3 8.5V6.2A1.7 1.7 0 0 1 10 4.5h4.3" />
          <path d="M14.3 4.5h3.2" />
          <path d="M18.5 3.2v2.6" />
          <path d="M20.3 4.5h-1.8" />
          <path d="M8 13.5h8.4" />
          <path d="M10.5 16.5h3.4" />
        </svg>
      );
    case "bed":
      return (
        <svg {...common}>
          <path d="M3.5 18.5v-11" />
          <path d="M3.5 14.5h17v4" />
          <path d="M20.5 14.5v-2.2a2.3 2.3 0 0 0-2.3-2.3H10v4.5" />
          <path d="M6.3 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
          <path d="M6.3 10H10" />
        </svg>
      );
    case "utensils":
      return (
        <svg {...common}>
          <path d="M6 3.5v7a2.5 2.5 0 0 0 5 0v-7" />
          <path d="M8.5 3.5v17" />
          <path d="M17 3.5c-1.4 1.2-2 3-2 5.2 0 1.8.7 3 2 3.3V20.5" />
          <path d="M17 3.5v8.5" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
          <path d="M7.5 3.5v4" />
          <path d="M16.5 3.5v4" />
          <path d="M3.5 10h17" />
          <path d="M8 14h.01" />
          <path d="M12 14h.01" />
          <path d="M16 14h.01" />
          <path d="M8 17.5h.01" />
          <path d="M12 17.5h.01" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      );
    case "arrowUpRight":
      return (
        <svg {...common}>
          <path d="M7 17 17 7" />
          <path d="M8 7h9v9" />
        </svg>
      );
    case "arrowLeft":
      return (
        <svg {...common}>
          <path d="M19 12H5" />
          <path d="m11 18-6-6 6-6" />
        </svg>
      );
    case "chevronLeft":
      return (
        <svg {...common}>
          <path d="m15 18-6-6 6-6" />
        </svg>
      );
    case "chevronRight":
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "building":
      return (
        <svg {...common}>
          <path d="M4.5 20.5V6.8a1 1 0 0 1 .7-1l6-1.6a1 1 0 0 1 1.3 1v15.3" />
          <path d="M12.5 9.5h5.8a1 1 0 0 1 1.2 1v10" />
          <path d="M2.5 20.5h19" />
          <path d="M7.5 9.5h.01M7.5 13h.01M7.5 16.5h.01" />
          <path d="M15.8 13h.01M15.8 16.5h.01" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="m3.5 10.5 8.5-7 8.5 7" />
          <path d="M5.5 9.5v10h13v-10" />
          <path d="M9.5 19.5v-6h5v6" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8 12 3.5Z" />
          <path d="m3.5 12 8.5 4.5 8.5-4.5" />
          <path d="m3.5 16 8.5 4.5 8.5-4.5" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="m6 6 12 12" />
          <path d="m18 6-12 12" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12.5 4.3 4.3L19 7" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4 4" />
        </svg>
      );
    case "printer":
      return (
        <svg {...common}>
          <path d="M7 8V4.5h10V8" />
          <path d="M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13A1.5 1.5 0 0 1 20 10.5v5a1.5 1.5 0 0 1-1.5 1.5H17" />
          <path d="M7 13.5h10v6H7z" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 0 0-13.6-5.2L4 8" />
          <path d="M4 4v4h4" />
          <path d="M4 13a8 8 0 0 0 13.6 5.2L20 16" />
          <path d="M20 20v-4h-4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common}>
          <path d="M9.5 20.5H5.6A1.6 1.6 0 0 1 4 18.9V5.1a1.6 1.6 0 0 1 1.6-1.6h3.9" />
          <path d="M15.5 16.5 20 12l-4.5-4.5" />
          <path d="M20 12H9.5" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
          <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
          <path d="M12 14.5v2.5" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3.2 19 6v5.4c0 4.3-2.8 7.6-7 9.4-4.2-1.8-7-5.1-7-9.4V6l7-2.8Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20.5a7 7 0 0 1 14 0" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M12 3.5v11" />
          <path d="m7.5 10 4.5 4.5 4.5-4.5" />
          <path d="M5 20.5h14" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M6 9a6 6 0 0 1 12 0c0 4.5 2 5.5 2 5.5H4S6 13.5 6 9Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
      );
    default:
      return null;
  }
}

function AuthLoading() {
  return (
    <div className="auth-loading">
      <span className="auth-loading__mark">H</span>
      <div>
        <strong>Hamsun Log Book</strong>
        <p>Checking your access…</p>
      </div>
    </div>
  );
}

function LoginPage({ initialError, onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");
    // Ask for notification permission while we still have the click gesture,
    // so breakfast alerts stay enabled on this device.
    requestNotificationPermission();
    try {
      await onLogin(email, password);
    } catch (err) {
      setError(err?.message || "Sign in failed.");
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <aside className="login-brand">
        <div className="login-brand__top">
          <span className="login-brand__mark">H</span>
          <div>
            <strong>HAMSUN</strong>
            <small>Log Book</small>
          </div>
        </div>

        <div className="login-brand__body">
          <p className="login-brand__kicker">Branch operations portal</p>
          <h1>Every room, every branch, one clean standard.</h1>
          <p>
            Sign in to open your branch workspace, complete supervisor room
            inspections and keep every stay on record.
          </p>

          <ul className="login-brand__list">
            <li>
              <Icon name="clipboard" size={16} />
              Supervisor daily room inspections
            </li>
            <li>
              <Icon name="refresh" size={16} />
              Live PMS occupancy and stay dates
            </li>
            <li>
              <Icon name="shield" size={16} />
              Branch-scoped supervisor access
            </li>
          </ul>
        </div>

        <p className="login-brand__footer">
          Hamsun Hospitality · Internal operations
        </p>
      </aside>

      <main className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-card__heading">
            <span className="login-card__icon">
              <Icon name="lock" size={20} />
            </span>
            <div>
              <p className="page-kicker">Secure sign in</p>
              <h2>Welcome back</h2>
              <p>Use your Hamsun email and password.</p>
            </div>
          </div>

          <label className="login-field">
            <span>Email address</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              placeholder="name@hamsun.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </label>

          <label className="login-field">
            <span>Password</span>
            <div className="login-password">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="button button--primary login-submit"
            type="submit"
            disabled={busy || !hasAuthConfig}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          {!hasAuthConfig ? (
            <p className="login-hint login-hint--warning">
              Login is not configured. Add the portal Supabase URL and anon key
              to <code>.env</code>.
            </p>
          ) : null}

          <p className="login-hint">
            Access is managed by the Hamsun administrator. Contact the admin if
            you cannot sign in.
          </p>
        </form>
      </main>
    </div>
  );
}

function StaffDrawer({ staff, currentProfile, onClose, onSaved }) {
  const isNew = !staff;
  const isSelf = Boolean(staff && staff.id === currentProfile?.id);
  const manageableRoles = getManageableRoles(currentProfile);
  const forcedDepartment = getManagerDepartment(currentProfile);
  const initialRole = staff?.role ?? manageableRoles[0] ?? "supervisor";
  const [form, setForm] = useState(() => ({
    fullName: staff?.full_name ?? "",
    email: staff?.email ?? "",
    role: initialRole,
    branchCode: staff?.branch_code ?? "FSL",
    department:
      forcedDepartment ??
      staff?.department ??
      getDepartmentForRole(initialRole) ??
      "housekeeping",
    isActive: staff?.is_active ?? true,
    password: "",
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Managers only see the roles they may assign. Editing your own login keeps
  // the current role visible even when it is above your management scope.
  const roleOptions =
    manageableRoles.length === 0 || manageableRoles.includes(form.role)
      ? manageableRoles
      : [form.role, ...manageableRoles];

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const setField = (key, value) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setError("");
  };

  const setRole = (role) => {
    setForm((previous) => ({
      ...previous,
      role,
      department:
        forcedDepartment ??
        getDepartmentForRole(role) ??
        previous.department,
    }));
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");

    const branchCode = isBranchScopedRole(form.role) ? form.branchCode : null;
    const department =
      forcedDepartment ??
      getDepartmentForRole(form.role) ??
      form.department ??
      null;

    try {
      if (isNew) {
        if (!form.password) {
          throw new Error("Set a password for the new login.");
        }
        await createStaff({
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          role: form.role,
          branchCode,
          department,
        });
        await onSaved("Login created.");
      } else {
        const updated = await updateStaff({
          id: staff.id,
          email: form.email,
          fullName: form.fullName,
          role: form.role,
          branchCode,
          department,
          isActive: form.isActive,
          password: form.password,
        });
        await onSaved("Login updated.", isSelf ? updated : null);
      }
    } catch (err) {
      setError(err?.message || "Could not save the login.");
      setBusy(false);
    }
  };

  return (
    <div className="drawer-layer">
      <button
        className="drawer-overlay"
        type="button"
        aria-label="Close access settings"
        onClick={onClose}
      />
      <aside
        className="inspection-drawer staff-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-drawer-title"
      >
        <header className="drawer-header">
          <div>
            <span className="drawer-kicker">Access settings</span>
            <h2 id="staff-drawer-title">
              {isNew ? "Add login" : "Manage login"}
            </h2>
            <p>
              {isNew
                ? "Create a portal login and choose the branch it can see."
                : staff.email}
            </p>
          </div>
          <button
            className="drawer-close"
            type="button"
            aria-label="Close access settings"
            onClick={onClose}
          >
            <Icon name="close" size={19} />
          </button>
        </header>

        <form className="staff-form" onSubmit={submit}>
          <div className="drawer-body">
            <section className="drawer-section">
              <div className="drawer-section__heading">
                <h3>Account</h3>
              </div>

              <div className="staff-fields">
                <label>
                  <span>Full name</span>
                  <input
                    type="text"
                    value={form.fullName}
                    placeholder="Supervisor name"
                    onChange={(event) =>
                      setField("fullName", event.target.value)
                    }
                  />
                </label>
                <label>
                  <span>Email / login</span>
                  <input
                    type="email"
                    value={form.email}
                    placeholder="branch@hamsun.com"
                    onChange={(event) => setField("email", event.target.value)}
                    required
                  />
                </label>
                <label className="staff-fields__wide">
                  <span>
                    {isNew ? "Password" : "New password (optional)"}
                  </span>
                  <input
                    type="password"
                    value={form.password}
                    placeholder={
                      isNew
                        ? "At least 6 characters"
                        : "Leave blank to keep the current password"
                    }
                    onChange={(event) =>
                      setField("password", event.target.value)
                    }
                    required={isNew}
                    autoComplete="new-password"
                  />
                </label>
              </div>
            </section>

            <section className="drawer-section">
              <div className="drawer-section__heading">
                <h3>Access</h3>
              </div>

              <div className="staff-fields">
                <label>
                  <span>Role</span>
                  <select
                    value={form.role}
                    disabled={isSelf}
                    onChange={(event) => setRole(event.target.value)}
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {getStaffRoleLabel(role)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Department</span>
                  <select
                    value={form.department ?? ""}
                    disabled
                    onChange={(event) =>
                      setField("department", event.target.value)
                    }
                  >
                    <option value="">—</option>
                    <option value="housekeeping">Housekeeping</option>
                    <option value="food_beverages">Food &amp; Beverages</option>
                  </select>
                </label>
                <label>
                  <span>Branch</span>
                  <select
                    value={form.branchCode}
                    disabled={isSelf || !isBranchScopedRole(form.role)}
                    onChange={(event) =>
                      setField("branchCode", event.target.value)
                    }
                  >
                    {BRANCH_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code} Branch
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {forcedDepartment ? (
                <p className="staff-hint">
                  {forcedDepartment === "housekeeping"
                    ? "You can create supervisors, sweepers and room boys for Housekeeping."
                    : "You can create tray collectors, kitchen in-charge and dispatchers for Food & Beverages."}
                </p>
              ) : null}

              {isSelf ? (
                <p className="staff-hint">
                  You cannot remove your own administrator access.
                </p>
              ) : null}

              <label className="staff-toggle">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  disabled={isSelf}
                  onChange={(event) =>
                    setField("isActive", event.target.checked)
                  }
                />
                <span>
                  <strong>Login enabled</strong>
                  <small>
                    Disabled logins cannot sign in to the portal.
                  </small>
                </span>
              </label>
            </section>

            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <footer className="drawer-footer">
            <div className="drawer-footer__actions">
              <button
                className="button button--secondary"
                type="button"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                type="submit"
                disabled={busy}
              >
                {busy
                  ? "Saving…"
                  : isNew
                    ? "Create login"
                    : "Save changes"}
              </button>
            </div>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function AreaDrawer({ area, branchCode, onClose, onSaved }) {
  const isNew = !area;
  const [form, setForm] = useState(() => ({
    name: area?.name ?? "",
    sortOrder: area?.sort_order ?? 0,
    isActive: area?.is_active ?? true,
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const setField = (key, value) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      if (isNew) {
        await createPublicArea({
          branchCode,
          name: form.name,
          sortOrder: form.sortOrder,
        });
      } else {
        await updatePublicArea({
          id: area.id,
          name: form.name,
          sortOrder: form.sortOrder,
          isActive: form.isActive,
        });
      }
      await onSaved();
    } catch (err) {
      setError(err?.message || "Could not save the area.");
      setBusy(false);
    }
  };

  return (
    <div className="drawer-layer">
      <button
        className="drawer-overlay"
        type="button"
        aria-label="Close area settings"
        onClick={onClose}
      />
      <aside
        className="inspection-drawer area-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="area-drawer-title"
      >
        <header className="drawer-header">
          <div>
            <span className="drawer-kicker">Public areas</span>
            <h2 id="area-drawer-title">
              {isNew ? "Add area" : "Edit area"}
            </h2>
            <p>
              {isNew
                ? "Create a new public area checklist item."
                : `Edit area "${area.name}".`}
            </p>
          </div>
          <button
            className="drawer-close"
            type="button"
            aria-label="Close area settings"
            onClick={onClose}
          >
            <Icon name="close" size={19} />
          </button>
        </header>

        <form className="staff-form" onSubmit={submit}>
          <div className="drawer-body">
            <section className="drawer-section">
              <div className="drawer-section__heading">
                <h3>Area details</h3>
              </div>

              <div className="staff-fields">
                <label>
                  <span>Area name</span>
                  <input
                    type="text"
                    value={form.name}
                    placeholder="e.g. Lobby & front office cleaned"
                    onChange={(event) =>
                      setField("name", event.target.value)
                    }
                    required
                  />
                </label>
                <label>
                  <span>Sort order (auto-renumbered)</span>
                  <input
                    type="number"
                    value={form.sortOrder}
                    min="0"
                    onChange={(event) =>
                      setField("sortOrder", Number(event.target.value) || 0)
                    }
                  />
                  <small className="field-hint">
                    Use 0 to add at the end. Sequence numbers are renumbered
                    automatically so they never repeat.
                  </small>
                </label>
              </div>

              <label className="staff-toggle">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    setField("isActive", event.target.checked)
                  }
                />
                <span>
                  <strong>Area active</strong>
                  <small>
                    Inactive areas are hidden from the cleaning checklist.
                  </small>
                </span>
              </label>

              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}
            </section>
          </div>

          <footer className="drawer-footer">
            <div className="drawer-footer__actions">
              <button
                className="button button--secondary"
                type="button"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                type="submit"
                disabled={busy}
              >
                {busy ? "Saving…" : isNew ? "Create area" : "Save changes"}
              </button>
            </div>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function SettingsPage({ profile, onBack, onProfileChange }) {
  const [staff, setStaff] = useState([]);
  const [areas, setAreas] = useState([]);
  const [areasLoading, setAreasLoading] = useState(false);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [areaEditing, setAreaEditing] = useState(null);
  const [selectedAreaBranch, setSelectedAreaBranch] = useState("FSL");
  const [remarkOptions, setRemarkOptions] = useState([]);
  const [remarkLabel, setRemarkLabel] = useState("");
  const [remarkBusy, setRemarkBusy] = useState(false);
  const [linenItems, setLinenItems] = useState([]);
  const [linenBranch, setLinenBranch] = useState(profile?.branch_code ?? "FSL");
  const [linenLoading, setLinenLoading] = useState(false);
  const [linenNewItem, setLinenNewItem] = useState("");
  const [linenEditing, setLinenEditing] = useState(null);
  const [linenEditingName, setLinenEditingName] = useState("");
  const [linenNotice, setLinenNotice] = useState("");

  const canManageLinen =
    profile?.role === "superadmin" ||
    profile?.role === "admin" ||
    profile?.role === "branch_manager";
  const managerDepartment = getManagerDepartment(profile);
  const canManage = canManageAccess(profile);
  const isFnbManager = profile?.role === "fnb_manager";
  const isSuperadmin = profile?.role === "superadmin";
  const teamLabel =
    managerDepartment === "housekeeping"
      ? "Housekeeping"
      : managerDepartment === "food_beverages"
        ? "Food & Beverages"
        : "All departments";

  const loadStaff = async () => {
    setStatus("loading");
    setError("");
    try {
      setStaff(await listStaff());
      setStatus("ready");
    } catch (err) {
      setError(err?.message || "Could not load portal logins.");
      setStatus("ready");
    }
  };

  const loadLinenItems = async (branchCode) => {
    setLinenLoading(true);
    setLinenNotice("");
    try {
      setLinenItems(await listLinenItems(branchCode));
    } catch (err) {
      setLinenNotice(err?.message || "Could not load linen items.");
    } finally {
      setLinenLoading(false);
    }
  };

  useEffect(() => {
    if (canManageLinen) loadLinenItems(linenBranch);
  }, [linenBranch, canManageLinen]);

  const loadRemarkOptions = async () => {
    try {
      setRemarkOptions(await listRoomRemarkOptions());
    } catch (err) {
      setError(err?.message || "Could not load assignment remarks.");
    }
  };

  useEffect(() => {
    if (canManage) loadStaff();
  }, [canManage]);

  useEffect(() => {
    if (canManage && selectedAreaBranch) {
      loadAreas(selectedAreaBranch);
    }
  }, [selectedAreaBranch, canManage]);

  useEffect(() => {
    if (canManage) loadRemarkOptions();
  }, [canManage]);

  const handleSaved = async (message, updatedProfile) => {
    setEditing(null);
    setNotice(message);
    if (updatedProfile) onProfileChange(updatedProfile);
    await loadStaff();
  };

  const handleAreaSaved = async () => {
    setAreaEditing(null);
    setNotice("Area saved.");
    await loadAreas(selectedAreaBranch);
  };

  const handleOwnNameSave = async () => {
    if (!ownName.trim()) return;
    setOwnNameBusy(true);
    setOwnNameNotice("");
    try {
      const updated = await updateOwnName(ownName.trim());
      setOwnNameNotice("Name saved.");
      if (updated && onProfileChange) onProfileChange(updated);
    } catch (err) {
      setOwnNameNotice(err?.message || "Could not save name.");
    } finally {
      setOwnNameBusy(false);
    }
  };

  const fieldStaffCount = staff.filter((person) =>
    [
      "supervisor",
      "sweeper",
      "room_boy",
      "tray_collector",
      "kitchen_incharge",
      "dispatcher",
    ].includes(person.role),
  ).length;
  const activeCount = staff.filter((person) => person.is_active).length;
  const branchesCovered = new Set(
    staff
      .filter((person) => person.is_active && person.branch_code)
      .map((person) => person.branch_code),
  ).size;

  const namePanel = (
    <section
      className="panel settings-panel"
      aria-labelledby="my-name-title"
      style={{ marginBottom: 18 }}
    >
      <div className="panel-heading">
        <div>
          <h2 id="my-name-title">My name (signature)</h2>
          <p>
            Set your name once. It will auto-fill and be locked wherever your
            signature is required.
          </p>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          className="table-input"
          style={{ flex: "1 1 240px", maxWidth: 320 }}
          value={ownName}
          onChange={(event) => setOwnName(event.target.value)}
          placeholder="Your full name"
        />
        <button
          className="button button--primary"
          type="button"
          onClick={handleOwnNameSave}
          disabled={ownNameBusy || !ownName.trim()}
        >
          {ownNameBusy ? "Saving…" : "Save name"}
        </button>
        {ownNameNotice ? (
          <span className="settings-notice" style={{ margin: 0 }}>
            {ownNameNotice}
          </span>
        ) : null}
      </div>
    </section>
  );

  if (!canManage) {
    return (
      <main className="workspace settings-workspace">
        <div className="branch-page-heading">
          <button className="back-link" type="button" onClick={onBack}>
            <Icon name="arrowLeft" size={15} />
            Back to overview
          </button>

          <div className="branch-page-heading__row">
            <div className="branch-title">
              <span className="branch-title__badge settings-badge">
                <Icon name="user" size={19} />
              </span>
              <div>
                <p className="page-kicker">My profile</p>
                <h1>Settings</h1>
              </div>
            </div>
          </div>

          <p className="page-description">
            Set the name that will be used automatically for your signature on
            inspections and cleaning sheets.
          </p>
        </div>

        {namePanel}

        <footer className="workspace-footer">
          <span>Hamsun Log Book</span>
          <span>My settings</span>
        </footer>
      </main>
    );
  }

  return (
    <main className="workspace settings-workspace">
      {namePanel}

      <div className="branch-page-heading">
        <button className="back-link" type="button" onClick={onBack}>
          <Icon name="arrowLeft" size={15} />
          Back to overview
        </button>

        <div className="branch-page-heading__row">
          <div className="branch-title">
            <span className="branch-title__badge settings-badge">
              <Icon name="shield" size={19} />
            </span>
            <div>
              <p className="page-kicker">Administration</p>
              <h1>{isSuperadmin ? "Access settings" : "Team access"}</h1>
            </div>
          </div>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              setNotice("");
              setEditing("new");
            }}
          >
            <Icon name="plus" size={14} />
            Add login
          </button>
        </div>

        <p className="page-description">
          {managerDepartment === "housekeeping"
            ? "Create and manage Housekeeping logins for supervisors, sweepers and room boys. Passwords can be reset without leaving the portal."
            : managerDepartment === "food_beverages"
              ? "Create and manage Food & Beverages logins for tray collectors, kitchen in-charge and dispatchers. Passwords can be reset without leaving the portal."
              : "Control who can sign in, which branch each person sees, and reset passwords without leaving the portal."}
        </p>
      </div>

      <section className="stats-grid settings-stats" aria-label="Access summary">
        <StatCard
          icon="user"
          tone="green"
          label="Portal logins"
          value={String(staff.length).padStart(2, "0")}
          meta={`${activeCount} active`}
        />
        <StatCard
          icon="shield"
          tone="blue"
          label="Team members"
          value={String(fieldStaffCount).padStart(2, "0")}
          meta={teamLabel}
        />
        <StatCard
          icon="check"
          tone="amber"
          label="Active logins"
          value={String(activeCount).padStart(2, "0")}
          meta="Can sign in"
        />
        <StatCard
          icon="grid"
          tone="violet"
          label="Branches covered"
          value={String(branchesCovered).padStart(2, "0")}
          meta={`of ${BRANCH_CODES.length} branches`}
        />
      </section>

      <section className="panel settings-panel" aria-labelledby="logins-title">
        <div className="panel-heading">
          <div>
            <h2 id="logins-title">Logins & access</h2>
            <p>
              {managerDepartment
                ? `${teamLabel} logins only. Each person sees only the branch assigned to them.`
                : "Supervisors only see the branch assigned to them. Administrators see every branch and this settings page."}
            </p>
          </div>
          <span className="panel-meta">{staff.length} logins</span>
        </div>

        {notice ? (
          <p className="settings-notice" role="status">
            <Icon name="check" size={14} />
            {notice}
          </p>
        ) : null}

        {error ? (
          <p className="settings-error" role="alert">
            {error}
          </p>
        ) : null}

        {status === "loading" ? (
          <p className="settings-empty">Loading portal logins…</p>
        ) : staff.length === 0 ? (
          <p className="settings-empty">No portal logins yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Branch access</th>
                  <th>Status</th>
                  <th className="settings-table__actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {staff.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <div className="settings-person">
                        <span className="settings-avatar">
                          {getInitials(person.full_name || person.email)}
                        </span>
                        <span className="settings-person__text">
                          <strong>{person.full_name || "Unnamed login"}</strong>
                          <small>{person.email}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`role-badge role-badge--${person.role}`}>
                        {getStaffRoleLabel(person.role)}
                      </span>
                      {person.department ? (
                        <small className="table-muted settings-department">
                          {DEPARTMENT_LABELS[person.department] ??
                            person.department}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {isBranchScopedRole(person.role) ? (
                        <span className="branch-tag">
                          {person.branch_code ?? "—"}
                        </span>
                      ) : (
                        <span className="table-muted">All branches</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`status-chip status-chip--${
                          person.is_active ? "active" : "inactive"
                        }`}
                      >
                        <i />
                        {person.is_active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="settings-table__actions">
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => {
                          setNotice("");
                          setEditing(person);
                        }}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!isFnbManager ? (
      <section className="panel settings-panel" aria-labelledby="areas-title">
        <div className="panel-heading">
          <div>
            <h2 id="areas-title">Public Areas</h2>
            <p>
              Manage public area checklist items per branch. Changes apply to
              the Supervisor Daily Room Inspection Checklist for supervisors
              and the Public Area Cleaning Sheet for sweepers.
            </p>
          </div>
          <div className="panel-actions">
            <label className="supervisor-field">
              <span>Branch</span>
              <select
                value={selectedAreaBranch}
                onChange={(event) => setSelectedAreaBranch(event.target.value)}
              >
                {BRANCH_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} Branch
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                setNotice("");
                setAreaEditing("new");
              }}
            >
              <Icon name="plus" size={14} />
              Add area
            </button>
          </div>
        </div>

        {notice ? (
          <p className="settings-notice" role="status">
            <Icon name="check" size={14} />
            {notice}
          </p>
        ) : null}

        {error ? (
          <p className="settings-error" role="alert">
            {error}
          </p>
        ) : null}

        {areasLoading ? (
          <p className="settings-empty">Loading areas…</p>
        ) : areas.length === 0 ? (
          <p className="settings-empty">No areas configured for this branch.</p>
        ) : (
          <div className="table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Area name</th>
                  <th className="settings-table__actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {areas.map((area) => (
                  <tr key={area.id}>
                    <td>{area.sort_order}</td>
                    <td>{area.name}</td>
                    <td className="settings-table__actions">
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => {
                          setNotice("");
                          setAreaEditing(area);
                        }}
                      >
                        Manage
                      </button>
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete area "${area.name}"? The remaining areas will be renumbered automatically.`,
                            )
                          ) {
                            deletePublicArea(area.id, selectedAreaBranch)
                              .then(() => {
                                setNotice("Area deleted and sequence updated.");
                                loadAreas(selectedAreaBranch);
                              })
                              .catch((err) => {
                                setError(
                                  err?.message || "Could not delete the area.",
                                );
                              });
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      ) : null}

      {!isFnbManager ? (
        <section
          className="panel settings-panel"
          aria-labelledby="remark-options-title"
        >
          <div className="panel-heading">
            <div>
              <h2 id="remark-options-title">Assignment remarks</h2>
              <p>
                These options appear in the Remarks dropdown when a supervisor
                or manager assigns a room. When a remark is chosen, the room boy
                keeps receiving the alert until they acknowledge it.
              </p>
            </div>
            <span className="panel-meta">{remarkOptions.length} options</span>
          </div>

          <form
            className="remark-option-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (remarkBusy || !remarkLabel.trim()) return;
              setRemarkBusy(true);
              setError("");
              try {
                await createRoomRemarkOption(remarkLabel);
                setRemarkLabel("");
                setNotice("Assignment remark added.");
                await loadRemarkOptions();
              } catch (err) {
                setError(err?.message || "Could not add the remark option.");
              } finally {
                setRemarkBusy(false);
              }
            }}
          >
            <label className="supervisor-field">
              <span>New remark option</span>
              <input
                type="text"
                value={remarkLabel}
                placeholder="e.g. Urgent"
                onChange={(event) => setRemarkLabel(event.target.value)}
              />
            </label>
            <button
              className="button button--primary"
              type="submit"
              disabled={remarkBusy || !remarkLabel.trim()}
            >
              <Icon name="plus" size={14} />
              {remarkBusy ? "Adding…" : "Add remark"}
            </button>
          </form>

          {remarkOptions.length === 0 ? (
            <p className="settings-empty">No remark options yet.</p>
          ) : (
            <div className="remark-option-list">
              {remarkOptions.map((option) => (
                <span className="remark-option-chip" key={option.id}>
                  {option.label}
                  <button
                    type="button"
                    aria-label={`Delete remark option ${option.label}`}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Delete remark option "${option.label}"?`,
                        )
                      ) {
                        return;
                      }
                      try {
                        await deleteRoomRemarkOption(option.id);
                        setNotice("Assignment remark removed.");
                        await loadRemarkOptions();
                      } catch (err) {
                        setError(
                          err?.message || "Could not remove the remark option.",
                        );
                      }
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {canManageLinen ? (
        <section className="panel" aria-labelledby="linen-items-title">
          <div className="panel-heading">
            <div>
              <h2 id="linen-items-title">Linen register items</h2>
              <p>
                Manage the item list used in the Daily Linen Washing Send, Receive
                &amp; Pending Register.
              </p>
            </div>
          </div>
          <div style={{ padding: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600 }}>Branch:</span>
              <select
                value={linenBranch}
                onChange={(e) => setLinenBranch(e.target.value)}
                className="table-select"
                style={{ width: 120 }}
              >
                {["FSL", "CLF", "EXT", "DHA", "NST"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="text"
              value={linenNewItem}
              onChange={(e) => setLinenNewItem(e.target.value)}
              placeholder="New item name"
              style={{ width: 200 }}
            />
            <button
              className="button button--small"
              type="button"
              onClick={async () => {
                if (!linenNewItem.trim()) return;
                try {
                  const row = await addLinenItem(linenBranch, linenNewItem.trim());
                  setLinenItems((prev) => [...prev, row]);
                  setLinenNewItem("");
                  setLinenNotice("Item added.");
                } catch (err) {
                  setLinenNotice(err?.message || "Could not add item.");
                }
              }}
            >
              Add item
            </button>
          </div>
          {linenLoading ? (
            <div style={{ padding: 16 }} className="table-muted">Loading…</div>
          ) : (
            <div style={{ padding: "0 16px 16px", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {linenItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 8px",
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                  }}
                >
                  {linenEditing === item.id ? (
                    <>
                      <input
                        type="text"
                        value={linenEditingName}
                        onChange={(e) => setLinenEditingName(e.target.value)}
                        style={{ width: 140 }}
                      />
                      <button
                        className="button button--small"
                        type="button"
                        onClick={async () => {
                          try {
                            await renameLinenItem(item.id, linenEditingName.trim());
                            setLinenItems((prev) =>
                              prev.map((it) =>
                                it.id === item.id ? { ...it, name: linenEditingName.trim() } : it,
                              ),
                            );
                            setLinenEditing(null);
                            setLinenEditingName("");
                            setLinenNotice("Item renamed.");
                          } catch (err) {
                            setLinenNotice(err?.message || "Could not rename item.");
                          }
                        }}
                      >
                        Save
                      </button>
                      <button
                        className="button button--small"
                        type="button"
                        onClick={() => {
                          setLinenEditing(null);
                          setLinenEditingName("");
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span>{item.name}</span>
                      <button
                        className="button button--small"
                        type="button"
                        onClick={() => {
                          setLinenEditing(item.id);
                          setLinenEditingName(item.name);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="button button--small"
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`Remove "${item.name}"?`)) return;
                          try {
                            await deleteLinenItem(item.id);
                            setLinenItems((prev) => prev.filter((it) => it.id !== item.id));
                            setLinenNotice("Item removed.");
                          } catch (err) {
                            setLinenNotice(err?.message || "Could not remove item.");
                          }
                        }}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {linenNotice ? (
            <div style={{ padding: "0 16px 12px" }} className="table-muted">
              {linenNotice}
            </div>
          ) : null}
        </section>
      ) : null}

      <footer className="workspace-footer">
        <span>Hamsun Log Book</span>
        <span>Access administration</span>
      </footer>

      {editing ? (
        <StaffDrawer
          staff={editing === "new" ? null : editing}
          currentProfile={profile}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      ) : null}

      {areaEditing ? (
        <AreaDrawer
          area={areaEditing === "new" ? null : areaEditing}
          branchCode={selectedAreaBranch}
          onClose={() => setAreaEditing(null)}
          onSaved={handleAreaSaved}
        />
      ) : null}
    </main>
  );
}

function Sidebar({
  activeBranch,
  open,
  profile,
  visibleBranches,
  settingsActive,
  onHome,
  onSelectBranch,
  onSettings,
  onLogout,
  onClose,
  canInstall,
  onInstall,
  notificationPermission,
  onEnableNotifications,
}) {
  const isAdmin = canManageAccess(profile);
  const showSettings = canOpenSettings(profile);

  return (
    <>
      <button
        className={`sidebar-overlay ${open ? "is-visible" : ""}`}
        type="button"
        aria-label="Close navigation"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside className={`sidebar ${open ? "is-open" : ""}`}>
        <div className="sidebar__brand-row">
          <button className="sidebar-brand" type="button" onClick={onHome}>
            <span className="sidebar-brand__mark">H</span>
            <span className="sidebar-brand__text">
              <strong>HAMSUN</strong>
              <small>Log Book</small>
            </span>
          </button>
          <button
            className="sidebar-close"
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <p className="sidebar-label">Workspace</p>
          <button
            className={`nav-item ${!activeBranch && !settingsActive ? "is-active" : ""}`}
            type="button"
            onClick={onHome}
            aria-current={
              !activeBranch && !settingsActive ? "page" : undefined
            }
          >
            <span className="nav-item__icon">
              <Icon name="grid" size={17} />
            </span>
            <span>Overview</span>
          </button>

          {showSettings ? (
            <button
              className={`nav-item ${settingsActive ? "is-active" : ""}`}
              type="button"
              onClick={onSettings}
              aria-current={settingsActive ? "page" : undefined}
            >
              <span className="nav-item__icon">
                <Icon name="settings" size={17} />
              </span>
              <span>{isAdmin ? "Access settings" : "Settings"}</span>
            </button>
          ) : null}

          <p className="sidebar-label sidebar-label--branches">
            {isAdmin || visibleBranches.length > 1 ? "Branches" : "My branch"}
          </p>
          <div className="sidebar-branches">
            {visibleBranches.map((branch) => (
              <button
                key={branch.code}
                className={`nav-branch nav-branch--${branch.tone} ${
                  activeBranch?.code === branch.code ? "is-active" : ""
                }`}
                type="button"
                onClick={() => onSelectBranch(branch)}
                aria-current={
                  activeBranch?.code === branch.code ? "page" : undefined
                }
              >
                <span className="nav-branch__code">{branch.code}</span>
                <span className="nav-branch__name">{branch.code} Branch</span>
                <span className="nav-branch__count">4</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar-user">
            <span className="sidebar-user__avatar">
              {getInitials(profile?.full_name || profile?.email)}
            </span>
            <span className="sidebar-user__text">
              <strong>{profile?.full_name || profile?.email}</strong>
              <small>{getRoleLabel(profile)}</small>
            </span>
          </div>
          {canInstall ? (
            <button
              className="sidebar-install"
              type="button"
              onClick={onInstall}
            >
              <Icon name="download" size={14} />
              Install app
            </button>
          ) : null}
          {notificationPermission === "default" ? (
            <button
              className="sidebar-install"
              type="button"
              onClick={onEnableNotifications}
            >
              <Icon name="bell" size={14} />
              Turn on alerts
            </button>
          ) : notificationPermission === "denied" ? (
            <p className="sidebar-notify-hint">
              Alerts are blocked. Allow notifications for this site in Chrome
              settings.
            </p>
          ) : null}
          <button
            className="sidebar-logout"
            type="button"
            onClick={onLogout}
          >
            <Icon name="logout" size={14} />
            Sign out
          </button>
          <p>Internal operations portal</p>
        </div>
      </aside>
    </>
  );
}

const checklistLabels = {
  inspection: "Inspection",
  public: "Public areas",
  roomboy: "Room boy",
  breakfast: "Breakfast",
  utensils: "Utensils & crockery",
  wastage: "Wastage",
  deep_cleaning: "Deep cleaning",
  fumigation: "Fumigation",
};

function Topbar({
  activeBranch,
  activeChecklist,
  settingsActive,
  profile,
  onMenu,
  onLogout,
  notifications,
  notificationsUnread,
  onMarkNotificationsRead,
  onMarkNotificationRead,
  onOpenNotification,
}) {
  const staffRoles = [
    "supervisor",
    "branch_manager",
    "room_boy",
    "sweeper",
    "kitchen_incharge",
    "tray_collector",
    "dispatcher",
    "fnb_manager",
    "admin",
    "superadmin",
  ];
  const isStaff = profile && staffRoles.includes(profile.role);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);

  useEffect(() => {
    if (!notifOpen) return undefined;
    const handleClick = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [notifOpen]);

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button
          className="icon-button menu-button"
          type="button"
          aria-label="Open navigation"
          onClick={onMenu}
        >
          <Icon name="menu" size={20} />
        </button>

        <div className="breadcrumb" aria-label="Breadcrumb">
          <span>Log Book</span>
          <Icon name="chevronRight" size={13} />
          {activeBranch ? (
            <>
              <span>Branches</span>
              <Icon name="chevronRight" size={13} />
              <strong>{activeBranch.code}</strong>
              {activeChecklist ? (
                <>
                  <Icon name="chevronRight" size={13} />
                  <strong>
                    {checklistLabels[activeChecklist] ?? "Inspection"}
                  </strong>
                </>
              ) : null}
            </>
          ) : settingsActive ? (
            <strong>Access settings</strong>
          ) : (
            <strong>Overview</strong>
          )}
        </div>
      </div>

      <div className="topbar__right">
        <span className="topbar-date">{today}</span>
        <span className="topbar-divider" />
        <div className="topbar-user">
          <span className="topbar-user__avatar">
            {getInitials(profile?.full_name || profile?.email)}
          </span>
          <span className="topbar-user__text">
            <strong>{profile?.full_name || profile?.email}</strong>
            <small>{getRoleLabel(profile)}</small>
          </span>
        </div>
        {isStaff && (
          <div className="notification-bell-wrap" ref={notifRef}>
            <button
              className={`icon-button notification-bell ${notificationsUnread > 0 ? "has-unread" : ""}`}
              type="button"
              onClick={() => setNotifOpen((value) => !value)}
              aria-label={`Notifications (${notificationsUnread})`}
              aria-expanded={notifOpen}
            >
              <Icon name="bell" size={16} />
              {notificationsUnread > 0 && (
                <span className="notification-badge">{notificationsUnread}</span>
              )}
            </button>
            {notifOpen && (
              <div className="notification-dropdown" role="dialog" aria-label="Notifications">
                <div className="notification-dropdown__header">
                  <strong>Notifications</strong>
                  {notificationsUnread > 0 && (
                    <button
                      type="button"
                      className="notification-dropdown__mark"
                      onClick={() => onMarkNotificationsRead()}
                    >
                      Mark all as read
                    </button>
                  )}
                </div>
                {(!notifications || notifications.length === 0) ? (
                  <p className="notification-dropdown__empty">No notifications yet.</p>
                ) : (
                  <ul className="notification-dropdown__list">
                    {notifications.map((n) => (
                      <li
                        key={n.id}
                        className={`notification-dropdown__item ${n.read_at ? "is-read" : "is-unread"}`}
                      >
                        <button
                          type="button"
                          className="notification-dropdown__main"
                          onClick={() => {
                            setNotifOpen(false);
                            onOpenNotification(n);
                          }}
                        >
                          <span className="notification-dropdown__type">
                            {notificationTypeLabel(n.notification_type)}
                          </span>
                          <span className="notification-dropdown__time">
                            {formatNotificationTime(n.created_at)}
                          </span>
                          <span className="notification-dropdown__body">
                            {n.message ||
                              (n.notification_type === "room_assigned"
                                ? `Room ${n.room_number} assigned to you`
                                : n.title || "")}
                          </span>
                        </button>
                        <div className="notification-dropdown__actions">
                          {n.read_at ? (
                            <span className="notification-done">Done</span>
                          ) : (
                            <button
                              type="button"
                              className="notification-dropdown__done"
                              onClick={() => onMarkNotificationRead(n.id)}
                            >
                              Mark done
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
        <button
          className="icon-button topbar-logout"
          type="button"
          aria-label="Sign out"
          title="Sign out"
          onClick={onLogout}
        >
          <Icon name="logout" size={17} />
        </button>
      </div>
    </header>
  );
}

function NotificationPopup({ notification, onClose, onDone }) {
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  if (!notification) return null;
  const isRead = Boolean(notification.read_at);
  const body =
    notification.message ||
    notification.title ||
    (notification.room_number
      ? `Room ${notification.room_number} notification`
      : "Notification");

  return (
    <div className="notification-popup-layer">
      <button
        className="drawer-overlay"
        type="button"
        aria-label="Close notification"
        onClick={onClose}
      />
      <div
        className="notification-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-popup-title"
      >
        <header className="notification-popup__header">
          <span className="notification-popup__type">
            {notificationTypeLabel(notification.notification_type)}
          </span>
          <button
            className="drawer-close"
            type="button"
            aria-label="Close notification"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <h2 id="notification-popup-title">
          {notification.title || "Notification"}
        </h2>
        <p className="notification-popup__time">
          {formatNotificationTime(notification.created_at)}
        </p>
        <p className="notification-popup__body">{body}</p>
        {notification.remark ? (
          <p className="notification-popup__remark">
            <strong>Remark:</strong> {notification.remark}
          </p>
        ) : null}
        <footer className="notification-popup__footer">
          {isRead ? (
            <span className="notification-done">Done</span>
          ) : (
            <button
              className="button button--primary"
              type="button"
              onClick={() => onDone(notification.id)}
            >
              Mark as done
            </button>
          )}
          <button
            className="button button--secondary"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function StatCard({ icon, tone, label, value, meta }) {
  return (
    <article className="stat-card">
      <div className={`stat-card__icon stat-card__icon--${tone}`}>
        <Icon name={icon} size={19} />
      </div>
      <div className="stat-card__body">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{meta}</small>
      </div>
    </article>
  );
}

function BranchCard({ branch, onSelect }) {
  return (
    <button
      className={`branch-card branch-card--${branch.tone}`}
      type="button"
      onClick={() => onSelect(branch)}
    >
      <span className="branch-card__top">
        <span className="branch-card__code">{branch.code}</span>
        <span className="status-badge">
          <i />
          Active
        </span>
      </span>

      <span className="branch-card__name">{branch.code} Branch</span>
      <span className="branch-card__meta">4 housekeeping checklists</span>

      <span className="branch-card__footer">
        <span>Open workspace</span>
        <Icon name="arrow" size={15} />
      </span>
    </button>
  );
}

function ChecklistCard({ checklist, branch, onOpen }) {
  return (
    <article className={`checklist-card checklist-card--${branch.tone}`}>
      <div className="checklist-card__top">
        <div className="checklist-card__icon">
          <Icon name={checklist.icon} size={21} />
        </div>
        <span className="tag">{checklist.tag}</span>
      </div>

      <h3>{checklist.title}</h3>
      <p>{checklist.description}</p>

      <div className="checklist-card__footer">
        {onOpen ? (
          <button className="checklist-card__action" type="button" onClick={onOpen}>
            {checklist.period
              ? checklist.period === "month"
                ? "Open monthly register"
                : "Open daily log"
              : "Open daily checklist"}
            <Icon name="arrow" size={13} />
          </button>
        ) : (
          <>
            <span className="checklist-card__standard">
              <Icon name="check" size={13} />
              Hamsun standard
            </span>
            <span className="checklist-card__index">{checklist.index}</span>
          </>
        )}
      </div>
    </article>
  );
}

function Home({ onSelect, visibleBranches, profile }) {
  const isAdmin = profile?.role === "admin";
  const branchCount = visibleBranches.length;
  const totalLogs = branchCount * checklists.length;
  const dailyLogs = branchCount * 3;

  return (
    <main className="workspace">
      <div className="page-heading">
        <div>
          <p className="page-kicker">Operations overview</p>
          <h1>{isAdmin ? "Housekeeping Dashboard" : "My Branch Dashboard"}</h1>
          <p className="page-description">
            {isAdmin
              ? "Monitor branch workspaces and access daily housekeeping checklists from one central portal."
              : `Signed in as the ${profile?.branch_code} supervisor. You can access the ${profile?.branch_code} branch workspace and its daily checklists.`}
          </p>
        </div>
        <div className="page-heading__aside">
          <span className="live-badge">
            <i />
            {branchCount} {branchCount === 1 ? "branch" : "branches"} active
          </span>
        </div>
      </div>

      <section className="stats-grid" aria-label="Housekeeping overview">
        <StatCard
          icon="building"
          tone="green"
          label="Branches"
          value={String(branchCount).padStart(2, "0")}
          meta={isAdmin ? "All operational" : "Assigned to you"}
        />
        <StatCard
          icon="layers"
          tone="blue"
          label="Checklist types"
          value={String(checklists.length).padStart(2, "0")}
          meta="Standard templates"
        />
        <StatCard
          icon="clipboard"
          tone="amber"
          label="Total branch logs"
          value={String(totalLogs).padStart(2, "0")}
          meta={`${branchCount} ${branchCount === 1 ? "branch" : "branches"} × ${checklists.length} logs`}
        />
        <StatCard
          icon="calendar"
          tone="violet"
          label="Daily logs"
          value={String(dailyLogs).padStart(2, "0")}
          meta="3 daily logs per branch"
        />
      </section>

      <section className="panel" id="branches" aria-labelledby="branches-title">
        <div className="panel-heading">
          <div>
            <h2 id="branches-title">
              {isAdmin ? "Branches" : "Your branch"}
            </h2>
            <p>Select a branch to open its housekeeping workspace.</p>
          </div>
          <span className="panel-meta">
            {branchCount} {branchCount === 1 ? "branch" : "branches"}
          </span>
        </div>

        <div className="branch-grid">
          {visibleBranches.map((branch) => (
            <BranchCard
              key={branch.code}
              branch={branch}
              onSelect={onSelect}
            />
          ))}
        </div>
      </section>

      <div className="dashboard-grid">
        <section
          className="panel template-panel"
          aria-labelledby="templates-title"
        >
          <div className="panel-heading">
            <div>
              <h2 id="templates-title">Standard checklists</h2>
              <p>Checklist templates available in every branch.</p>
            </div>
            <span className="panel-meta">4 templates</span>
          </div>

          <div className="template-list">
            {checklists.map((checklist) => (
              <div className="template-row" key={checklist.index}>
                <span className="template-row__icon">
                  <Icon name={checklist.icon} size={18} />
                </span>
                <span className="template-row__body">
                  <strong>{checklist.title}</strong>
                  <small>{checklist.description}</small>
                </span>
                <span className="tag">{checklist.tag}</span>
              </div>
            ))}
          </div>
        </section>

        <section
          className="panel coverage-panel"
          aria-labelledby="coverage-title"
        >
          <div className="panel-heading">
            <div>
              <h2 id="coverage-title">Checklist coverage</h2>
              <p>Logs available by branch.</p>
            </div>
          </div>

          <div className="coverage-list">
            {visibleBranches.map((branch) => (
              <div className="coverage-row" key={branch.code}>
                <span
                  className={`coverage-row__code coverage-row__code--${branch.tone}`}
                >
                  {branch.code}
                </span>
                <span className="coverage-row__bar">
                  <i />
                </span>
                <span className="coverage-row__value">4 / 4</span>
              </div>
            ))}
          </div>

          <div className="coverage-note">
            <Icon name="check" size={14} />
            All assigned branches have the full checklist set.
          </div>
        </section>
      </div>

      <footer className="workspace-footer">
        <span>Hamsun Log Book</span>
        <span>Internal operations portal</span>
      </footer>
    </main>
  );
}

function BranchView({
  branch,
  visibleBranches,
  onBack,
  onSwitch,
  onOpenInspection,
  onOpenPublicArea,
  onOpenRoomBoy,
  onOpenLinen,
  onOpenFnbLog,
  onOpenBreakfast,
  profile,
}) {
  const rooms = roomLists[branch.code] ?? [];
  const isSweeper = profile?.role === "sweeper";
  const isRoomBoy = profile?.role === "room_boy";
  const isFnb = profile?.role === "fnb_manager";
  const isSuperadmin = profile?.role === "superadmin";
  const isTrayCollector = profile?.role === "tray_collector";
  const isKitchenIncharge = profile?.role === "kitchen_incharge";
  const isDispatcher = profile?.role === "dispatcher";
  const canManageBreakfast =
    isFnb || isSuperadmin || isTrayCollector || isKitchenIncharge || isDispatcher;
  const visibleChecklists = isDispatcher
    ? []
    : isSweeper
      ? checklists.filter((c) => c.id === "public")
      : isRoomBoy
        ? checklists.filter((c) => c.id === "roomboy")
        : getChecklistsForProfile(profile);
  const isFnbChecklist = (id) => fnbChecklistIds.has(id);

  return (
    <main className={`workspace workspace--${branch.tone}`}>
      <div className="branch-page-heading">
        <button className="back-link" type="button" onClick={onBack}>
          <Icon name="arrowLeft" size={15} />
          Back to overview
        </button>

        <div className="branch-page-heading__row">
          <div className="branch-title">
            <span className="branch-title__badge">{branch.code}</span>
            <div>
              <p className="page-kicker">Branch workspace</p>
              <h1>{branch.code} Branch</h1>
            </div>
          </div>
          <span className="live-badge">
            <i />
            Active branch
          </span>
        </div>

        <p className="page-description">
          {isSweeper
            ? "Complete the public area cleaning sheet for your branch."
            : isDispatcher
              ? "Open the breakfast log to see today's orders and get an alert when a new order arrives."
              : isFnb
                ? "Access the Food & Beverages logs for this branch. Each branch keeps its own FnB records."
                : isSuperadmin
                  ? "Access every housekeeping and Food & Beverages log for this branch."
                  : "Access the housekeeping logs for this branch. Select the checklist you need to view or complete."}
        </p>
      </div>

      <section className="branch-stats" aria-label="Branch checklist summary">
        <div>
          <span>Checklist templates</span>
          <strong>{String(visibleChecklists.length).padStart(2, "0")}</strong>
        </div>
        <div>
          <span>Daily logs</span>
          <strong>{String(visibleChecklists.length).padStart(2, "0")}</strong>
        </div>
        <div>
          <span>Scheduled logs</span>
          <strong>01</strong>
        </div>
      </section>

      {visibleBranches.length > 1 ? (
        <div className="branch-switcher" aria-label="Switch branch">
          <span>Switch branch</span>
          <div>
            {visibleBranches.map((item) => (
              <button
                key={item.code}
                type="button"
                className={`branch-pill branch-pill--${item.tone} ${
                  item.code === branch.code ? "is-active" : ""
                }`}
                onClick={() => onSwitch(item)}
                aria-current={item.code === branch.code ? "page" : undefined}
              >
                {item.code}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="branch-layout">
        <section
          className="panel checklist-panel"
          aria-labelledby="checklist-title"
        >
          <div className="panel-heading">
            <div>
              <h2 id="checklist-title">
                {isFnb
                  ? "Food & Beverages logs"
                  : isDispatcher
                    ? "Breakfast log"
                    : isSuperadmin
                      ? "All checklists and logs"
                      : "Housekeeping checklists"}
              </h2>
              <p>
                {isFnb
                  ? `FnB registers and daily logs for ${branch.code}.`
                  : isDispatcher
                    ? `Today's breakfast orders for ${branch.code}.`
                    : `Daily operations and cleaning schedules for ${branch.code}.`}
              </p>
            </div>
            <span className="panel-meta">
              {visibleChecklists.length} log{visibleChecklists.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="checklist-grid">
            {visibleChecklists.map((checklist) => (
              <ChecklistCard
                key={checklist.id}
                checklist={checklist}
                branch={branch}
                onOpen={
                  checklist.id === "inspection"
                    ? () => onOpenInspection(branch)
                    : checklist.id === "public"
                      ? () => onOpenPublicArea(branch)
                      : checklist.id === "roomboy"
                        ? () => onOpenRoomBoy(branch)
                        : checklist.id === "linen"
                          ? () => onOpenLinen(branch)
                          : isFnbChecklist(checklist.id)
                          ? () => onOpenFnbLog(branch, checklist)
                          : undefined
                }
              />
            ))}
            {canManageBreakfast && (
              <ChecklistCard
                key="breakfast"
                checklist={{
                  id: "breakfast",
                  title: "Breakfast Orders",
                  description:
                    "Room breakfast orders sorted by earliest time. Mark items verified, sent and trays collected.",
                  icon: "utensils",
                  tag: "Daily",
                  index: "06",
                  period: "day",
                }}
                branch={branch}
                onOpen={() => onOpenBreakfast(branch)}
              />
            )}
          </div>
        </section>

        <aside className="panel branch-details" aria-labelledby="details-title">
          <div className="panel-heading">
            <div>
              <h2 id="details-title">Branch details</h2>
              <p>Workspace information.</p>
            </div>
          </div>

          <dl className="detail-list">
            <div>
              <dt>Branch code</dt>
              <dd>{branch.code}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className="status-badge status-badge--inline">
                  <i />
                  Active
                </span>
              </dd>
            </div>
            <div>
              <dt>Checklist templates</dt>
              <dd>{String(visibleChecklists.length).padStart(2, "0")}</dd>
            </div>
            <div>
              <dt>Rooms on list</dt>
              <dd>{String(rooms.length).padStart(2, "0")}</dd>
            </div>
            <div>
              <dt>Room list</dt>
              <dd className="detail-list__text">
                {roomListSources[branch.code] ?? "Standard room list"}
              </dd>
            </div>
          </dl>

          <div className="detail-note">
            <Icon name="check" size={14} />
            {isSweeper
              ? "You can mark public areas as cleaned for your assigned shift."
              : isRoomBoy
                ? "You can view and update your assigned room cleaning tasks."
                : isDispatcher
                  ? "Open the breakfast log for your branch. You will hear a bell when a new order arrives."
                  : isFnb
                    ? "All Food & Beverages logs are available for this branch."
                    : "All housekeeping checklists are available for this branch."}
          </div>
        </aside>
      </div>

      <footer className="workspace-footer">
        <span>Hamsun Log Book</span>
        <span>{branch.code} Branch · Internal operations portal</span>
      </footer>
    </main>
  );
}

function InspectionDrawer({ room, branch, date, record, profile, onClose, onSave }) {
  const isPmsBranch = pmsBranchCodes.includes(branch.code);
  const inspectorRole =
    record?.inspected_role === "branch_manager" ||
    profile?.role === "branch_manager"
      ? "branch_manager"
      : "supervisor";
  const inspectorSignature =
    inspectorRole === "branch_manager"
      ? getBranchManagerSignature(branch.code, record?.inspected_by ?? "")
      : getBranchSupervisorSignature(branch.code, record?.inspected_by ?? "");
  const [draft, setDraft] = useState(() => ({
    occupancy: record?.occupancy ?? "",
    checkIn: record?.checkIn ?? "",
    checkOut: record?.checkOut ?? "",
    items: { ...(record?.items ?? {}) },
    remarks: record?.remarks ?? "",
    rating: record?.supervisor_rating ?? "",
  }));
  const [error, setError] = useState("");

  const answered = inspectionItems.filter((item) => draft.items[item.id]).length;
  const issueCount = Object.values(draft.items).filter(
    (value) => value === "issue",
  ).length;

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const setItem = (itemId, value) => {
    setDraft((previous) => ({
      ...previous,
      items: { ...previous.items, [itemId]: value },
    }));
    setError("");
  };

  const markAllPass = () => {
    setDraft((previous) => ({
      ...previous,
      items: Object.fromEntries(
        inspectionItems.map((item) => [item.id, "pass"]),
      ),
    }));
    setError("");
  };

  const handleSave = () => {
    if (answered < inspectionItems.length) {
      setError(
        `Complete all ${inspectionItems.length} checklist items before saving. ${answered} of ${inspectionItems.length} done.`,
      );
      return;
    }

    onSave(room, { ...draft, date });
  };

  return (
    <div className="drawer-layer">
      <button
        className="drawer-overlay"
        type="button"
        aria-label="Close inspection"
        onClick={onClose}
      />
      <aside
        className="inspection-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspection-drawer-title"
      >
        <header className="drawer-header">
          <div>
            <span className="drawer-kicker">
              {branch.code} Branch · Room inspection
            </span>
            <h2 id="inspection-drawer-title">Room {room}</h2>
            <p>{record?.savedAt || record?.inspected_at ? "Review and update the saved inspection." : "Complete the room inspection below."}</p>
          </div>
          <button
            className="drawer-close"
            type="button"
            aria-label="Close inspection"
            onClick={onClose}
          >
            <Icon name="close" size={19} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="drawer-section">
            <div className="drawer-section__heading">
              <h3>Room details</h3>
              <span>{getFloor(room)} floor</span>
            </div>

            <div className="drawer-room-state">
              <span>Occupancy</span>
              <span
                className={`occupancy-badge occupancy-badge--${
                  draft.occupancy || "unset"
                }`}
              >
                <i />
                {draft.occupancy === "occupied"
                  ? "Occupied"
                  : draft.occupancy === "vacant"
                    ? "Vacant"
                    : "Not synced"}
              </span>
              <small>
                {pmsBranchCodes.includes(branch.code)
                  ? "Synced from Hamsun PMS"
                  : "This branch is not linked to PMS"}
              </small>
            </div>

            <div className="drawer-fields">
              <label>
                <span>Check in</span>
                {isPmsBranch ? (
                  <span className="date-value">
                    {formatLongDate(draft.checkIn)}
                  </span>
                ) : (
                  <input
                    type="date"
                    value={draft.checkIn}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        checkIn: event.target.value,
                      }))
                    }
                  />
                )}
              </label>
              <label>
                <span>Check out</span>
                {isPmsBranch ? (
                  <span className="date-value">
                    {formatLongDate(draft.checkOut)}
                  </span>
                ) : (
                  <input
                    type="date"
                    value={draft.checkOut}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        checkOut: event.target.value,
                      }))
                    }
                  />
                )}
              </label>
            </div>
          </section>

          {inspectionSections.map((section) => {
            const sectionDone = section.items.filter(
              (item) => draft.items[item.id],
            ).length;

            return (
              <section className="drawer-section" key={section.title}>
                <div className="drawer-section__heading">
                  <h3>{section.title}</h3>
                  <span>
                    {sectionDone}/{section.items.length}
                  </span>
                </div>

                <div className="inspection-items">
                  {section.items.map((item) => (
                    <div className="inspection-item" key={item.id}>
                      <span>{item.label}</span>
                      <div
                        className="status-toggle"
                        role="group"
                        aria-label={item.label}
                      >
                        {itemStatuses.map((status) => (
                          <button
                            key={status.value}
                            type="button"
                            className={`status-toggle__button status-toggle__button--${status.value} ${
                              draft.items[item.id] === status.value
                                ? "is-active"
                                : ""
                            }`}
                            onClick={() => setItem(item.id, status.value)}
                            aria-pressed={draft.items[item.id] === status.value}
                          >
                            {status.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          <section className="drawer-section">
            <div className="drawer-section__heading">
              <h3>Supervisor remarks</h3>
              {issueCount > 0 ? (
                <span className="drawer-issue-count">
                  {issueCount} issue{issueCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            <textarea
              className="remarks-field"
              rows="3"
              placeholder="Add notes about the room, issues found or follow-up required..."
              value={draft.remarks}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  remarks: event.target.value,
                }))
              }
            />
            <label className="supervisor-field">
              <span>
                {inspectorRole === "branch_manager"
                  ? "Branch manager sign"
                  : "Supervisor sign"}
              </span>
              <input type="text" value={inspectorSignature} readOnly />
            </label>
          </section>

          <section className="drawer-section">
            <div className="drawer-section__heading">
              <h3>Room Boy Rating</h3>
              <span>Rate the room boy's cleaning quality for this room.</span>
            </div>
            <div className="rating-options">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={`rating-star ${draft.rating === String(star) ? "is-active" : ""}`}
                  onClick={() =>
                    setDraft((previous) => ({ ...previous, rating: String(star) }))
                  }
                  aria-label={`Rate ${star} star${star === 1 ? "" : "s"}`}
                >
                  {star}
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="drawer-footer">
          {error ? <p className="form-error">{error}</p> : null}
          <div className="drawer-footer__actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={markAllPass}
            >
              Mark all pass
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={handleSave}
            >
              Save inspection
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function ManagerInspectionDrawer({
  room,
  branch,
  date,
  record,
  onClose,
  onSave,
}) {
  const [status, setStatus] = useState(
    () => record?.manager_status ?? "verified",
  );
  const [rating, setRating] = useState(() =>
    record?.manager_rating ? String(record.manager_rating) : "",
  );
  const [notes, setNotes] = useState(() => record?.manager_notes ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave({
        managerStatus: status,
        rating: rating ? Number(rating) : null,
        notes: notes.trim(),
      });
    } catch (err) {
      setError(err?.message || "Could not save the manager check.");
      setBusy(false);
    }
  };

  return (
    <div className="drawer-layer">
      <button
        className="drawer-overlay"
        type="button"
        aria-label="Close manager check"
        onClick={onClose}
      />
      <aside
        className="inspection-drawer manager-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manager-drawer-title"
      >
        <header className="drawer-header">
          <div>
            <span className="drawer-kicker">
              {branch.code} Branch · Manager cross-check
            </span>
            <h2 id="manager-drawer-title">Room {room}</h2>
            <p>
              Cross-check the supervisor's inspection at any time. This does not
              change the room's cleaning status.
            </p>
          </div>
          <button
            className="drawer-close"
            type="button"
            aria-label="Close manager check"
            onClick={onClose}
          >
            <Icon name="close" size={19} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="drawer-section">
            <div className="drawer-section__heading">
              <h3>Supervisor inspection</h3>
              <span>{formatDisplayDate(date)}</span>
            </div>
            <div className="manager-summary">
              <div>
                <span>Room boy</span>
                <strong>{record?.assigned_to || "Unassigned"}</strong>
              </div>
              <div>
                <span>Inspected by</span>
                <strong>{record?.inspected_by || "Not inspected yet"}</strong>
              </div>
              <div>
                <span>Inspected at</span>
                <strong>{formatClock(record?.inspected_at)}</strong>
              </div>
              <div>
                <span>Supervisor rating</span>
                <strong>
                  {record?.supervisor_rating
                    ? `${record.supervisor_rating}★`
                    : "Not rated"}
                </strong>
              </div>
            </div>
            {record?.supervisor_notes ? (
              <p className="manager-summary__notes">
                “{record.supervisor_notes}”
              </p>
            ) : null}
          </section>

          <section className="drawer-section">
            <div className="drawer-section__heading">
              <h3>Manager result</h3>
              <span>Rate the supervisor's work.</span>
            </div>
            <label className="supervisor-field">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setError("");
                }}
              >
                <option value="verified">Verified</option>
                <option value="issue">Issue found</option>
                <option value="redo">Re-clean needed</option>
              </select>
            </label>

            <div className="rating-options manager-rating-options">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={`rating-star ${rating === String(star) ? "is-active" : ""}`}
                  onClick={() => {
                    setRating(rating === String(star) ? "" : String(star));
                    setError("");
                  }}
                  aria-label={`Rate the supervisor ${star} star${star === 1 ? "" : "s"}`}
                >
                  {star}
                </button>
              ))}
              <span className="manager-rating-caption">
                {rating ? `${rating} / 5 for the supervisor` : "No rating"}
              </span>
            </div>

            <textarea
              className="remarks-field"
              rows="3"
              placeholder="Add notes for the supervisor or the next shift..."
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                setError("");
              }}
            />
            <label className="supervisor-field">
              <span>Manager sign</span>
              <input type="text" value={MANAGER_SIGNATURE} readOnly />
            </label>
          </section>
        </div>

        <footer className="drawer-footer">
          {error ? <p className="form-error">{error}</p> : null}
          <div className="drawer-footer__actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={handleSave}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save manager check"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function InspectionPage({ branch, date, onBack, onDateChange, profile }) {
  const staticRooms = roomLists[branch.code] ?? [];
  const isPmsBranch = pmsBranchCodes.includes(branch.code);
  const [pmsRooms, setPmsRooms] = useState([]);
  const rooms = isPmsBranch && pmsRooms.length > 0 ? pmsRooms : staticRooms;
  const canManagerInspect =
    profile?.role === "superadmin" ||
    (profile?.role === "admin" && profile?.department === "housekeeping");
  const [daily, setDaily] = useState(() => loadDaily(branch.code, date));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [pms, setPms] = useState(() => ({
    status: isPmsBranch ? "loading" : "unlinked",
    error: "",
    fetchedAt: null,
    occupied: 0,
    vacant: rooms.length,
    total: rooms.length,
  }));
  const [roomBoys, setRoomBoys] = useState([]);
  const [roomBoysLoading, setRoomBoysLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRoomBoysLoading(true);
    listRoomBoys(branch.code)
      .then((boys) => {
        if (!cancelled) {
          setRoomBoys(boys);
          setRoomBoysLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setRoomBoysLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branch.code]);

  const dailyRef = useRef(daily);
  useEffect(() => {
    dailyRef.current = daily;
  }, [daily]);

  const applySnapshot = async (snapshot) => {
    reconcileStayRemarks(branch.code, snapshot.rooms);

    // The PMS is the source of truth for the room list, so newly added rooms
    // appear without a code change.
    setPmsRooms(snapshot.rooms.map((room) => room.number));

    // Compare against the last snapshot this device stored so we can tell a real
    // PMS transition (checked-in -> checked-out) from the first sync.
    const previousRooms = dailyRef.current.rooms ?? {};
    const statusChanges = [];
    const checkoutAlerts = [];

    snapshot.rooms.forEach((room) => {
      const existing = previousRooms[room.number] ?? {};
      const previousStatus = existing.pmsStatus ?? "";
      const previousCheckin = existing.pmsCheckinStatus ?? "";
      const newStatus = room.pmsStatus ?? "";
      if (!newStatus || newStatus === previousStatus) return;

      statusChanges.push({ room, newStatus });
      if (
        newStatus === "checked_out" &&
        ["checked_in", "pending", "confirmed"].includes(previousStatus) &&
        previousCheckin &&
        previousCheckin !== "CHECKED_OUT"
      ) {
        checkoutAlerts.push(room);
      }
    });

    setDaily((previous) => {
      const nextRooms = { ...previous.rooms };

      snapshot.rooms.forEach((room) => {
        const existing = nextRooms[room.number] ?? {};
        const nextRecord = {
          ...existing,
          occupancy: room.occupancy,
          checkIn: room.checkIn,
          checkOut: room.checkOut,
          pmsGuest: room.guest,
          pmsBookingId: room.bookingId ?? "",
          pmsSyncedAt: snapshot.fetchedAt,
          pmsStatus: room.pmsStatus ?? "",
          pmsCheckinStatus: room.checkinStatus ?? "",
          upcomingCheckIn: room.upcomingCheckIn ?? "",
          upcomingGuest: room.upcomingGuest ?? "",
        };
        nextRecord.remarks = getRoomRemarks(
          branch.code,
          room.number,
          nextRecord,
        );
        nextRooms[room.number] = nextRecord;
      });

      const next = { ...previous, rooms: nextRooms };
      saveDaily(branch.code, date, next);
      dailyRef.current = next;
      return next;
    });

    // Record PMS status events when a room's status changes.
    statusChanges.forEach(({ room, newStatus }) => {
      recordPmsStatusEvent({
        branchCode: branch.code,
        roomNumber: room.number,
        bookingId: room.bookingId ?? "",
        checkIn: room.checkIn ?? "",
        checkOut: room.checkOut ?? "",
        status: room.bookingStatus ?? "",
        checkinStatus: room.checkinStatus ?? "",
        guestName: room.guest ?? "",
        eventType: newStatus,
      }).catch(() => {
        // Status events are best-effort; the UI still works without them.
      });
    });

    // A checkout was detected on this device. Fan the alert out to the branch
    // housekeeping team; the RPC deduplicates across open devices.
    checkoutAlerts.forEach((room) => {
      const reference = `checkout:${branch.code}:${
        room.bookingId || room.number
      }:${room.checkOut || date}`;

      notifyRoomCheckout({
        branchCode: branch.code,
        roomNumber: room.number,
        bookingId: room.bookingId,
        guestName: room.guest,
        reference,
      }).catch(() => {
        // If the shared alert cannot be saved, at least ring this device.
        sendCheckoutNotification({
          branchCode: branch.code,
          roomNumber: room.number,
          guestName: room.guest,
        });
      });
    });
  };

  const reportSnapshot = (snapshot) => {
    const occupied = snapshot.rooms.filter(
      (room) => room.occupancy === "occupied",
    ).length;

    setPms({
      status: "ready",
      error: "",
      fetchedAt: snapshot.fetchedAt,
      occupied,
      vacant: snapshot.rooms.length - occupied,
      total: snapshot.rooms.length,
    });
  };

  const syncPms = async ({ silent = false } = {}) => {
    if (!isPmsBranch) return;

    if (!silent) {
      setPms((previous) => ({ ...previous, status: "loading", error: "" }));
    }

    try {
      // A manual sync also refreshes the cached PMS room catalog so rooms
      // added in PMS show up immediately.
      const snapshot = await fetchBranchSnapshot(branch.code, date, {
        forceCatalog: !silent,
      });
      applySnapshot(snapshot);
      reportSnapshot(snapshot);
    } catch (error) {
      setPms((previous) => ({
        ...previous,
        status: "error",
        error: error?.message || "Could not reach Hamsun PMS.",
      }));
    }
  };

  // Poll PMS while the inspection page is open so checkouts are noticed even if
  // nobody presses Sync. Keeps working when the tab is in the background.
  const syncPmsRef = useRef(syncPms);
  syncPmsRef.current = syncPms;

  useEffect(() => {
    if (!isPmsBranch) return undefined;

    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await syncPmsRef.current({ silent: true });
      } finally {
        running = false;
      }
    };

    const timer = setInterval(tick, 60000);
    const handleFocus = () => tick();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isPmsBranch, branch.code, date]);

  useEffect(() => {
    const loaded = loadDaily(branch.code, date);
    migrateDailyRemarks(branch.code, loaded);
    dailyRef.current = loaded;
    setDaily(loaded);
    setSearch("");
    setFilter("all");
    setSelectedRoom(null);

    if (!isPmsBranch) {
      setPms({
        status: "unlinked",
        error: "",
        fetchedAt: null,
        occupied: 0,
        vacant: rooms.length,
        total: rooms.length,
      });
      return undefined;
    }

    let cancelled = false;
    setPms((previous) => ({ ...previous, status: "loading", error: "" }));

    fetchBranchSnapshot(branch.code, date)
      .then((snapshot) => {
        if (cancelled) return;
        applySnapshot(snapshot);
        reportSnapshot(snapshot);
      })
      .catch((error) => {
        if (cancelled) return;
        setPms((previous) => ({
          ...previous,
          status: "error",
          error: error?.message || "Could not reach Hamsun PMS.",
        }));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.code, date]);

  const [boyEntries, setBoyEntries] = useState({});
  const [boyEntriesLoading, setBoyEntriesLoading] = useState(true);
  const [remarkOptions, setRemarkOptions] = useState([]);
  const [assignDraft, setAssignDraft] = useState({});
  const [assignBusy, setAssignBusy] = useState({});
  const [managerRoom, setManagerRoom] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listRoomRemarkOptions()
      .then((options) => {
        if (!cancelled) setRemarkOptions(options);
      })
      .catch(() => {
        if (!cancelled) setRemarkOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBoyEntriesLoading(true);

    const refresh = async () => {
      try {
        const { entries } = await listRoomBoyReport(branch.code, date);
        if (cancelled) return;
        const map = {};
        entries.forEach((e) => {
          map[e.room_no] = e;
        });
        setBoyEntries(map);
        setBoyEntriesLoading(false);
      } catch {
        if (!cancelled) setBoyEntriesLoading(false);
      }
    };

    refresh();

    const unsubscribe = subscribeToRoomBoyReport(branch.code, date, refresh);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [branch.code, date]);

  // A room only reads "Complete" after the supervisor has saved an inspection.
  // Room boy status drives the lifecycle until that sign-off exists.
  const getRoomStatus = (room) => {
    const entry = boyEntries[room] ?? {};
    const record = daily.rooms[room] ?? {};
    const boyStatus = entry.boy_status ?? "";

    if (boyStatus === "progress") return "progress";
    if (boyStatus === "awaiting_inspection" || boyStatus === "done") {
      return "awaiting";
    }
    if (boyStatus === "completed") {
      // The supervisor's sign-off is saved in the cloud, so every device
      // (including admin and superadmin) must read the room as complete.
      // Only this device knows whether the local checklist flagged an issue.
      return getRecordStatus(record) === "issue" ? "issue" : "complete";
    }
    if (record.savedAt) return getRecordStatus(record);
    return "pending";
  };

  // Once the supervisor signs off, the assigned room boys are locked until a
  // supervisor explicitly reassigns the room (which clears the inspection).
  const isAssignmentLocked = (room) => {
    const entry = boyEntries[room] ?? {};
    return entry.boy_status === "completed" || Boolean(entry.inspected_at);
  };

  // A room can have one primary room boy plus any number of partners. The
  // draft wins while the supervisor is choosing names.
  const getAssignedBoys = (room) => {
    const draft = assignDraft[room];
    if (Array.isArray(draft?.boys)) return draft.boys;
    const entry = boyEntries[room] ?? {};
    return [entry.assigned_to, ...(entry.assigned_partners ?? [])].filter(
      Boolean,
    );
  };

  const toggleAssignBoy = (room, name) => {
    if (isAssignmentLocked(room)) return;
    const current = getAssignedBoys(room);
    const next = current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name];
    setAssignDraft((previous) => ({
      ...previous,
      [room]: { ...(previous[room] ?? {}), boys: next },
    }));
  };
  const commit = (updater) => {
    setDaily((previous) => {
      const next =
        typeof updater === "function" ? updater(previous) : updater;
      saveDaily(branch.code, date, next);
      return next;
    });
  };

  const updateRoom = (room, changes) => {
    commit((previous) => ({
      ...previous,
      rooms: {
        ...previous.rooms,
        [room]: {
          ...(previous.rooms[room] ?? {}),
          ...changes,
        },
      },
      updatedAt: new Date().toISOString(),
    }));
  };

  const saveInspection = (room, draft) => {
    const roomEntry = boyEntries[room] ?? {};
    if (roomEntry.status === "O/C" && !roomEntry.guest_presence) {
      alert("Select Guest Presence (Yes or No) before inspecting this room.");
      return;
    }
    const existing = daily.rooms[room] ?? {};
    const stored = getStayRemark(branch.code, room);
    const occupied = existing.occupancy === "occupied";
    const checkIn = occupied
      ? existing.checkIn || draft.checkIn || ""
      : stored?.checkIn ?? existing.checkIn ?? draft.checkIn ?? "";
    const bookingId = occupied
      ? existing.pmsBookingId ?? stored?.bookingId ?? ""
      : stored?.bookingId ?? existing.pmsBookingId ?? "";

    setStayRemark(branch.code, room, {
      bookingId,
      checkIn,
      remarks: draft.remarks ?? "",
      updatedAt: new Date().toISOString(),
    });

    updateRoom(room, {
      ...draft,
      remarksStay: checkIn,
      savedAt: new Date().toISOString(),
    });

    // A branch manager inspection counts as the supervisor sign-off. The
    // signature directory keeps the printed name fixed per branch.
    const inspectorRole =
      profile?.role === "branch_manager" ? "branch_manager" : "supervisor";
    const inspectorName =
      inspectorRole === "branch_manager"
        ? getBranchManagerSignature(
            branch.code,
            profile?.full_name ?? "Branch Manager",
          )
        : getBranchSupervisorSignature(
            branch.code,
            profile?.full_name ?? "Supervisor",
          );
    const inspectedAt = new Date().toISOString();
    const entry = boyEntries[room] ?? {};
    const roomBoyName = entry.assigned_to || inspectorName;
    const timeIn = entry.time_in ?? "";
    const timeOut = entry.time_out ?? "";
    const inspectedClock = new Date().toTimeString().slice(0, 5);

    // Supervisor/branch manager sign-off is the only path to "Completed". Save
    // it even when no rating was chosen so the room can leave "awaiting
    // inspection".
    saveRoomBoyInspection(
      branch.code,
      draft.date,
      room,
      inspectorName,
      inspectorRole,
    )
      .then(() => {
        setBoyEntries((previous) => ({
          ...previous,
          [room]: {
            ...(previous[room] ?? {}),
            boy_status: "completed",
            inspected_by: inspectorName,
            inspected_at: inspectedAt,
            inspected_role: inspectorRole,
          },
        }));

        if (draft.rating) {
          saveRoomBoyRating(
            branch.code,
            draft.date,
            room,
            draft.rating,
            draft.remarks ?? null,
          ).catch(() => {});

          createRoomBoyNotification({
            branchCode: branch.code,
            roomNumber: room,
            roomBoyName,
            notificationType: "rating_received",
            supervisorName: inspectorName,
            rating: draft.rating,
            ratingNotes: draft.remarks ?? null,
          }).catch(() => {});
        }
      })
      .catch(() => {
        // The checklist still saves locally; the next save retries the sign-off.
      });

    // Notify Slack when supervisor completes a room inspection (single message).
    // Skip when guest was present (handled on room-boy time-out instead).
    const guestPresence = boyEntries[room]?.guest_presence ?? null;
    if (guestPresence !== "yes") {
      slackNotifyRoomInspected({
        branchCode: branch.code,
        roomNumber: room,
        roomBoyName,
        timeIn,
        timeOut,
        inspectorName,
        inspectedAt: inspectedClock,
        status: draft.items ? (Object.values(draft.items).includes("issue") ? "issue" : "complete") : "complete",
        rating: draft.rating,
        date: draft.date ?? date,
        guestPresence,
        roomStatus: boyEntries[room]?.status ?? null,
      }).catch(() => {});
    }

    setSelectedRoom(null);
  };

  const assignRoom = async (room) => {
    if (isAssignmentLocked(room)) {
      alert(
        "This room is locked after inspection. Use Reassign to unlock it and inspect the room again.",
      );
      return;
    }

    const draft = assignDraft[room] ?? {};
    const boys = getAssignedBoys(room);
    const primary = boys[0] ?? "";
    const partners = boys.slice(1);
    const remarks =
      draft.remarks ?? boyEntries[room]?.assignment_remarks ?? "";

    if (!primary) {
      alert("Choose at least one room boy before assigning the room.");
      return;
    }

    if (boyEntries[room]?.status === "O/C" && !boyEntries[room]?.guest_presence) {
      alert(
        "Select Guest Presence (Yes or No) before assigning this room.",
      );
      return;
    }

    setAssignBusy((previous) => ({ ...previous, [room]: true }));
    const record = daily.rooms[room] ?? {};
    const checkOutDate = String(record.checkOut || record.check_out || "").trim();
    try {
      await saveRoomBoyEntryFull(branch.code, date, room, {
        assigned_to: primary,
        assigned_partners: partners,
        assignment_remarks: remarks || null,
        // A new assignment always starts unacknowledged; the room boy page
        // keeps alerting when a remark is present until they acknowledge it.
        assignment_acknowledged_at: null,
      });

      // Propagate the assignment to the room's actual checkout date so the
      // room boy sees it in that day's task list even when the checkout
      // happens days after the assignment is made.
      if (checkOutDate && checkOutDate !== date) {
        await saveRoomBoyEntryFull(branch.code, checkOutDate, room, {
          assigned_to: primary,
          assigned_partners: partners,
          assignment_remarks: remarks || null,
          assignment_acknowledged_at: null,
        }).catch(() => {});
      }

      setBoyEntries((previous) => ({
        ...previous,
        [room]: {
          ...(previous[room] ?? {}),
          assigned_to: primary,
          assigned_partners: partners,
          assignment_remarks: remarks || null,
          assignment_acknowledged_at: null,
        },
      }));
      setAssignDraft((previous) => {
        const next = { ...previous };
        delete next[room];
        return next;
      });

      sendRoomAssignmentNotification({
        branchCode: branch.code,
        roomNumber: room,
        roomBoyName: primary,
        assignedBy: profile?.full_name ?? "Supervisor",
      });
      // Every selected room boy (primary and partners) gets their own
      // notification and push.
      boys.forEach((name) => {
        createRoomBoyNotification({
          branchCode: branch.code,
          roomNumber: room,
          roomBoyName: name,
          notificationType: "room_assigned",
          supervisorName: profile?.full_name ?? "Supervisor",
          remark: remarks || null,
        }).catch(() => {});
      });
    } catch (err) {
      console.error("Assign room boy failed:", err);
      alert("Failed to assign room boy: " + err.message);
    } finally {
      setAssignBusy((previous) => ({ ...previous, [room]: false }));
    }
  };

  // Reassigning an inspected room clears the saved inspection so the room must
  // be inspected again after the new room boys are chosen.
  const reassignRoom = async (room) => {
    if (!isAssignmentLocked(room)) return;

    const confirmed = window.confirm(
      `Reassign room ${room}? This clears the saved inspection. The room must be inspected again after you assign the new room boy.`,
    );
    if (!confirmed) return;

    setAssignBusy((previous) => ({ ...previous, [room]: true }));
    try {
      await resetRoomBoyInspection({
        branchCode: branch.code,
        date,
        roomNo: room,
      });

      // The assignment may also live on the room's checkout date.
      const record = daily.rooms[room] ?? {};
      const checkOutDate = String(
        record.checkOut || record.check_out || "",
      ).trim();
      if (checkOutDate && checkOutDate !== date) {
        await resetRoomBoyInspection({
          branchCode: branch.code,
          date: checkOutDate,
          roomNo: room,
        }).catch(() => {});
      }

      setBoyEntries((previous) => ({
        ...previous,
        [room]: {
          ...(previous[room] ?? {}),
          inspected_by: null,
          inspected_at: null,
          inspected_role: null,
          boy_status: "pending",
          supervisor_rating: null,
          supervisor_notes: null,
          manager_inspected_by: null,
          manager_inspected_at: null,
          manager_status: null,
          manager_rating: null,
          manager_notes: null,
        },
      }));

      // Clear this device's checklist so the room returns to "Pending" and a
      // fresh inspection is required.
      updateRoom(room, {
        items: {},
        remarks: "",
        savedAt: null,
        supervisor_rating: "",
      });
      setAssignDraft((previous) => {
        const next = { ...previous };
        delete next[room];
        return next;
      });
    } catch (err) {
      console.error("Reassign room failed:", err);
      alert("Failed to unlock the room: " + err.message);
    } finally {
      setAssignBusy((previous) => ({ ...previous, [room]: false }));
    }
  };

  const saveManagerCheck = async ({ managerStatus, rating, notes }) => {
    const room = managerRoom;
    if (!room) return;

    const managerName = MANAGER_SIGNATURE;
    const reference = `manager:${branch.code}:${date}:${room}:${Date.now()}`;
    const result = await saveManagerInspection({
      branchCode: branch.code,
      date,
      roomNo: room,
      managerName,
      managerStatus,
      rating,
      notes,
      reference,
    });

    setBoyEntries((previous) => ({
      ...previous,
      [room]: {
        ...(previous[room] ?? {}),
        manager_inspected_by: managerName,
        manager_inspected_at: result.inspectedAt,
        manager_status: managerStatus,
        manager_rating: rating ?? null,
        manager_notes: notes || null,
      },
    }));
    setManagerRoom(null);
  };

  const stats = useMemo(() => {
    const inspected = rooms.filter((room) => {
      const status = getRoomStatus(room);
      return status === "complete" || status === "issue";
    }).length;
    const issues = rooms.filter(
      (room) => getRoomStatus(room) === "issue",
    ).length;

    return {
      total: rooms.length,
      inspected,
      pending: rooms.length - inspected,
      issues,
      percent: rooms.length ? Math.round((inspected / rooms.length) * 100) : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boyEntries, daily.rooms, rooms]);

  const filterCounts = useMemo(() => {
    const counts = {
      all: rooms.length,
      pending: 0,
      progress: 0,
      awaiting: 0,
      complete: 0,
      issue: 0,
    };
    rooms.forEach((room) => {
      const status = getRoomStatus(room);
      if (counts[status] === undefined) counts[status] = 0;
      counts[status] += 1;
    });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boyEntries, daily.rooms, rooms]);

  const filteredRooms = useMemo(() => {
    const query = search.trim().toLowerCase();

    return rooms.filter((room) => {
      const status = getRoomStatus(room);
      const matchesFilter = filter === "all" || status === filter;
      const matchesSearch =
        !query ||
        room.toLowerCase().includes(query) ||
        getFloor(room).toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boyEntries, daily.rooms, filter, rooms, search]);

  const cleaningRows = useMemo(
    () =>
      rooms
        .map((room) => ({ room, entry: boyEntries[room] ?? {} }))
        .filter(({ entry }) =>
          ["progress", "awaiting_inspection", "done"].includes(
            entry.boy_status ?? "",
          ),
        )
        .sort((a, b) => {
          const aDone = ["awaiting_inspection", "done"].includes(
            a.entry.boy_status,
          );
          const bDone = ["awaiting_inspection", "done"].includes(
            b.entry.boy_status,
          );
          if (aDone !== bDone) return aDone ? 1 : -1;
          return a.room.localeCompare(b.room, undefined, { numeric: true });
        }),
    [boyEntries, rooms],
  );

  const activeRecord = selectedRoom
    ? {
        ...(daily.rooms[selectedRoom] ?? {}),
        remarks: getRoomRemarks(
          branch.code,
          selectedRoom,
          daily.rooms[selectedRoom] ?? {},
        ),
      }
    : null;

  const setSupervisor = (value) => {
    commit((previous) => ({
      ...previous,
      supervisor: value,
      updatedAt: new Date().toISOString(),
    }));
  };

  return (
    <main className={`workspace workspace--${branch.tone} inspection-page`}>
      <div className="inspection-heading">
        <button className="back-link" type="button" onClick={onBack}>
          <Icon name="arrowLeft" size={15} />
          Back to {branch.code} Branch
        </button>

        <div className="inspection-heading__row">
          <div className="branch-title">
            <span className="branch-title__badge">{branch.code}</span>
            <div>
              <p className="page-kicker">Daily inspection · {formatDisplayDate(date)}</p>
              <h1>Supervisor Daily Room Inspection Checklist</h1>
            </div>
          </div>

          <div className="inspection-heading__actions no-print">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => window.print()}
            >
              <Icon name="printer" size={15} />
              Print checklist
            </button>
          </div>
        </div>

        <p className="page-description">
          Complete one inspection per room. Each branch and date keeps its own
          saved checklist, so tomorrow starts with a fresh sheet.
        </p>

        <div className="print-summary">
          <span>Date: {formatDisplayDate(date)}</span>
          <span>Branch: {branch.code}</span>
          <span>Supervisor: {daily.supervisor || "________________"}</span>
        </div>
      </div>

      <div className="inspection-toolbar">
        <div className="date-control">
          <button
            className="date-control__arrow"
            type="button"
            aria-label="Previous day"
            onClick={() => onDateChange(shiftDate(date, -1))}
          >
            <Icon name="chevronLeft" size={17} />
          </button>
          <label className="date-control__input">
            <span className="sr-only">Inspection date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value) onDateChange(event.target.value);
              }}
            />
          </label>
          <button
            className="date-control__arrow"
            type="button"
            aria-label="Next day"
            onClick={() => onDateChange(shiftDate(date, 1))}
          >
            <Icon name="chevronRight" size={17} />
          </button>
          <button
            className="button button--ghost"
            type="button"
            onClick={() => onDateChange(getTodayISO())}
            disabled={date === getTodayISO()}
          >
            Today
          </button>
        </div>

        <span className="toolbar-divider" />

        <label className="supervisor-field">
          <span>Supervisor</span>
          <input
            type="text"
            value={daily.supervisor}
            placeholder="Enter name"
            onChange={(event) => setSupervisor(event.target.value)}
          />
        </label>

        <span className="autosave-status">
          <i />
          Saved in this browser
        </span>
      </div>

      {isPmsBranch ? (
        <div className={`pms-strip pms-strip--${pms.status}`}>
          <span className="pms-strip__status">
            <i />
            {pms.status === "loading"
              ? "Syncing with Hamsun PMS"
              : pms.status === "error"
                ? "PMS sync failed"
                : "Live from Hamsun PMS"}
          </span>

          <span className="pms-strip__detail">
            {pms.status === "error"
              ? pms.error
              : pms.status === "ready"
                ? `${pms.total} rooms · ${pms.occupied} occupied · ${pms.vacant} vacant · updated ${formatSyncTime(pms.fetchedAt)}`
                : "Reading the room list, occupancy and stay dates…"}
          </span>

          <button
            className="button button--ghost pms-strip__action no-print"
            type="button"
            onClick={syncPms}
            disabled={pms.status === "loading"}
          >
            <Icon name="refresh" size={14} />
            Sync PMS
          </button>
        </div>
      ) : (
        <div className="pms-strip pms-strip--unlinked">
          <span className="pms-strip__status">
            <i />
            Not linked to PMS
          </span>
          <span className="pms-strip__detail">
            {hasPmsConfig
              ? "NST has no PMS property yet. Rooms, occupancy and stay dates are maintained manually."
              : "PMS credentials are not configured, so this branch uses a manual room list."}
          </span>
        </div>
      )}

      <section className="stats-grid inspection-stats" aria-label="Inspection summary">
        <StatCard
          icon="building"
          tone="green"
          label="Rooms on list"
          value={String(stats.total).padStart(2, "0")}
          meta={roomListSources[branch.code] ?? "Branch room list"}
        />
        <StatCard
          icon="clipboard"
          tone="blue"
          label="Inspected"
          value={String(stats.inspected).padStart(2, "0")}
          meta={`${stats.percent}% complete`}
        />
        <StatCard
          icon="calendar"
          tone="amber"
          label="Pending"
          value={String(stats.pending).padStart(2, "0")}
          meta="Awaiting inspection"
        />
        <StatCard
          icon="spray"
          tone="violet"
          label="Issues"
          value={String(stats.issues).padStart(2, "0")}
          meta="Rooms needing attention"
        />
      </section>

      <section className="panel settings-panel" aria-labelledby="cleaning-board-title">
        <div className="panel-heading">
          <div>
            <h2 id="cleaning-board-title">Live cleaning board</h2>
            <p>
              Rooms the room boys have started or finished. Completed rooms wait
              here until a supervisor inspection is saved.
            </p>
          </div>
          <span className="panel-meta">
            {cleaningRows.length} active
          </span>
        </div>

        {cleaningRows.length === 0 ? (
          <p className="settings-empty">
            No room cleaning in progress for this branch.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Room boy</th>
                  <th>Status</th>
                  <th>Time in</th>
                  <th>Time out</th>
                  <th>Branch</th>
                </tr>
              </thead>
              <tbody>
                {cleaningRows.map(({ room, entry }) => (
                  <tr key={room}>
                    <td>
                      <span className="branch-tag">{room}</span>
                    </td>
                    <td>{entry.assigned_to || "Unassigned"}</td>
                    <td>
                      <span
                        className={`status-badge status-badge--${getRoomBoyStatusTone(entry.boy_status)}`}
                      >
                        {getRoomBoyStatusLabel(entry.boy_status)}
                      </span>
                    </td>
                    <td>{formatClock(entry.time_in)}</td>
                    <td>{formatClock(entry.time_out)}</td>
                    <td>
                      <span className="branch-tag">{branch.code}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel inspection-panel" aria-labelledby="rooms-title">
        <div className="inspection-panel__header">
          <div>
            <h2 id="rooms-title">Room checklist</h2>
            <p>
              {formatDisplayDate(date)} · {branch.code} Branch
            </p>
          </div>
          <span className="panel-meta">{filteredRooms.length} shown</span>
        </div>

        <div className="inspection-tools">
          <div className="filter-tabs" role="tablist" aria-label="Filter rooms">
            {[
              { value: "all", label: "All rooms", count: filterCounts.all },
              {
                value: "pending",
                label: "Pending",
                count: filterCounts.pending,
              },
              {
                value: "progress",
                label: "Cleaning",
                count: filterCounts.progress,
              },
              {
                value: "awaiting",
                label: "Awaiting",
                count: filterCounts.awaiting,
              },
              {
                value: "complete",
                label: "Complete",
                count: filterCounts.complete,
              },
              { value: "issue", label: "Issues", count: filterCounts.issue },
            ].map((tab) => (
              <button
                key={tab.value}
                className={`filter-tab ${
                  filter === tab.value ? "is-active" : ""
                }`}
                type="button"
                role="tab"
                aria-selected={filter === tab.value}
                onClick={() => setFilter(tab.value)}
              >
                {tab.label}
                <span>{tab.count}</span>
              </button>
            ))}
          </div>

          <label className="search-field">
            <Icon name="search" size={16} />
            <span className="sr-only">Search rooms</span>
            <input
              type="search"
              value={search}
              placeholder="Search room or floor"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className="inspection-progress">
          <div className="inspection-progress__bar">
            <i style={{ width: `${stats.percent}%` }} />
          </div>
          <span>{stats.percent}% inspected</span>
        </div>

        <div className="table-wrap">
          <table className="inspection-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Floor</th>
                <th>PMS</th>
                <th>Check in</th>
                <th>Check out</th>
                <th>Status</th>
                <th>Assign</th>
                <th className="room-status-col">Room Status</th>
                <th className="guest-presence-col no-print">Guest Presence</th>
                <th>Issues</th>
                <th>Remarks</th>
                <th className="manager-col no-print">Manager Check</th>
                <th className="inspect-col no-print">Supervisor Inspect</th>
              </tr>
            </thead>
            <tbody>
              {filteredRooms.map((room) => {
                const record = daily.rooms[room] ?? {};
                const status = getRoomStatus(room);
                const issues = countIssues(record);
                const roomRemarks = getRoomRemarks(branch.code, room, record);
                const statusLabel =
                  status === "complete"
                    ? "Complete"
                    : status === "issue"
                      ? "Issue"
                      : status === "progress"
                        ? "Cleaning"
                        : status === "awaiting"
                          ? "Awaiting inspection"
                          : "Pending";
                const assignmentLocked = isAssignmentLocked(room);

                return (
                  <tr key={room}>
                    <td>
                      <div className="room-cell">
                        <span className="room-number">{room}</span>
                        {record.pmsStatus === "pending" && record.checkIn === date && (
                          <span className="priority-badge" title="Vacant room with check-in today · PRIORITY">
                            PRIORITY
                          </span>
                        )}
                        {record.pmsGuest ? (
                          <small className="room-cell__guest" title={record.pmsGuest}>
                            {record.pmsGuest}
                          </small>
                        ) : null}
                      </div>
                    </td>
                    <td className="table-muted">{getFloor(room)}</td>
                    <td>
                      {isPmsBranch ? (
                        <span
                          className={`pms-status pms-status--${record.pmsStatus || "vacant"}`}
                          title={
                            record.pmsStatus === "checked_in"
                              ? "Occupied · Green bar"
                              : record.pmsStatus === "pending"
                                ? record.checkIn === date
                                  ? "Vacant · Check-in Today · PRIORITY"
                                  : "Not Occupied Yet · Yellow bar"
                                : record.pmsStatus === "checked_out"
                                  ? "Checked Out · Dark bar"
                                  : record.pmsStatus === "upcoming"
                                    ? "Check-in Coming · Blue bar"
                                    : "Vacant · No bar"
                          }
                        >
                          <i />
                          {record.pmsStatus === "checked_in"
                            ? "Occupied"
                            : record.pmsStatus === "pending" && record.checkIn === date
                              ? "Vacant · Check-in Today"
                              : record.pmsStatus === "pending"
                                ? "Not Occupied Yet"
                                : record.pmsStatus === "checked_out"
                                  ? "Checked Out"
                                  : record.pmsStatus === "upcoming"
                                    ? "Coming Soon"
                                    : "Vacant"}
                        </span>
                      ) : (
                        <span className="table-muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="date-cell">
                        {isPmsBranch ? (
                          <span
                            className={`date-text date-text--checkin ${
                              record.checkIn ? "" : "date-text--empty"
                            }`}
                          >
                            {formatLongDate(record.checkIn)}
                          </span>
                        ) : (
                          <input
                            className="table-date"
                            type="date"
                            value={record.checkIn ?? ""}
                            onChange={(event) =>
                              updateRoom(room, { checkIn: event.target.value })
                            }
                            aria-label={`Check in date for room ${room}`}
                          />
                        )}
                        {record.checkIn === date ? (
                          <span className="date-flag">Today</span>
                        ) : null}
                        {isPmsBranch && record.upcomingCheckIn ? (
                          <div className="date-coming">
                            <small>
                              Check-in coming: {formatLongDate(record.upcomingCheckIn)}
                            </small>
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {isPmsBranch && record.checkOut && isNearCheckOut(record.checkOut, date) ? (
                        <span
                          className={`date-text date-text--checkout`}
                          title={`Check out on ${formatLongDate(record.checkOut)}`}
                        >
                          <i />
                          {formatLongDate(record.checkOut)}
                        </span>
                      ) : (
                        <span className="table-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-pill status-pill--${status}`}>
                        <i />
                        {statusLabel}
                      </span>
                    </td>
                    <td>
                      <div className="assign-cell">
                        <div
                          className={`boy-palette${assignmentLocked ? " is-locked" : ""}`}
                          role="group"
                          aria-label={`Room boys for room ${room}`}
                        >
                          {roomBoysLoading ? (
                            <span className="table-muted">
                              Loading room boys…
                            </span>
                          ) : roomBoys.length === 0 ? (
                            <span className="table-muted">
                              No room boys in this branch
                            </span>
                          ) : (
                            roomBoys.map((boy) => {
                              const selected = getAssignedBoys(room).includes(
                                boy.full_name,
                              );
                              return (
                                <button
                                  key={boy.id}
                                  type="button"
                                  className={`boy-chip${selected ? " is-selected" : ""}`}
                                  onClick={() =>
                                    toggleAssignBoy(room, boy.full_name)
                                  }
                                  disabled={assignmentLocked}
                                  aria-pressed={selected}
                                  title={
                                    assignmentLocked
                                      ? "Locked after inspection"
                                      : selected
                                        ? "Tap to remove"
                                        : "Tap to assign"
                                  }
                                >
                                  {selected ? (
                                    <Icon name="check" size={10} />
                                  ) : null}
                                  {boy.full_name}
                                </button>
                              );
                            })
                          )}
                        </div>
                        <select
                          value={
                            assignDraft[room]?.remarks ??
                            boyEntries[room]?.assignment_remarks ??
                            ""
                          }
                          onChange={(event) =>
                            setAssignDraft((previous) => ({
                              ...previous,
                              [room]: {
                                ...(previous[room] ?? {}),
                                remarks: event.target.value,
                              },
                            }))
                          }
                          className="table-select table-select--remark"
                          aria-label={`Assignment remark for room ${room}`}
                          disabled={assignmentLocked}
                        >
                          <option value="">No remark</option>
                          {remarkOptions.map((option) => (
                            <option key={option.id} value={option.label}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <div className="assign-actions">
                          <button
                            className="button button--primary assign-button"
                            type="button"
                            onClick={() => assignRoom(room)}
                            disabled={
                              Boolean(assignBusy[room]) || assignmentLocked
                            }
                          >
                            {assignBusy[room] ? "Assigning…" : "Assign"}
                          </button>
                          {assignmentLocked ? (
                            <button
                              className="button button--secondary assign-button"
                              type="button"
                              onClick={() => reassignRoom(room)}
                              disabled={Boolean(assignBusy[room])}
                              title="Clear the saved inspection so you can assign new room boys and inspect the room again."
                            >
                              Reassign
                            </button>
                          ) : null}
                        </div>
                        {assignmentLocked ? (
                          <span
                            className="assign-locked"
                            title="The assigned room boys are locked until you reassign the room."
                          >
                            Locked after inspection
                          </span>
                        ) : null}
                        {boyEntries[room]?.assignment_remarks &&
                        !boyEntries[room]?.assignment_acknowledged_at ? (
                          <span
                            className="assign-pending"
                            title="The room boy keeps getting alerts until they acknowledge this assignment."
                          >
                            Awaiting ack
                          </span>
                        ) : boyEntries[room]?.assignment_remarks &&
                          boyEntries[room]?.assignment_acknowledged_at ? (
                          <span
                            className="assign-acknowledged"
                            title="The room boy acknowledged this assignment."
                          >
                            Acknowledged
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="room-status-col">
                      <div
                        className="room-status-palette"
                        role="group"
                        aria-label={`Room status for room ${room}`}
                      >
                        {["O/C", "C/O", "V/C"].map((value) => {
                          const selected =
                            (boyEntries[room]?.status ?? "") === value;
                          const label =
                            value === "O/C"
                              ? "Cleaning"
                              : value === "C/O"
                                ? "Check out"
                                : "Vacant cleaned";
                          return (
                            <button
                              key={value}
                              type="button"
                              className={`room-status-chip room-status-chip--${value.replace("/", "").toLowerCase()}${selected ? " is-selected" : ""}`}
                              onClick={() => {
                                const next = selected ? null : value;
                                setBoyEntries((previous) => ({
                                  ...previous,
                                  [room]: {
                                    ...(previous[room] ?? {}),
                                    status: next,
                                  },
                                }));
                                saveRoomBoyEntryFull(branch.code, date, room, {
                                  status: next,
                                }).catch((err) => {
                                  console.error("Save room status failed:", err);
                                  alert("Failed to save room status: " + err.message);
                                });
                              }}
                              aria-pressed={selected}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="guest-presence-col no-print">
                      {boyEntries[room]?.status === "O/C" ? (
                        <div
                          className="guest-presence-palette"
                          role="group"
                          aria-label={`Guest presence for room ${room}`}
                        >
                          {["Yes", "No"].map((value) => {
                            const key = value.toLowerCase();
                            const selected =
                              (boyEntries[room]?.guest_presence ?? "") === key;
                            return (
                              <button
                                key={value}
                                type="button"
                                className={`guest-presence-chip guest-presence-chip--${key}${selected ? " is-selected" : ""}`}
                                onClick={() => {
                                  const next = selected ? null : key;
                                  setBoyEntries((previous) => ({
                                    ...previous,
                                    [room]: {
                                      ...(previous[room] ?? {}),
                                      guest_presence: next,
                                    },
                                  }));
                                  saveRoomBoyEntryFull(branch.code, date, room, {
                                    guest_presence: next,
                                  }).catch((err) => {
                                    console.error("Save guest presence failed:", err);
                                    alert("Failed to save guest presence: " + err.message);
                                  });
                                }}
                                aria-pressed={selected}
                              >
                                {value}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="table-muted">—</span>
                      )}
                    </td>
                    <td>
                      {issues > 0 ? (
                        <span className="issue-count">{issues}</span>
                      ) : (
                        <span className="table-muted">—</span>
                      )}
                    </td>
                    <td>
                      {roomRemarks ? (
                        <span
                          className="remarks-preview"
                          title={roomRemarks}
                        >
                          {roomRemarks}
                        </span>
                      ) : (
                        <span className="table-muted">—</span>
                      )}
                    </td>
                    <td className="manager-col no-print">
                      <button
                        className="manager-cell"
                        type="button"
                        onClick={() => {
                          if (canManagerInspect) setManagerRoom(room);
                        }}
                        disabled={!canManagerInspect}
                        title={
                          canManagerInspect
                            ? "Record a manager cross-check"
                            : "Only the housekeeping manager can record a manager check"
                        }
                      >
                        {boyEntries[room]?.manager_inspected_at ? (
                          <>
                            <span
                              className={`status-pill status-pill--manager-${boyEntries[room]?.manager_status ?? "verified"}`}
                            >
                              <i />
                              {formatManagerStatus(
                                boyEntries[room]?.manager_status,
                              )}
                            </span>
                            {boyEntries[room]?.manager_rating ? (
                              <span className="manager-rating">
                                {boyEntries[room].manager_rating}★
                              </span>
                            ) : null}
                          </>
                        ) : canManagerInspect ? (
                          <span className="manager-cell__empty">Check</span>
                        ) : (
                          <span className="table-muted">—</span>
                        )}
                      </button>
                    </td>
                    <td className="inspect-col no-print">
                      <div className="inspect-action">
                        <button
                          className="table-action"
                          type="button"
                          onClick={() => setSelectedRoom(room)}
                        >
                          {status === "complete" || status === "issue"
                            ? "Review"
                            : "Inspect"}
                          <Icon name="chevronRight" size={13} />
                        </button>
                        {boyEntries[room]?.inspected_by ? (
                          <span
                            className={`inspect-by${
                              boyEntries[room]?.inspected_role ===
                              "branch_manager"
                                ? " is-manager"
                                : ""
                            }`}
                            title={
                              boyEntries[room]?.inspected_role ===
                              "branch_manager"
                                ? "Inspected by the branch manager"
                                : "Inspected by the supervisor"
                            }
                          >
                            {boyEntries[room]?.inspected_role ===
                            "branch_manager"
                              ? "BM"
                              : "Sup"}
                            : {boyEntries[room].inspected_by}
                          </span>
                        ) : (
                          <span className="inspect-by inspect-by--pending">
                            Not inspected
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredRooms.length === 0 ? (
            <div className="empty-state">
              <Icon name="search" size={22} />
              <strong>No rooms found</strong>
              <span>Try a different room number, floor or filter.</span>
            </div>
          ) : null}
        </div>

        <div className="inspection-table__footer">
          <span>
            Showing {filteredRooms.length} of {rooms.length} rooms
          </span>
          <span>
            Inspections save per branch and date; remarks stay until the next
            check-in.
          </span>
        </div>
      </section>

      <footer className="workspace-footer">
        <span>Hamsun Log Book</span>
        <span>{branch.code} Branch · Daily room inspection</span>
      </footer>

      {selectedRoom ? (
        <InspectionDrawer
          key={selectedRoom}
          room={selectedRoom}
          branch={branch}
          date={date}
          record={activeRecord}
          profile={profile}
          onClose={() => setSelectedRoom(null)}
          onSave={saveInspection}
        />
      ) : null}

      {managerRoom ? (
        <ManagerInspectionDrawer
          key={`manager-${managerRoom}`}
          room={managerRoom}
          branch={branch}
          date={date}
          record={boyEntries[managerRoom] ?? {}}
          onClose={() => setManagerRoom(null)}
          onSave={saveManagerCheck}
        />
      ) : null}
    </main>
  );
}

function PublicAreaPage({ branch, date, onBack, onDateChange, profile }) {
  const isSweeper = profile?.role === "sweeper";
  const isAdmin =
    profile?.role === "admin" || profile?.role === "superadmin";
  const [areas, setAreas] = useState([]);
  const [areasLoading, setAreasLoading] = useState(true);
  const [records, setRecords] = useState({});
  const [sheet, setSheet] = useState(() => ({
    ...emptyPublicArea(),
    supervisorName: "",
    supervisorRating: "",
  }));
  const [search, setSearch] = useState("");
  const [syncState, setSyncState] = useState("loading");
  const sheetRef = useRef(sheet);
  const sheetTimer = useRef(null);

  useEffect(() => {
    sheetRef.current = sheet;
  }, [sheet]);

  useEffect(
    () => () => {
      if (sheetTimer.current) clearTimeout(sheetTimer.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setAreasLoading(true);
    listPublicAreas(branch.code)
      .then((nextAreas) => {
        if (cancelled) return;
        setAreas(nextAreas);
        setAreasLoading(false);
      })
      .catch(() => {
        if (!cancelled) setAreasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branch.code]);

  // Load the shared sheet from Supabase and keep it in sync in real time.
  // A sweeper's tick therefore appears on the supervisor's screen immediately,
  // even on a different device or browser.
  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const [nextRecords, nextSheet] = await Promise.all([
          listPublicInspectionRecords(branch.code, date),
          getPublicAreaSheet(branch.code, date),
        ]);
        if (cancelled) return;

        const map = {};
        nextRecords.forEach((record) => {
          map[`${record.area_id}:${record.shift_key}`] = record;
        });

        const merged = {
          ...emptyPublicArea(),
          shift: nextSheet?.shift ?? "",
          supervisorName: nextSheet?.supervisor_name ?? "",
          supervisorRemarks: nextSheet?.supervisor_remarks ?? "",
          supervisorSignature: nextSheet?.supervisor_signature ?? "",
          supervisorRating: nextSheet?.supervisor_rating ?? "",
          attendantSignature: nextSheet?.attendant_signature ?? "",
          date,
        };

        setRecords(map);
        if (!sheetTimer.current) {
          // Supervisor signature is fixed per branch.
          const supervisorSignature = getBranchSupervisorSignature(
            branch.code,
            merged.supervisorSignature,
          );
          if (supervisorSignature) {
            merged.supervisorSignature = supervisorSignature;
          }
          if (profile?.role === "sweeper" && profile?.full_name) {
            merged.attendantSignature = profile.full_name;
          }
          setSheet(merged);
          sheetRef.current = merged;
          // Persist the directory signature.
          if (supervisorSignature) {
            savePublicAreaSheet(branch.code, date, { supervisor_signature: supervisorSignature }).catch(() => {});
          }
          if (profile?.role === "sweeper" && profile?.full_name) {
            savePublicAreaSheet(branch.code, date, { attendant_signature: profile.full_name }).catch(() => {});
          }
        }
        setSyncState("saved");
      } catch {
        if (!cancelled) setSyncState("error");
      }
    };

    refresh();

    const unsubscribeRecords = subscribeToPublicInspectionRecords(
      branch.code,
      date,
      refresh,
    );
    const unsubscribeSheet = subscribeToPublicAreaSheets(
      branch.code,
      date,
      refresh,
    );
    const handleFocus = () => refresh();
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      unsubscribeRecords();
      unsubscribeSheet();
      window.removeEventListener("focus", handleFocus);
    };
  }, [branch.code, date]);

  const scheduleSheetSave = (nextSheet) => {
    if (sheetTimer.current) clearTimeout(sheetTimer.current);
    setSyncState("saving");
    sheetTimer.current = setTimeout(async () => {
      sheetTimer.current = null;
      try {
        await savePublicAreaSheet(branch.code, date, {
          shift: nextSheet.shift,
          supervisor_name: nextSheet.supervisorName,
          supervisor_remarks: nextSheet.supervisorRemarks,
          supervisor_signature: nextSheet.supervisorSignature,
          supervisor_rating: nextSheet.supervisorRating,
          attendant_signature: nextSheet.attendantSignature,
        });
        setSyncState("saved");
      } catch {
        setSyncState("error");
      }
    }, 450);
  };

  const setField = (field, value) => {
    const next = { ...sheetRef.current, [field]: value };
    sheetRef.current = next;
    setSheet(next);
    scheduleSheetSave(next);
  };

  // Keep the branch supervisor signature filled in for this branch.
  useEffect(() => {
    const supervisorSignature = getBranchSupervisorSignature(
      branch.code,
      sheetRef.current.supervisorSignature,
    );
    if (supervisorSignature) {
      const next = { ...sheetRef.current, supervisorSignature };
      sheetRef.current = next;
      setSheet(next);
    }
    if (profile?.role === "sweeper" && profile?.full_name) {
      const next = { ...sheetRef.current, attendantSignature: profile.full_name };
      sheetRef.current = next;
      setSheet(next);
    }
  }, [branch.code, profile?.full_name, profile?.role]);

  const setAreaCheckbox = async (areaId, shiftKey, field, checked) => {
    // Sweepers can only mark staff (cleaned); supervisors only verify.
    // The manager column belongs to the admin (Kamran).
    if (field === "manager" && !isAdmin) return;
    if (isSweeper && field !== "staff") return;

    const key = `${areaId}:${shiftKey}`;
    const supervisorName =
      sheetRef.current.supervisorName || profile?.full_name || "";
    const managerName = MANAGER_SIGNATURE;

    setRecords((previous) => ({
      ...previous,
      [key]: {
        ...(previous[key] ?? {}),
        ...(field === "staff"
          ? { staff_checked: checked }
          : field === "supervisor"
            ? {
                supervisor_checked: checked,
                supervisor_name: checked ? supervisorName : null,
              }
            : {
                manager_checked: checked,
                manager_name: checked ? managerName : null,
              }),
      },
    }));
    setSyncState("saving");

    try {
      await upsertPublicInspectionRecord({
        branchCode: branch.code,
        date,
        areaId,
        shiftKey,
        staffChecked: field === "staff" ? checked : undefined,
        supervisorChecked: field === "supervisor" ? checked : undefined,
        supervisorName: field === "supervisor" ? supervisorName : undefined,
        managerChecked: field === "manager" ? checked : undefined,
        managerName: field === "manager" ? managerName : undefined,
      });
      setSyncState("saved");
    } catch {
      setSyncState("error");
    }
  };

  const getCompletion = () => {
    if (areas.length === 0) return 0;
    const checksPerShift = isSweeper ? 1 : isAdmin ? 3 : 2;
    const total = areas.length * publicShifts.length * checksPerShift;
    let checked = 0;
    areas.forEach((area) => {
      publicShifts.forEach((shift) => {
        const record = records[`${area.id}:${shift.key}`];
        if (record?.staff_checked) checked += 1;
        if (!isSweeper && record?.supervisor_checked) checked += 1;
        if (isAdmin && record?.manager_checked) checked += 1;
      });
    });
    return Math.round((checked / total) * 100);
  };

  const filteredAreas = useMemo(() => {
    const query = search.trim().toLowerCase();
    return areas.filter(
      (area) => !query || area.name.toLowerCase().includes(query),
    );
  }, [areas, search]);

  const syncLabel =
    syncState === "loading"
      ? "Loading from Hamsun cloud…"
      : syncState === "saving"
        ? "Saving to Hamsun cloud…"
        : syncState === "error"
          ? "Could not save — retrying on next change"
          : "Saved to Hamsun cloud";

  return (
    <main className={`workspace workspace--${branch.tone} public-area-page`}>
      <div className="inspection-heading">
        <button className="back-link" type="button" onClick={onBack}>
          <Icon name="arrowLeft" size={15} />
          Back to {branch.code} Branch
        </button>

        <div className="inspection-heading__row">
          <div className="branch-title">
            <span className="branch-title__badge">{branch.code}</span>
            <div>
              <p className="page-kicker">
                {isSweeper
                  ? "Mark areas cleaned · " + formatDisplayDate(date)
                  : "Daily cleaning · " + formatDisplayDate(date)}
              </p>
              <h1>
                {isSweeper ? "Mark Areas Cleaned" : "Public Area Cleaning Sheet"}
              </h1>
            </div>
          </div>

          {!isSweeper && (
            <div className="inspection-heading__actions no-print">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => window.print()}
              >
                <Icon name="printer" size={15} />
                Print checklist
              </button>
            </div>
          )}
        </div>

        <p className="page-description">
          {isSweeper
            ? "Mark each public area as cleaned after your shift. Your supervisor sees your checks immediately."
            : isAdmin
              ? "Review every branch: staff completion, supervisor checks and manager sign-off for each public area across three shifts. All checks sync live from the cloud."
              : "Record staff completion and supervisor checks for each public area, across three shifts. Sweeper checks are synced live from the cloud."}
        </p>

        {!isSweeper && (
          <div className="print-summary">
            <span>Date: {formatDisplayDate(date)}</span>
            <span>Branch: {branch.code}</span>
            <span>Shift: {sheet.shift || "________________"}</span>
          </div>
        )}
      </div>

      <div className="inspection-toolbar">
        <div className="date-control">
          <button
            className="date-control__arrow"
            type="button"
            aria-label="Previous day"
            onClick={() => onDateChange(shiftDate(date, -1))}
          >
            <Icon name="chevronLeft" size={17} />
          </button>
          <label className="date-control__input">
            <span className="sr-only">Cleaning date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value) onDateChange(event.target.value);
              }}
            />
          </label>
          <button
            className="date-control__arrow"
            type="button"
            aria-label="Next day"
            onClick={() => onDateChange(shiftDate(date, 1))}
          >
            <Icon name="chevronRight" size={17} />
          </button>
          <button
            className="button button--ghost"
            type="button"
            onClick={() => onDateChange(getTodayISO())}
            disabled={date === getTodayISO()}
          >
            Today
          </button>
        </div>

        <span className="toolbar-divider" />

        <label className="supervisor-field">
          <span>Shift</span>
          <select
            value={sheet.shift}
            onChange={(event) => setField("shift", event.target.value)}
          >
            <option value="">Select shift</option>
            <option value="Morning">Morning</option>
            <option value="Evening">Evening</option>
            <option value="Night">Night</option>
          </select>
        </label>

        {!isSweeper && (
          <label className="supervisor-field">
            <span>Supervisor Name</span>
            <input
              type="text"
              value={sheet.supervisorName}
              placeholder={profile?.full_name || "Enter supervisor name"}
              onChange={(event) =>
                setField("supervisorName", event.target.value)
              }
            />
          </label>
        )}

        <label className="search-field">
          <Icon name="search" size={16} />
          <span className="sr-only">Search areas</span>
          <input
            type="search"
            value={search}
            placeholder="Search area"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <div className="inspection-progress">
          <div className="inspection-progress__bar">
            <i style={{ width: `${getCompletion()}%` }} />
          </div>
          <span>
            {getCompletion()}% {isSweeper ? "cleaned" : "checked"}
          </span>
        </div>

        <span
          className={`autosave-status autosave-status--${syncState}`}
          title={syncLabel}
        >
          <i />
          {syncLabel}
        </span>
      </div>

      <section className="panel public-area-panel" aria-labelledby="areas-title">
        <div className="public-area-panel__header">
          <div>
            <h1 id="areas-title" className="public-area-title">
              DAILY PUBLIC AREA CLEANING ROUTING &amp; QUALITY CHECKLIST
            </h1>
          </div>
        </div>

        {areasLoading ? (
          <p className="settings-empty">Loading public areas…</p>
        ) : filteredAreas.length === 0 ? (
          <p className="settings-empty">
            No public areas configured for this branch.
          </p>
        ) : (
          <div className="table-wrap public-area-table-wrap">
            <table
              className={`public-area-table ${
                isSweeper
                  ? "public-area-table--sweeper"
                  : isAdmin
                    ? "public-area-table--admin"
                    : ""
              }`}
            >
              <thead>
                <tr>
                  <th className="area-col">Area</th>
                  {publicShifts.map((shift) => (
                    <th
                      key={shift.key}
                      colSpan={isSweeper ? 1 : isAdmin ? 3 : 2}
                      className="shift-group"
                    >
                      {shift.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="area-col"></th>
                  {publicShifts.map((shift) =>
                    isSweeper ? (
                      <th key={shift.key} className="shift-sub">
                        Staff Check
                      </th>
                    ) : (
                      <Fragment key={shift.key}>
                        <th className="shift-sub shift-sub--staff">
                          Staff Check
                          <small>Sweeper</small>
                        </th>
                        <th className="shift-sub shift-sub--supervisor">
                          Supervisor Check
                        </th>
                        {isAdmin && (
                          <th className="shift-sub shift-sub--manager">
                            Manager Check
                          </th>
                        )}
                      </Fragment>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredAreas.map((area) => (
                  <tr key={area.id} className="public-area-row">
                    <td className="area-name-cell">{area.name}</td>
                    {publicShifts.map((shift) => {
                      const record = records[`${area.id}:${shift.key}`] ?? {};
                      const isStaffChecked = !!record.staff_checked;
                      const isSupervisorChecked = !!record.supervisor_checked;
                      const isManagerChecked = !!record.manager_checked;

                      if (isSweeper) {
                        return (
                          <td
                            key={`${shift.key}-staff`}
                            className="checkbox-cell"
                          >
                            <input
                              type="checkbox"
                              checked={isStaffChecked}
                              onChange={(event) =>
                                setAreaCheckbox(
                                  area.id,
                                  shift.key,
                                  "staff",
                                  event.target.checked,
                                )
                              }
                              aria-label={`Staff ${shift.label} ${area.name}`}
                            />
                          </td>
                        );
                      }

                      return (
                        <Fragment key={shift.key}>
                          <td className="checkbox-cell checkbox-cell--staff">
                            <div className="staff-check-cell">
                              <input
                                type="checkbox"
                                checked={isStaffChecked}
                                readOnly
                                disabled
                                aria-label={`Staff ${shift.label} ${area.name} (marked by sweeper)`}
                              />
                              {isStaffChecked && (
                                <span className="sweeper-checked-badge">
                                  ✓ Sweeper checked
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="checkbox-cell checkbox-cell--supervisor">
                            <input
                              type="checkbox"
                              checked={isSupervisorChecked}
                              readOnly={isAdmin}
                              disabled={isAdmin}
                              onChange={(event) =>
                                setAreaCheckbox(
                                  area.id,
                                  shift.key,
                                  "supervisor",
                                  event.target.checked,
                                )
                              }
                              aria-label={`Supervisor ${shift.label} ${area.name}`}
                            />
                            {isSupervisorChecked && record.supervisor_name && (
                              <span className="supervisor-name">
                                {record.supervisor_name}
                              </span>
                            )}
                          </td>
                          {isAdmin && (
                            <td className="checkbox-cell checkbox-cell--manager">
                              <input
                                type="checkbox"
                                checked={isManagerChecked}
                                onChange={(event) =>
                                  setAreaCheckbox(
                                    area.id,
                                    shift.key,
                                    "manager",
                                    event.target.checked,
                                  )
                                }
                                aria-label={`Manager ${shift.label} ${area.name}`}
                              />
                              {isManagerChecked && record.manager_name && (
                                <span className="manager-name">
                                  {record.manager_name}
                                </span>
                              )}
                            </td>
                          )}
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!isSweeper && (
        <section
          className="panel public-area-signoff"
          aria-labelledby="signoff-title"
        >
          <div className="public-area-signoff__header">
            <div>
              <h2 id="signoff-title">Supervisor Remarks &amp; Sign-off</h2>
            </div>
          </div>

          <div className="signoff-fields">
            <label className="signoff-field">
              <span>Supervisor Remarks</span>
              <textarea
                rows="2"
                value={sheet.supervisorRemarks}
                placeholder="Supervisor remarks..."
                onChange={(event) =>
                  setField("supervisorRemarks", event.target.value)
                }
              />
            </label>

            <div className="signoff-pair">
              <label className="signoff-field signoff-signature">
                <span>Supervisor Signature</span>
                <input
                  type="text"
                  value={getBranchSupervisorSignature(
                    branch.code,
                    sheet.supervisorSignature,
                  )}
                  placeholder="Supervisor name / signature"
                  readOnly
                />
              </label>
              <label className="signoff-field signoff-signature">
                <span>Public Area Attendant</span>
                <input
                  type="text"
                  value={
                    profile?.role === "sweeper"
                      ? profile?.full_name ?? sheet.attendantSignature
                      : sheet.attendantSignature
                  }
                  placeholder="Attendant name / signature"
                  readOnly={profile?.role === "sweeper"}
                  onChange={(event) =>
                    setField("attendantSignature", event.target.value)
                  }
                />
              </label>
            </div>
          </div>

          <div className="signoff-fields">
            <label className="signoff-field">
              <span>Attendant Cleaning Rating</span>
              <div className="rating-options">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`rating-star ${sheet.supervisorRating === String(star) ? "is-active" : ""}`}
                    onClick={() =>
                      setField("supervisorRating", String(star))
                    }
                    aria-label={`Rate attendant ${star} star${star === 1 ? "" : "s"}`}
                  >
                    {star}
                  </button>
                ))}
              </div>
            </label>
          </div>
        </section>
      )}

      <footer className="workspace-footer">
        <span>Hamsun Log Book</span>
        <span>{branch.code} Branch · Public area cleaning</span>
      </footer>
    </main>
  );
}

const roomBoyStatusOptions = [
  "O/C",
  "C/O",
  "V/C",
  "O/D",
  "V/D",
  "DND",
  "N/S",
  "OOO",
];

function RoomBoyPage({ branch, date, onBack, onDateChange, profile }) {
  const isRoomBoy = profile?.role === "room_boy";
  const roomBoyName = profile?.full_name ?? "";
  const roomListFromPms = roomLists[branch.code] ?? [];
  const [entries, setEntries] = useState({});
  const rooms =
    roomListFromPms.length > 0
      ? roomListFromPms
      : Object.keys(entries).sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true }),
        );
  const [sheet, setSheet] = useState({
    name: roomBoyName,
    supervisorSign: "",
    bmSign: "",
  });
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState("loading");
  const [pms, setPms] = useState({
    status: hasPmsConfig ? "loading" : "unlinked",
    upcomingCheckIns: {},
  });
  const sheetRef = useRef(sheet);
  const timers = useRef({});
  const [notifications, setNotifications] = useState([]);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [notificationPopup, setNotificationPopup] = useState(null);
  const [ackBusy, setAckBusy] = useState({});
  const [ratings, setRatings] = useState([]);
  const [roomBoys, setRoomBoys] = useState([]);
  const [selectedRoomBoy, setSelectedRoomBoy] = useState("");
  const entriesRef = useRef(entries);

  // A room may have a primary room boy plus partners.
  const isAssignedTo = (entry, name) =>
    Boolean(entry) &&
    (entry.assigned_to === name ||
      (entry.assigned_partners ?? []).includes(name));

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    sheetRef.current = sheet;
  }, [sheet]);

  // Supervisors, managers and superadmins can browse the branch room boys and
  // open an individual room boy's report for the selected date.
  useEffect(() => {
    if (isRoomBoy) {
      setRoomBoys([]);
      return undefined;
    }
    let cancelled = false;
    listRoomBoys(branch.code)
      .then((boys) => {
        if (!cancelled) setRoomBoys(boys);
      })
      .catch(() => {
        if (!cancelled) setRoomBoys([]);
      });
    return () => {
      cancelled = true;
    };
  }, [branch.code, isRoomBoy]);

  useEffect(() => {
    setSelectedRoomBoy("");
  }, [branch.code]);

  useEffect(
    () => () => {
      Object.values(timers.current).forEach((timer) => clearTimeout(timer));
    },
    [],
  );

  // Load the shared report from Supabase and stay in sync in real time.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const refresh = async () => {
      try {
        const { sheet: nextSheet, entries: nextEntries } =
          await listRoomBoyReport(branch.code, date);
        if (cancelled) return;

        const map = {};
        nextEntries.forEach((entry) => {
          // Room boys only see their own assigned rooms (primary or partner).
          if (!isRoomBoy || isAssignedTo(entry, roomBoyName)) {
            map[entry.room_no] = entry;
          }
        });

        const merged = {
          name: nextSheet?.room_boy_name ?? roomBoyName,
          supervisorSign: nextSheet?.supervisor_sign ?? "",
          bmSign: nextSheet?.bm_sign ?? "",
        };

        // Keep the ref in sync with the latest server data even while a row is
        // being edited, so assignment reminders and notifications stay accurate.
        entriesRef.current = { ...entriesRef.current, ...map };

        if (Object.keys(timers.current).length === 0) {
          // Signatures come from the branch directory, so every sheet carries
          // the correct supervisor and branch manager name.
          const supervisorSign = getBranchSupervisorSignature(
            branch.code,
            merged.supervisorSign,
          );
          const bmSign = getBranchManagerSignature(branch.code, merged.bmSign);
          if (supervisorSign) merged.supervisorSign = supervisorSign;
          if (bmSign) merged.bmSign = bmSign;
          setEntries(map);
          setSheet(merged);
          sheetRef.current = merged;
          // Persist the directory signatures.
          if (supervisorSign) {
            saveRoomBoySheet(branch.code, date, { supervisor_sign: supervisorSign }).catch(() => {});
          }
          if (bmSign) {
            saveRoomBoySheet(branch.code, date, { bm_sign: bmSign }).catch(() => {});
          }
        }
        setLoading(false);
        setSyncState("saved");
      } catch {
        if (!cancelled) {
          setLoading(false);
          setSyncState("error");
        }
      }
    };

    refresh();

    const unsubscribe = subscribeToRoomBoyReport(branch.code, date, refresh);
    const handleFocus = () => refresh();
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
    };
  }, [branch.code, date]);


  // Load notifications and ratings for the room boy.
  useEffect(() => {
    if (!isRoomBoy) return undefined;
    let cancelled = false;
    let seeded = false;
    const seenIds = new Set();

    const refresh = async () => {
      try {
        const [rbNotifs, staffNotifs, ratings] = await Promise.all([
          listRoomBoyNotifications(roomBoyName, branch.code),
          listStaffNotifications(profile.email),
          listRoomBoyRatings(roomBoyName, branch.code),
        ]);
        if (cancelled) return;
        // Combine room boy notifications with staff notifications.
        const allNotifs = [
          ...rbNotifs.map((n) => ({ ...n, id: n.id ?? `rb-${n.room_number}-${n.created_at}`, title: n.title ?? "Room Assignment" })),
          ...staffNotifs.map((n) => ({ ...n })),
        ];
        setNotifications(allNotifs);
        setNotificationsUnread(allNotifs.filter((n) => !n.read_at).length);
        setRatings(ratings);

        if (!seeded) {
          allNotifs.forEach((n) => seenIds.add(String(n.id)));
          seeded = true;
          return;
        }

        const fresh = allNotifs.filter(
          (n) => !n.read_at && !seenIds.has(String(n.id)),
        );
        if (fresh.length === 0) return;

        playBellSound();
        fresh.forEach((n) => {
          const body =
            n.message ||
            (n.notification_type === "room_assigned"
              ? `Room ${n.room_number} assigned to you${n.remark ? ` — ${n.remark}` : ""}`
              : n.notification_type === "rating_received"
                ? `Room ${n.room_number}: rated ${n.rating ?? ""}/5`
                : n.title || "");
          showDeviceNotification(n.title || "Hamsun Log Book", {
            body,
            tag: `staff-${n.id}`,
            renotify: true,
            requireInteraction: true,
            data: {
              url: `/#/branch/${branch.code}/room-boy/${date}`,
            },
          });
        });
        allNotifs.forEach((n) => seenIds.add(String(n.id)));
      } catch {
        // Notifications are best-effort; ignore errors.
      }
    };

    refresh();

    const handleFocus = () => refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    // Poll every 10 seconds for new notifications.
    const notifTimer = setInterval(refresh, 10000);

    return () => {
      cancelled = true;
      clearInterval(notifTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [branch.code, date, isRoomBoy, roomBoyName, profile.email]);

  // Keep reminding the room boy about assignments that carry a remark until
  // they acknowledge them.
  useEffect(() => {
    if (!isRoomBoy) return undefined;
    let lastRing = 0;

    const isUrgent = (entry) =>
      String(entry?.assignment_remarks || "")
        .trim()
        .toLowerCase() === "urgent";

    const remind = () => {
      // Only URGENT assignments keep ringing repeatedly until acknowledged.
      const pending = Object.entries(entriesRef.current).filter(
        ([, entry]) =>
          isAssignedTo(entry, roomBoyName) &&
          isUrgent(entry) &&
          !entry?.assignment_acknowledged_at,
      );
      if (pending.length === 0) return;

      const now = Date.now();
      if (now - lastRing < 3000) return;
      lastRing = now;

      playBellSound();
      pending.forEach(([roomNo, entry]) => {
        showDeviceNotification("Room assignment reminder", {
          body: `Room ${roomNo}: ${entry.assignment_remarks}. Please acknowledge.`,
          tag: `assign-reminder-${branch.code}-${roomNo}`,
          renotify: true,
          requireInteraction: true,
          data: { url: `/#/branch/${branch.code}/room-boy/${date}` },
        });
      });
    };

    remind();
    const reminderTimer = setInterval(remind, 3000);
    return () => clearInterval(reminderTimer);
  }, [isRoomBoy, roomBoyName, branch.code, date]);

  // Ring immediately when assignments load or change, so a room boy is alerted
  // without waiting for the next reminder tick.
  useEffect(() => {
    if (!isRoomBoy) return undefined;
    // Only URGENT assignments get an immediate ring here; non-urgent
    // assignments rely on the single notification created at assignment time.
    const pending = Object.entries(entries).filter(
      ([, entry]) =>
        isAssignedTo(entry, roomBoyName) &&
        String(entry?.assignment_remarks || "").trim().toLowerCase() === "urgent" &&
        !entry?.assignment_acknowledged_at,
    );
    if (pending.length === 0) return undefined;

    playBellSound();
    pending.forEach(([roomNo, entry]) => {
      showDeviceNotification("Room assignment reminder", {
        body: `Room ${roomNo}: ${entry.assignment_remarks}. Please acknowledge.`,
        tag: `assign-reminder-${branch.code}-${roomNo}`,
        renotify: true,
        requireInteraction: true,
        data: { url: `/#/branch/${branch.code}/room-boy/${date}` },
      });
    });
    return undefined;
  }, [entries, isRoomBoy, roomBoyName, branch.code, date]);

  const markAllRoomBoyNotificationsRead = () => {
    const now = new Date().toISOString();
    const next = notifications.map((n) =>
      n.read_at ? n : { ...n, read_at: now },
    );
    setNotifications(next);
    setNotificationsUnread(0);
    markRoomBoyNotificationsRead(roomBoyName, branch.code).catch(() => {});
    markStaffNotificationsRead(profile.email).catch(() => {});
  };

  const markOneRoomBoyNotificationRead = (id) => {
    const now = new Date().toISOString();
    const next = notifications.map((n) =>
      String(n.id) === String(id) && !n.read_at
        ? { ...n, read_at: now }
        : n,
    );
    setNotifications(next);
    setNotificationsUnread(next.filter((n) => !n.read_at).length);
    markRoomBoyNotificationRead(id).catch(() => {});
    markStaffNotificationRead(id).catch(() => {});
    setNotificationPopup((previous) =>
      previous && String(previous.id) === String(id)
        ? { ...previous, read_at: previous.read_at ?? now }
        : previous,
    );
  };

  const acknowledgeAssignment = async (roomNo) => {
    setAckBusy((previous) => ({ ...previous, [roomNo]: true }));
    try {
      await acknowledgeRoomAssignment({
        branchCode: branch.code,
        date,
        roomNo,
        roomBoyName,
      });
      const now = new Date().toISOString();
      setEntries((previous) => ({
        ...previous,
        [roomNo]: { ...(previous[roomNo] ?? {}), assignment_acknowledged_at: now },
      }));
      setNotifications((previous) =>
        previous.map((n) =>
          n.notification_type === "room_assigned" &&
          String(n.room_number) === String(roomNo)
            ? { ...n, read_at: n.read_at ?? now }
            : n,
        ),
      );
      setNotificationsUnread((previous) => Math.max(0, previous - 1));
    } catch {
      // The banner stays visible so the room boy can retry.
    } finally {
      setAckBusy((previous) => ({ ...previous, [roomNo]: false }));
    }
  };

  // Load PMS data for priority badges (rooms with upcoming check-ins).
  useEffect(() => {
    let cancelled = false;
    if (!hasPmsConfig || !pmsBranchCodes.includes(branch.code)) {
      setPms({ status: "unlinked", upcomingCheckIns: {} });
      return undefined;
    }

    setPms((previous) => ({ ...previous, status: "loading" }));

    fetchBranchSnapshot(branch.code, date)
      .then((snapshot) => {
        if (cancelled) return;
        const upcoming = {};
        snapshot.rooms.forEach((room) => {
          if (room.upcomingCheckIn) {
            upcoming[room.number] = room.upcomingCheckIn;
          }
        });
        setPms({ status: "ready", upcomingCheckIns: upcoming });
      })
      .catch(() => {
        if (!cancelled) setPms({ status: "error", upcomingCheckIns: {} });
      });

    return () => {
      cancelled = true;
    };
  }, [branch.code, date]);

  const queueSave = (key, task) => {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    setSyncState("saving");
    timers.current[key] = setTimeout(async () => {
      delete timers.current[key];
      try {
        await task();
        setSyncState("saved");
      } catch {
        setSyncState("error");
      }
    }, 450);
  };

  const setSheetField = (field, value) => {
    const next = { ...sheetRef.current, [field]: value };
    sheetRef.current = next;
    setSheet(next);
    queueSave(`sheet:${field}`, () =>
      saveRoomBoySheet(branch.code, date, {
        room_boy_name: next.name,
        supervisor_sign: next.supervisorSign,
        bm_sign: next.bmSign,
      }),
    );
  };

  // Auto-fill is handled in the refresh function below.

  const setEntryField = (roomNo, field, value) => {
    setEntries((previous) => ({
      ...previous,
      [roomNo]: { ...(previous[roomNo] ?? {}), [field]: value },
    }));
    queueSave(`entry:${roomNo}:${field}`, () =>
      saveRoomBoyEntryFull(branch.code, date, roomNo, { [field]: value }),
    );
  };

  const checkInRoom = (roomNo) => {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    setEntries((previous) => ({
      ...previous,
      [roomNo]: {
        ...(previous[roomNo] ?? {}),
        time_in: timeStr,
        boy_status: "progress",
      },
    }));
    queueSave(`entry:${roomNo}:checkin`, () =>
      saveRoomBoyEntryFull(branch.code, date, roomNo, {
        time_in: timeStr,
        boy_status: "progress",
      }),
    );

    // Let housekeeping managers and the branch supervisor know who is in which
    // room. The reference makes repeated taps idempotent.
    notifyRoomCleaning({
      branchCode: branch.code,
      roomNumber: roomNo,
      roomBoyName: roomBoyName || sheetRef.current.name || "Room boy",
      phase: "start",
      // Notifications store plain text, so hand them AM/PM times directly.
      timeIn: formatClock(timeStr),
      reference: `cleaning:${branch.code}:${roomNo}:start:${date}:${timeStr}`,
    }).catch(() => {
      // Cleaning alerts are best-effort; the report still saves.
    });
  };

  const checkOutRoom = (roomNo) => {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    const timeIn = entries[roomNo]?.time_in ?? "";
    const guestPresence = entries[roomNo]?.guest_presence ?? null;
    setEntries((previous) => ({
      ...previous,
      [roomNo]: {
        ...(previous[roomNo] ?? {}),
        time_out: timeStr,
        boy_status: "awaiting_inspection",
      },
    }));
    queueSave(`entry:${roomNo}:checkout`, () =>
      saveRoomBoyEntryFull(branch.code, date, roomNo, {
        time_out: timeStr,
        boy_status: "awaiting_inspection",
      }),
    );

    notifyRoomCleaning({
      branchCode: branch.code,
      roomNumber: roomNo,
      roomBoyName: roomBoyName || sheetRef.current.name || "Room boy",
      phase: "finish",
      timeIn: timeIn ? formatClock(timeIn) : undefined,
      timeOut: formatClock(timeStr),
      reference: `cleaning:${branch.code}:${roomNo}:finish:${date}:${timeStr}`,
    }).catch(() => {
      // Cleaning alerts are best-effort; the report still saves.
    });

    // When guest was present, no supervisor inspection is needed; send the
    // Slack notification now (EXT only) with Inspected By: N/A.
    if (guestPresence === "yes") {
      slackNotifyGuestPresentYes({
        branchCode: branch.code,
        roomNumber: roomNo,
        roomBoyName: roomBoyName || sheetRef.current.name || "Room boy",
        timeIn,
        timeOut: timeStr,
        date,
      }).catch(() => {});
    }
  };

  // Room boys only see rooms assigned to them by the supervisor. Supervisors,
  // managers and superadmins can drill into one room boy at a time.
  const displayRooms = isRoomBoy
    ? rooms.filter((room) => isAssignedTo(entries[room], roomBoyName))
    : selectedRoomBoy
      ? rooms.filter((room) => isAssignedTo(entries[room], selectedRoomBoy))
      : rooms;

  const filledRooms = displayRooms.filter((room) => {
    const entry = entries[room];
    return Boolean(
      entry &&
        (entry.status ||
          entry.time_in ||
          entry.time_out ||
          entry.signature ||
          entry.boy_status),
    );
  }).length;

  // One tile per branch room boy, including boys with no rooms yet, so the
  // supervisor, manager and superadmin can open an individual report.
  const assignedRooms = rooms.filter((room) => {
    const entry = entries[room];
    return Boolean(
      entry?.assigned_to || (entry?.assigned_partners ?? []).length > 0,
    );
  });

  const roomBoyTiles = useMemo(() => {
    if (isRoomBoy) return [];
    const names = new Set(
      roomBoys.map((boy) => boy.full_name).filter(Boolean),
    );
    assignedRooms.forEach((room) => {
      const entry = entries[room];
      if (entry.assigned_to) names.add(entry.assigned_to);
      (entry.assigned_partners ?? []).forEach((name) => {
        if (name) names.add(name);
      });
    });
    return Array.from(names)
      .map((name) => {
        const counts = {
          name,
          total: 0,
          completed: 0,
          progress: 0,
          awaiting: 0,
          pending: 0,
        };
        assignedRooms.forEach((room) => {
          const entry = entries[room];
          if (!isAssignedTo(entry, name)) return;
          counts.total += 1;
          const status = entry.boy_status ?? "";
          if (status === "completed") counts.completed += 1;
          else if (status === "progress") counts.progress += 1;
          else if (status === "awaiting_inspection" || status === "done") {
            counts.awaiting += 1;
          } else counts.pending += 1;
        });
        return counts;
      })
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [assignedRooms, entries, isRoomBoy, roomBoys]);

  const syncLabel =
    syncState === "loading"
      ? "Loading from Hamsun cloud…"
      : syncState === "saving"
        ? "Saving to Hamsun cloud…"
        : syncState === "error"
          ? "Could not save — retrying on next change"
          : "Saved to Hamsun cloud";

  // Assignments the room boy still has to acknowledge. Kept in a separate
  // banner so acknowledging can never be confused with starting (Time In) the
  // room.
  const pendingAssignments = isRoomBoy
    ? Object.entries(entries)
        .filter(
          ([, entry]) =>
            isAssignedTo(entry, roomBoyName) &&
            entry?.assignment_remarks &&
            !entry?.assignment_acknowledged_at,
        )
        .map(([room, entry]) => ({ room, entry }))
        .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }))
    : [];

  return (
    <main className={`workspace workspace--${branch.tone} room-boy-page`}>
      <div className="inspection-heading">
        <button className="back-link" type="button" onClick={onBack}>
          <Icon name="arrowLeft" size={15} />
          Back to {branch.code} Branch
        </button>

        <div className="inspection-heading__row">
          <div className="branch-title">
            <span className="branch-title__badge">{branch.code}</span>
            <div>
              <p className="page-kicker">
                Room boy daily report · {formatDisplayDate(date)}
              </p>
              <h1>Room Boy Daily Report</h1>
            </div>
          </div>

          <div className="inspection-heading__actions no-print">
            {isRoomBoy && (
              <button
                className={`button button--ghost notification-bell ${notificationsUnread > 0 ? "has-unread" : ""}`}
                type="button"
                onClick={markAllRoomBoyNotificationsRead}
                aria-label={`Notifications (${notificationsUnread})`}
              >
                <Icon name="bell" size={16} />
                {notificationsUnread > 0 && (
                  <span className="notification-badge">{notificationsUnread}</span>
                )}
              </button>
            )}
            <button
              className="button button--secondary"
              type="button"
              onClick={() => window.print()}
            >
              <Icon name="printer" size={15} />
              Print report
            </button>
          </div>
        </div>

        <p className="page-description">
          Record the rooms cleaned by the room boy, with time in, time out and
          signature for each room. Every entry is saved to the cloud as you type.
        </p>
      </div>

      <div className="inspection-toolbar">
        <div className="date-control">
          <button
            className="date-control__arrow"
            type="button"
            aria-label="Previous day"
            onClick={() => onDateChange(shiftDate(date, -1))}
          >
            <Icon name="chevronLeft" size={17} />
          </button>
          <label className="date-control__input">
            <span className="sr-only">Report date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value) onDateChange(event.target.value);
              }}
            />
          </label>
          <button
            className="date-control__arrow"
            type="button"
            aria-label="Next day"
            onClick={() => onDateChange(shiftDate(date, 1))}
          >
            <Icon name="chevronRight" size={17} />
          </button>
          <button
            className="button button--ghost"
            type="button"
            onClick={() => onDateChange(getTodayISO())}
            disabled={date === getTodayISO()}
          >
            Today
          </button>
        </div>

        <span className="toolbar-divider" />

        <div className="inspection-progress">
          <div className="inspection-progress__bar">
            <i
              style={{
                width: `${displayRooms.length ? Math.round((filledRooms / displayRooms.length) * 100) : 0}%`,
              }}
            />
          </div>
          <span>
            {filledRooms}/{displayRooms.length} rooms recorded
          </span>
        </div>

        <span
          className={`autosave-status autosave-status--${syncState}`}
          title={syncLabel}
        >
          <i />
          {syncLabel}
        </span>
      </div>

      {isRoomBoy && pendingAssignments.length > 0 ? (
        <section
          className="panel assignment-banner"
          aria-labelledby="pending-assignments-title"
        >
          <div className="panel-heading">
            <div>
              <h2 id="pending-assignments-title">New room assignments</h2>
              <p>
                Acknowledge to confirm you have seen the assignment. Time In
                only when you actually enter the room.
              </p>
            </div>
            <span className="panel-meta">
              {pendingAssignments.length} waiting
            </span>
          </div>
          <div className="assignment-banner__list">
            {pendingAssignments.map(({ room, entry }) => (
              <div className="assignment-banner__item" key={room}>
                <span className="assignment-banner__room">Room {room}</span>
                <span className="assignment-banner__remark">
                  {entry.assignment_remarks}
                </span>
                <button
                  className="button button--primary button--small"
                  type="button"
                  onClick={() => acknowledgeAssignment(room)}
                  disabled={Boolean(ackBusy[room])}
                >
                  {ackBusy[room] ? "Saving…" : "Acknowledge"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!isRoomBoy && roomBoyTiles.length > 0 ? (
        <section
          className="panel room-boy-roster"
          aria-labelledby="room-boy-roster-title"
        >
          <div className="panel-heading">
            <div>
              <h2 id="room-boy-roster-title">Room boys — {branch.code}</h2>
              <p>
                Open a room boy to read only their assigned rooms and progress
                for {formatDisplayDate(date)}.
              </p>
            </div>
            <span className="panel-meta">
              {roomBoyTiles.length} room boy
              {roomBoyTiles.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="room-boy-tiles">
            <button
              type="button"
              className={`room-boy-tile room-boy-tile--all${selectedRoomBoy ? "" : " is-active"}`}
              onClick={() => setSelectedRoomBoy("")}
              aria-pressed={!selectedRoomBoy}
            >
              <span className="room-boy-tile__avatar">ALL</span>
              <span className="room-boy-tile__name">All room boys</span>
              <span className="room-boy-tile__meta">
                {assignedRooms.length} room
                {assignedRooms.length === 1 ? "" : "s"} assigned
              </span>
            </button>
            {roomBoyTiles.map((tile) => (
              <button
                key={tile.name}
                type="button"
                className={`room-boy-tile${selectedRoomBoy === tile.name ? " is-active" : ""}`}
                onClick={() => setSelectedRoomBoy(tile.name)}
                aria-pressed={selectedRoomBoy === tile.name}
              >
                <span className="room-boy-tile__avatar">
                  {getInitials(tile.name)}
                </span>
                <span className="room-boy-tile__name">{tile.name}</span>
                <span className="room-boy-tile__meta">
                  {tile.total} room{tile.total === 1 ? "" : "s"} ·{" "}
                  {tile.completed} done
                </span>
                <span className="room-boy-tile__bar" aria-hidden="true">
                  <i
                    style={{
                      width: `${
                        tile.total
                          ? Math.round((tile.completed / tile.total) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </span>
                <span className="room-boy-tile__chips">
                  {tile.progress > 0 ? (
                    <em className="is-progress">{tile.progress} cleaning</em>
                  ) : null}
                  {tile.awaiting > 0 ? (
                    <em className="is-awaiting">{tile.awaiting} to inspect</em>
                  ) : null}
                  {tile.pending > 0 ? (
                    <em className="is-pending">{tile.pending} pending</em>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel room-boy-panel" aria-labelledby="room-boy-title">
        <div className="room-boy-sheet-head">
          <h1 id="room-boy-title">Room Boy Daily Report</h1>
          {!isRoomBoy && selectedRoomBoy ? (
            <p className="room-boy-print-name">
              Room Boy: <strong>{selectedRoomBoy}</strong> ·{" "}
              {formatDisplayDate(date)} · {branch.code}
            </p>
          ) : null}
          <div className="room-boy-meta">
            <label>
              <span>Name:</span>
              <input
                type="text"
                value={
                  !isRoomBoy && selectedRoomBoy ? selectedRoomBoy : sheet.name
                }
                placeholder="Room boy name"
                readOnly={isRoomBoy || Boolean(selectedRoomBoy)}
                disabled={isRoomBoy}
                onChange={(event) => setSheetField("name", event.target.value)}
              />
            </label>
            <label>
              <span>Date:</span>
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  if (event.target.value) onDateChange(event.target.value);
                }}
              />
            </label>
          </div>
        </div>

        {!isRoomBoy && selectedRoomBoy ? (
          <div className="room-boy-filter-note">
            <span>
              Showing <strong>{selectedRoomBoy}</strong>&apos;s rooms for{" "}
              {formatDisplayDate(date)}
            </span>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => setSelectedRoomBoy("")}
            >
              Show all room boys
            </button>
          </div>
        ) : null}

        {loading ? (
          <p className="settings-empty">Loading room boy report…</p>
        ) : displayRooms.length === 0 ? (
          <p className="settings-empty">
            {isRoomBoy
              ? "No rooms assigned to you yet. Your supervisor will assign cleaning tasks here."
              : selectedRoomBoy
                ? `No rooms assigned to ${selectedRoomBoy} on ${formatDisplayDate(date)}.`
                : "No rooms configured for this branch yet."}
          </p>
        ) : (
          <div className="table-wrap room-boy-table-wrap">
            <table className="room-boy-table">
              <thead>
                <tr>
                  <th>Room No.</th>
                  <th>Status</th>
                  {isRoomBoy ? (
                    <Fragment>
                      <th>Check In</th>
                      <th>Check Out</th>
                      <th>Action</th>
                    </Fragment>
                  ) : (
                    <Fragment>
                      <th>Time In</th>
                      <th>Time Out</th>
                      <th>Assigned To</th>
                    </Fragment>
                  )}
                  <th>Signature</th>
                </tr>
              </thead>
              <tbody>
                {displayRooms.map((room) => {
                    const entry = entries[room] ?? {};
                  const isCheckedIn = Boolean(entry.time_in);
                  const isCheckedOut = Boolean(entry.time_out);
                  return (
                    <tr key={room}>
                      <td className="room-boy-room">
                        {room}
                        {pms.upcomingCheckIns[room] && (
                          <span className="priority-badge" title={`Early check-in: ${formatLongDate(pms.upcomingCheckIns[room])}`}>
                            PRIORITY
                          </span>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          list="room-boy-status-options"
                          value={entry.status ?? ""}
                          placeholder="O/C"
                          onChange={(event) =>
                            setEntryField(room, "status", event.target.value)
                          }
                          aria-label={`Status for room ${room}`}
                        />
                        {entry.boy_status && (
                          <span className="boy-status-badge">
                            {getRoomBoyStatusLabel(entry.boy_status)}
                          </span>
                        )}
                        {entry.supervisor_rating && (
                          <span className="supervisor-rating-badge">
                            Rating: {entry.supervisor_rating}/5
                          </span>
                        )}
                        {entry.assignment_remarks && (
                          <div
                            className={`assignment-note ${entry.assignment_acknowledged_at ? "is-ack" : "is-pending"}`}
                          >
                            <span className="assignment-note__remark">
                              {entry.assignment_remarks}
                            </span>
                            {entry.assignment_acknowledged_at ? (
                              <small>Acknowledged</small>
                            ) : (
                              <small>Awaiting acknowledgement</small>
                            )}
                          </div>
                        )}
                      </td>
                      {isRoomBoy ? (
                        <Fragment>
                          <td>
                            {isCheckedIn ? (
                              <span className="time-value">{formatClock(entry.time_in)}</span>
                            ) : (
                              <button
                                className="button button--primary button--small"
                                type="button"
                                onClick={() => checkInRoom(room)}
                                disabled={isCheckedOut}
                                title="Only tap when you enter the room"
                              >
                                Time In
                              </button>
                            )}
                          </td>
                          <td>
                            {isCheckedOut ? (
                              <span className="time-value">{formatClock(entry.time_out)}</span>
                            ) : (
                              <button
                                className="button button--secondary button--small"
                                type="button"
                                onClick={() => checkOutRoom(room)}
                                disabled={!isCheckedIn}
                              >
                                Time Out
                              </button>
                            )}
                          </td>
                          <td>
                            {entry.boy_status ? (
                              <span
                                className={`status-badge status-badge--${getRoomBoyStatusTone(entry.boy_status)}`}
                              >
                                {getRoomBoyStatusLabel(entry.boy_status)}
                              </span>
                            ) : (
                              <span className="table-muted">Pending</span>
                            )}
                          </td>
                        </Fragment>
                      ) : (
                        <Fragment>
                          <td>
                            <input
                              type="time"
                              value={entry.time_in ?? ""}
                              onChange={(event) =>
                                setEntryField(room, "time_in", event.target.value)
                              }
                              aria-label={`Time in for room ${room}`}
                            />
                          </td>
                          <td>
                            <input
                              type="time"
                              value={entry.time_out ?? ""}
                              onChange={(event) =>
                                setEntryField(room, "time_out", event.target.value)
                              }
                              aria-label={`Time out for room ${room}`}
                            />
                          </td>
                          <td>
                            {entry.assigned_to ||
                            (entry.assigned_partners ?? []).length > 0 ? (
                              <span className="assigned-names">
                                {[
                                  entry.assigned_to,
                                  ...(entry.assigned_partners ?? []),
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                              </span>
                            ) : (
                              <span className="table-muted">—</span>
                            )}
                          </td>
                        </Fragment>
                      )}
                      <td>
                        <input
                          type="text"
                          value={entry.signature ?? ""}
                          placeholder="Name"
                          onChange={(event) =>
                            setEntryField(room, "signature", event.target.value)
                          }
                          aria-label={`Signature for room ${room}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <datalist id="room-boy-status-options">
          {roomBoyStatusOptions.map((status) => (
            <option key={status} value={status} />
          ))}
        </datalist>

        <div className="room-boy-signatures">
          <label>
            <span>Supervisor Sign:</span>
            <input
              type="text"
              value={getBranchSupervisorSignature(
                branch.code,
                sheet.supervisorSign,
              )}
              placeholder="Supervisor name / signature"
              readOnly
            />
          </label>
          <label>
            <span>BM Sign:</span>
            <input
              type="text"
              value={getBranchManagerSignature(branch.code, sheet.bmSign)}
              placeholder="Building manager name / signature"
              readOnly
            />
          </label>
        </div>
      </section>

      {isRoomBoy && (
        <>
          <section className="panel room-boy-notifications" aria-labelledby="notifications-title">
            <div className="panel-heading">
              <div>
                <h2 id="notifications-title">Notifications</h2>
                <p>
                  {notificationsUnread > 0
                    ? `${notificationsUnread} unread notification${notificationsUnread === 1 ? "" : "s"}`
                    : "All notifications marked done"}
                </p>
              </div>
              <span className="panel-meta">{notifications.length}</span>
            </div>
            {notifications.length === 0 ? (
              <p className="settings-empty">No notifications yet.</p>
            ) : (
              <div className="notifications-list">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`notification-item ${n.read_at ? "is-read" : "is-unread"}`}
                  >
                    <button
                      type="button"
                      className="notification-item__main"
                      onClick={() => setNotificationPopup(n)}
                    >
                      <span className="notification-item__meta">
                        <span className="notification-item__type">
                          {notificationTypeLabel(n.notification_type)}
                        </span>
                        <span className="notification-item__time">
                          {formatNotificationTime(n.created_at)}
                        </span>
                      </span>
                      <span className="notification-item__body">
                        {n.notification_type === "room_assigned" && (
                          <span className="notification-item__text">
                            Room <strong>{n.room_number}</strong> has been
                            assigned to you by{" "}
                            <strong>{n.supervisor_name ?? "Supervisor"}</strong>.
                            {n.remark ? (
                              <>
                                {" "}
                                Remark: <strong>{n.remark}</strong>
                              </>
                            ) : null}
                          </span>
                        )}
                        {n.notification_type === "rating_received" && (
                          <span className="notification-item__text">
                            You received a{" "}
                            <strong>rating of {n.rating}/5</strong> for cleaning
                            room <strong>{n.room_number}</strong>.
                            {n.rating_notes ? (
                              <>
                                <br />
                                <small>{n.rating_notes}</small>
                              </>
                            ) : null}
                            <br />
                            Inspected by{" "}
                            <strong>{n.supervisor_name ?? "Supervisor"}</strong>
                          </span>
                        )}
                        {n.notification_type !== "room_assigned" &&
                          n.notification_type !== "rating_received" && (
                            <span className="notification-item__text">
                              {n.message || n.title || "Notification"}
                            </span>
                          )}
                      </span>
                    </button>
                    <div className="notification-item__actions">
                      {n.read_at ? (
                        <span className="notification-done">Done</span>
                      ) : (
                        <button
                          type="button"
                          className="notification-dropdown__done"
                          onClick={() => markOneRoomBoyNotificationRead(n.id)}
                        >
                          Mark done
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel room-boy-performance" aria-labelledby="performance-title">
            <div className="panel-heading">
              <div>
                <h2 id="performance-title">Performance</h2>
                <p>Your supervisor ratings and cleaning performance.</p>
              </div>
              <span className="panel-meta">
                {ratings.length} rating{ratings.length === 1 ? "" : "s"}
              </span>
            </div>
            {ratings.length === 0 ? (
              <p className="settings-empty">
                No ratings yet. Your supervisor will rate your cleaning after
                inspection.
              </p>
            ) : (
              <>
                <div className="performance-stats">
                  <div className="performance-stat">
                    <span className="performance-stat__value">
                      {(
                        ratings.reduce(
                          (sum, r) => sum + Number(r.rating),
                          0,
                        ) / ratings.length
                      ).toFixed(1)}
                    </span>
                    <span className="performance-stat__label">Avg Rating</span>
                  </div>
                  <div className="performance-stat">
                    <span className="performance-stat__value">{ratings.length}</span>
                    <span className="performance-stat__label">Rooms Inspected</span>
                  </div>
                  <div className="performance-stat">
                    <span className="performance-stat__value">
                      {ratings.filter(
                        (r) => Number(r.rating) >= 4,
                      ).length}
                    </span>
                    <span className="performance-stat__label">4+ Star Rooms</span>
                  </div>
                </div>
                <div className="performance-list">
                  <table className="performance-table">
                    <thead>
                      <tr>
                        <th>Room</th>
                        <th>Rating</th>
                        <th>Inspector</th>
                        <th>Date</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ratings.map((r) => (
                        <tr key={r.created_at}>
                          <td>{r.room_number}</td>
                          <td>
                            <span className="rating-badge">
                              {r.rating}/5
                            </span>
                          </td>
                          <td>{r.supervisor_name ?? "Supervisor"}</td>
                          <td>
                            {new Date(r.created_at).toLocaleDateString([], {
                              month: "short",
                              day: "numeric",
                            })}
                          </td>
                          <td>{r.rating_notes ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}

      <footer className="workspace-footer">
        <span>Hamsun Log Book</span>
        <span>{branch.code} Branch · Room boy daily report</span>
      </footer>

      {notificationPopup ? (
        <NotificationPopup
          notification={notificationPopup}
          onClose={() => setNotificationPopup(null)}
          onDone={markOneRoomBoyNotificationRead}
        />
      ) : null}
    </main>
  );
}

function LinenWashingPage({ branch, date, onBack, onDateChange, profile }) {
  const canManageItems =
    profile?.role === "superadmin" ||
    profile?.role === "admin" ||
    profile?.role === "branch_manager";
  const [items, setItems] = useState([]);
  const [entries, setEntries] = useState({});
  const [sheet, setSheet] = useState({
    pending_linen: 0,
    pending_linen_receive: 0,
    supervisor_sign: getBranchSupervisorSignature(branch.code, ""),
    branch_manager_sign: getBranchManagerSignature(branch.code, ""),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [editingItem, setEditingItem] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [viewToDate, setViewToDate] = useState(date);
  const [fromDate, setFromDate] = useState(date);
  const [cumulative, setCumulative] = useState(null);
  const [cumulativeLoading, setCumulativeLoading] = useState(false);
  const dirtyRef = useRef(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listLinenItems(branch.code), listLinenWashing(branch.code, date)])
      .then(([itemRows, { items: rows, sheet: sh }]) => {
        if (cancelled) return;
        const names = itemRows.map((r) => r.name);
        setItems(names);
        const map = {};
        names.forEach((it) => {
          map[it] = { send: 0, receive: 0, pending: 0, id: itemRows.find((r) => r.name === it)?.id };
        });
        rows.forEach((r) => {
          if (map[r.item]) {
            map[r.item] = { send: r.send_qty, receive: r.receive_qty, pending: r.pending_qty, id: map[r.item].id };
          }
        });
        setEntries(map);
        if (sh) {
          setSheet({
            pending_linen: sh.pending_linen ?? 0,
            pending_linen_receive: sh.pending_linen_receive ?? 0,
            supervisor_sign: getBranchSupervisorSignature(branch.code, sh.supervisor_sign ?? ""),
            branch_manager_sign: getBranchManagerSignature(branch.code, sh.branch_manager_sign ?? ""),
          });
        } else {
          setSheet((s) => ({
            ...s,
            supervisor_sign: getBranchSupervisorSignature(branch.code, s.supervisor_sign),
            branch_manager_sign: getBranchManagerSignature(branch.code, s.branch_manager_sign),
          }));
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setItems(["Bath towel","Hand towel","Floor mat","Bad sheet","Duvet cover","Protector","Pillow cover","pending linen","pending linen Receive"]);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [branch.code, date]);

  // Auto-save (debounced) whenever entries or sheet change.
  useEffect(() => {
    if (loading) return;
    if (!dirtyRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      handleSave();
    }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sheet]);

  const handleAddItem = async () => {
    if (!newItemName.trim()) return;
    try {
      const row = await addLinenItem(branch.code, newItemName.trim());
      setItems((prev) => [...prev, row.name]);
      setEntries((prev) => ({ ...prev, [row.name]: { send: 0, receive: 0, pending: 0, id: row.id } }));
      setNewItemName("");
    } catch (err) {
      setNotice(err?.message || "Could not add item.");
    }
  };

  const handleRenameItem = async (oldName) => {
    if (!editingName.trim()) return;
    const id = entries[oldName]?.id;
    if (!id) return;
    try {
      await renameLinenItem(id, editingName.trim());
      setItems((prev) => prev.map((n) => (n === oldName ? editingName.trim() : n)));
      setEntries((prev) => {
        const next = { ...prev };
        const data = next[oldName];
        delete next[oldName];
        next[editingName.trim()] = data;
        return next;
      });
      setEditingItem(null);
      setEditingName("");
    } catch (err) {
      setNotice(err?.message || "Could not rename item.");
    }
  };

  const handleDeleteItem = async (name) => {
    const id = entries[name]?.id;
    if (!id) return;
    if (!window.confirm(`Remove "${name}" from the linen list?`)) return;
    try {
      await deleteLinenItem(id);
      setItems((prev) => prev.filter((n) => n !== name));
      setEntries((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    } catch (err) {
      setNotice(err?.message || "Could not delete item.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice("");
    dirtyRef.current = false;
    try {
      await Promise.all(
        items.map((item) => {
          const e = entries[item] ?? { send: 0, receive: 0, pending: 0 };
          return saveLinenWashingItem(branch.code, date, item, {
            send_qty: Number(e.send) || 0,
            receive_qty: Number(e.receive) || 0,
            pending_qty: Number(e.pending) || 0,
          });
        }),
      );
      await saveLinenWashingSheet(branch.code, date, {
        pending_linen: Number(sheet.pending_linen) || 0,
        pending_linen_receive: Number(sheet.pending_linen_receive) || 0,
        supervisor_sign: sheet.supervisor_sign || null,
        branch_manager_sign: sheet.branch_manager_sign || null,
      });
      setNotice("Saved.");
    } catch (err) {
      setNotice(err?.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  // Auto-save (debounced) whenever entries or sheet change.
  useEffect(() => {
    if (loading) return;
    if (!dirtyRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      handleSave();
    }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sheet]);

  const updateEntry = (item, field, value) => {
    setEntries((prev) => ({
      ...prev,
      [item]: { ...(prev[item] ?? { send: 0, receive: 0, pending: 0 }), [field]: value },
    }));
    dirtyRef.current = true;
  };

  // Cumulative view: aggregate send/receive/pending across the date range.
  useEffect(() => {
    if (!fromDate || !viewToDate) return;
    let cancelled = false;
    setCumulativeLoading(true);
    listLinenWashingRange(branch.code, fromDate, viewToDate)
      .then((rows) => {
        if (cancelled) return;
        const agg = {};
        items.forEach((it) => { agg[it] = { send: 0, receive: 0, pending: 0 }; });
        rows.forEach((r) => {
          if (!agg[r.item]) agg[r.item] = { send: 0, receive: 0, pending: 0 };
          agg[r.item].send += r.send_qty || 0;
          agg[r.item].receive += r.receive_qty || 0;
          agg[r.item].pending += r.pending_qty || 0;
        });
        setCumulative(agg);
        setCumulativeLoading(false);
      })
      .catch(() => {
        if (!cancelled) setCumulativeLoading(false);
      });
    return () => { cancelled = true; };
  }, [branch.code, fromDate, viewToDate]);

  return (
    <main className={`workspace workspace--${branch.tone}`}>
      <div className="branch-page-heading">
        <button className="back-link" type="button" onClick={onBack}>
          <Icon name="arrowLeft" size={15} />
          Back to {branch.code} Branch
        </button>
        <div className="branch-page-heading__row">
          <div className="branch-title">
            <span className="branch-title__badge">{branch.code}</span>
            <div>
              <p className="page-kicker">Housekeeping · Daily linen washing</p>
              <h1>Daily Linen Washing Send, Receive &amp; Pending Register</h1>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Date</h2>
          </div>
        </div>
        <div className="panel-body" style={{ padding: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Date:</span>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) onDateChange(e.target.value);
              }}
            />
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Date range (cumulative view)</h2>
            <p>See total send / receive / pending from "From" to "To".</p>
          </div>
        </div>
        <div className="panel-body" style={{ padding: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>From:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => { if (e.target.value) setFromDate(e.target.value); }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>To:</span>
            <input
              type="date"
              value={viewToDate}
              onChange={(e) => { if (e.target.value) setViewToDate(e.target.value); }}
            />
          </label>
        </div>
        {cumulativeLoading ? (
          <div style={{ padding: 16 }} className="table-muted">Loading…</div>
        ) : cumulative ? (
          <div className="table-wrap" style={{ overflowX: "auto" }}>
            <table className="inspection-table" style={{ minWidth: 500 }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Total Send</th>
                  <th>Total Receive</th>
                  <th>Total Pending</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const c = cumulative[item] ?? { send: 0, receive: 0, pending: 0 };
                  return (
                    <tr key={item}>
                      <td style={{ fontWeight: 600 }}>{item}</td>
                      <td>{c.send}</td>
                      <td>{c.receive}</td>
                      <td>{c.pending}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Linen items</h2>
            <p>Enter quantities sent to washing and received back.</p>
          </div>
        </div>
        <div className="table-wrap" style={{ overflowX: "auto" }}>
          <table className="inspection-table" style={{ minWidth: 700 }}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Send</th>
                <th>Receive</th>
                <th>Pending</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const e = entries[item] ?? { send: 0, receive: 0, pending: 0 };
                return (
                  <tr key={item}>
                    <td style={{ fontWeight: 600 }}>{item}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={e.send}
                        onChange={(ev) => updateEntry(item, "send", ev.target.value)}
                        style={{ width: 80 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={e.receive}
                        onChange={(ev) => updateEntry(item, "receive", ev.target.value)}
                        style={{ width: 80 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={e.pending}
                        onChange={(ev) => updateEntry(item, "pending", ev.target.value)}
                        style={{ width: 80 }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Pending linen (overall)</h2>
          </div>
        </div>
        <div className="panel-body" style={{ padding: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Pending linen:</span>
            <input
              type="number"
              min="0"
              value={sheet.pending_linen}
              onChange={(e) => { setSheet((s) => ({ ...s, pending_linen: e.target.value })); dirtyRef.current = true; }}
              style={{ width: 80 }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Pending linen receive:</span>
            <input
              type="number"
              min="0"
              value={sheet.pending_linen_receive}
              onChange={(e) => { setSheet((s) => ({ ...s, pending_linen_receive: e.target.value })); dirtyRef.current = true; }}
              style={{ width: 80 }}
            />
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Verification</h2>
          </div>
        </div>
        <div className="panel-body" style={{ padding: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>HK Supervisor:</span>
            <input
              type="text"
              value={sheet.supervisor_sign}
              readOnly
              style={{ width: 180, background: "var(--surface-2)" }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Branch Manager:</span>
            <input
              type="text"
              value={sheet.branch_manager_sign}
              readOnly
              style={{ width: 180, background: "var(--surface-2)" }}
            />
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
        <button
          className="button button--primary"
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
        >
          {saving ? "Saving…" : "Save register"}
        </button>
        {notice ? <span className="table-muted">{notice}</span> : null}
      </div>

      <footer className="workspace-footer">
        <span>Hamsun Log Book</span>
        <span>Daily linen washing register</span>
      </footer>
    </main>
  );
}

function FnbLogPage({
  branch,
  checklist,
  period,
  onBack,
  onPeriodChange,
  profile,
}) {
  const isMonth = checklist.period === "month";
  const makeEmptyRow = () =>
    Object.fromEntries(checklist.columns.map((column) => [column.key, ""]));
  const [rows, setRows] = useState(() => [makeEmptyRow()]);
  const [syncState, setSyncState] = useState("loading");
  const [lastSaved, setLastSaved] = useState(null);
  const rowsRef = useRef(rows);
  const dirtyRef = useRef(false);
  const saveTimer = useRef(null);
  const sortedRows = [...rows].filter((r) => r.item);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    dirtyRef.current = false;
    setSyncState("loading");

    getFnbLog(branch.code, checklist.id, period)
      .then((record) => {
        if (cancelled) return;
        let nextRows =
          Array.isArray(record?.rows) && record.rows.length > 0
            ? record.rows
            : checklist.id === "utensils"
              ? utensilItemNames.map((name) => ({ ...makeEmptyRow(), item: name }))
              : [makeEmptyRow()];
        // Backfill item names for utensils rows that have empty items.
        if (checklist.id === "utensils") {
          nextRows = nextRows.map((row, index) => {
            if (!row.item && utensilItemNames[index]) {
              return { ...row, item: utensilItemNames[index] };
            }
            return row;
          });
        }
        rowsRef.current = nextRows;
        setRows(nextRows);
        setLastSaved(record?.updated_at ?? null);
        setSyncState("saved");
      })
      .catch(() => {
        if (!cancelled) {
          let errorRows =
            checklist.id === "utensils"
              ? utensilItemNames.map((name) => ({ ...makeEmptyRow(), item: name }))
              : [makeEmptyRow()];
          rowsRef.current = errorRows;
          setRows(errorRows);
          setSyncState("error");
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.code, checklist.id, period]);

  useEffect(() => {
    if (!dirtyRef.current) return undefined;
    setSyncState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveFnbLog(
        branch.code,
        checklist.id,
        period,
        rowsRef.current,
        profile?.full_name || profile?.email || "FnB team",
      )
        .then((record) => {
          dirtyRef.current = false;
          setLastSaved(record?.updated_at ?? new Date().toISOString());
          setSyncState("saved");
        })
        .catch(() => setSyncState("error"));
    }, 600);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, branch.code, checklist.id, period]);

  const updateCell = (rowIndex, key, value) => {
    dirtyRef.current = true;
    setRows((previous) =>
      previous.map((row, index) =>
        index === rowIndex ? { ...row, [key]: value } : row,
      ),
    );
  };

  const addRow = () => {
    dirtyRef.current = true;
    setRows((previous) => [...previous, makeEmptyRow()]);
  };

  const removeRow = (rowIndex) => {
    dirtyRef.current = true;
    setRows((previous) => previous.filter((_, index) => index !== rowIndex));
  };

  const refresh = async () => {
    try {
      setSyncState("loading");
      const record = await getFnbLog(branch.code, checklist.id, period);
      const nextRows =
        Array.isArray(record?.rows) && record.rows.length > 0
          ? record.rows
          : [makeEmptyRow()];
      dirtyRef.current = false;
      rowsRef.current = nextRows;
      setRows(nextRows);
      setLastSaved(record?.updated_at ?? null);
      setSyncState("saved");
    } catch {
      setSyncState("error");
    }
  };

  const syncLabel =
    syncState === "loading"
      ? "Loading from Hamsun cloud…"
      : syncState === "saving"
        ? "Saving to Hamsun cloud…"
        : syncState === "error"
          ? "Could not save — retry"
          : lastSaved
            ? `Saved ${formatSyncTime(lastSaved)}`
            : "Saved to Hamsun cloud";

  const periodLabel = isMonth ? formatDisplayMonth(period) : formatDisplayDate(period);

  return (
    <main className={`workspace workspace--${branch.tone}`}>
      <div className="inspection-heading">
        <button className="back-link" type="button" onClick={onBack}>
          <Icon name="arrowLeft" size={15} />
          Back to {branch.code} Branch
        </button>

        <div className="inspection-heading__row">
          <div className="branch-title">
            <span className="branch-title__badge">{branch.code}</span>
            <div>
              <p className="page-kicker">
                Food &amp; Beverages · {periodLabel}
              </p>
              <h1>{checklist.title}</h1>
            </div>
          </div>

          <div className="inspection-heading__actions no-print">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => window.print()}
            >
              <Icon name="printer" size={15} />
              Print log
            </button>
          </div>
        </div>

        <p className="page-description">{checklist.description}</p>

        <div className="print-summary">
          <span>Branch: {branch.code}</span>
          <span>
            {isMonth ? "Month" : "Date"}: {periodLabel}
          </span>
          <span>Department: Food &amp; Beverages</span>
        </div>
      </div>

      <div className="inspection-toolbar no-print">
        <div className="date-control">
          <button
            className="date-control__arrow"
            type="button"
            aria-label={isMonth ? "Previous month" : "Previous day"}
            onClick={() =>
              onPeriodChange(
                isMonth ? shiftMonth(period, -1) : shiftDate(period, -1),
              )
            }
          >
            <Icon name="chevronLeft" size={17} />
          </button>
          <label className="date-control__input">
            <span className="sr-only">
              {isMonth ? "Register month" : "Log date"}
            </span>
            <input
              type={isMonth ? "month" : "date"}
              value={period}
              onChange={(event) => {
                if (event.target.value) onPeriodChange(event.target.value);
              }}
            />
          </label>
          <button
            className="date-control__arrow"
            type="button"
            aria-label={isMonth ? "Next month" : "Next day"}
            onClick={() =>
              onPeriodChange(
                isMonth ? shiftMonth(period, 1) : shiftDate(period, 1),
              )
            }
          >
            <Icon name="chevronRight" size={17} />
          </button>
          <button
            className="button button--ghost"
            type="button"
            onClick={() =>
              onPeriodChange(isMonth ? getCurrentMonth() : getTodayISO())
            }
            disabled={period === (isMonth ? getCurrentMonth() : getTodayISO())}
          >
            {isMonth ? "This month" : "Today"}
          </button>
        </div>

        <span className="toolbar-divider" />

        <button
          className="button button--ghost button--small"
          type="button"
          onClick={addRow}
        >
          <Icon name="plus" size={14} />
          Add row
        </button>

        <button
          className="button button--ghost button--small"
          type="button"
          onClick={refresh}
        >
          <Icon name="refresh" size={14} />
          Refresh
        </button>

        <span className={`autosave-status autosave-status--${syncState}`}>
          <i />
          {syncLabel}
        </span>
      </div>

      <section className="panel" aria-labelledby="fnb-log-title">
        <div className="panel-heading">
          <div>
            <h2 id="fnb-log-title">
              {branch.code} · {checklist.title}
            </h2>
            <p>{periodLabel}</p>
          </div>
          <span className="panel-meta">
            {rows.length} row{rows.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="table-wrap">
          <table className="inspection-table fnb-table">
            <thead>
              <tr>
                <th className="fnb-row-number">#</th>
                {checklist.columns.map((column) => (
                  <th
                    key={column.key}
                    style={{ minWidth: column.width || "150px" }}
                  >
                    {column.label}
                  </th>
                ))}
                <th className="fnb-row-actions no-print" aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    className="settings-empty"
                    colSpan={checklist.columns.length + 2}
                  >
                    No rows yet. Use “Add row” to start this log.
                  </td>
                </tr>
              ) : (
                rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td className="fnb-row-number">{rowIndex + 1}</td>
                    {checklist.columns.map((column) => (
                      <td key={column.key}>
                        <input
                          className="fnb-input"
                          type={column.type || "text"}
                          value={row[column.key] ?? ""}
                          placeholder={column.placeholder || ""}
                          onChange={(event) =>
                            updateCell(rowIndex, column.key, event.target.value)
                          }
                        />
                      </td>
                    ))}
                    <td className="fnb-row-actions no-print">
                      <button
                        className="icon-button fnb-remove"
                        type="button"
                        aria-label={`Remove row ${rowIndex + 1}`}
                        title="Remove row"
                        onClick={() => removeRow(rowIndex)}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {checklist.id === "utensils" && (
            <div className="utensils-summary no-print">
              <h3>Monthly Summary</h3>
              <div className="summary-row">
                <span className="summary-label">Items below par at close:</span>
                <span className="summary-value">
                  {sortedRows.filter(
                    (r) =>
                      Number(r.closing || 0) < Number(r.par_qty || 0),
                  ).length}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">
                  Net change this month (closing − opening):
                </span>
                <span className="summary-value">
                  {sortedRows.reduce(
                    (acc, r) =>
                      acc +
                      (Number(r.closing || 0) - Number(r.opening || 0)),
                    0,
                  )}
                </span>
              </div>
              <div className="summary-row summary-row--total">
                <span className="summary-label">Total loss value (PKR):</span>
                <span className="summary-value">
                  {sortedRows.reduce(
                    (acc, r) => acc + Number(r.loss_pkr || 0),
                    0,
                  )}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      <footer className="workspace-footer">
        <span>Hamsun Log Book</span>
        <span>
          {branch.code} Branch · Food &amp; Beverages · {periodLabel}
        </span>
      </footer>
    </main>
  );
}

const breakfastItems = [
  { key: "tea", label: "Tea" },
  { key: "coffee", label: "Coffee" },
  { key: "juice", label: "Juice" },
  { key: "toast", label: "Toast" },
  { key: "eggs", label: "Eggs" },
  { key: "cereal", label: "Cereal" },
  { key: "fruit", label: "Fruit" },
  { key: "yogurt", label: "Yogurt" },
  { key: "other", label: "Other" },
];

// PMS item notes are one long string separated by a bullet glyph. Split them
// so the page can show the guest's real choices (oil, omelette, bread, drinks…).
const PMS_NOTE_SPLIT = /\s*[•·\u2022\uFFFD]\s*/;

function splitPmsNotes(notes) {
  return String(notes ?? "")
    .split(PMS_NOTE_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
}

function getOrderItems(order) {
  const pmsItems = Array.isArray(order?.pms_items) ? order.pms_items : [];
  if (pmsItems.length > 0) {
    return pmsItems.map((item, index) => {
      const label = String(item?.name ?? "").trim() || `Item ${index + 1}`;
      return {
        key: `pms:${index}:${label}`,
        label,
        notes: splitPmsNotes(item?.notes),
      };
    });
  }
  return breakfastItems.map((item) => ({ ...item, notes: [] }));
}

function hasPmsOrder(order) {
  return Array.isArray(order?.pms_items) && order.pms_items.length > 0;
}

function getOrderTime(order) {
  return order?.pms_order_time || order?.order_time || "";
}

function parseTimeToMinutes(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = (match[3] || "").toUpperCase();
  if (suffix === "PM" && hours < 12) hours += 12;
  if (suffix === "AM" && hours === 12) hours = 0;
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function compareBreakfastOrders(a, b) {
  const aTime = parseTimeToMinutes(getOrderTime(a));
  const bTime = parseTimeToMinutes(getOrderTime(b));

  // Rooms with no breakfast form go to the end.
  if (aTime === null && bTime === null) {
    return String(a.room_number).localeCompare(String(b.room_number), undefined, {
      numeric: true,
    });
  }
  if (aTime === null) return 1;
  if (bTime === null) return -1;
  if (aTime !== bTime) return aTime - bTime;
  return String(a.room_number).localeCompare(String(b.room_number), undefined, {
    numeric: true,
  });
}

const utensilItemNames = [
  "Square dinner plates",
  "Dinner plates",
  "Quarter plates",
  "Ramekins (M)",
  "Ramekins (S)",
  "Butter knives",
  "Forks",
  "Table spoons",
  "Tea spoons",
  "Tray (XXL)",
  "Tray (XL)",
  "Tray (L)",
  "Tray (M)",
  "Tray (S)",
];

function BreakfastOrderPage({
  branch,
  date,
  profile,
  onBack,
  onDateChange,
}) {
  const isFnb = profile?.role === "fnb_manager";
  const isSuperadmin = profile?.role === "superadmin";
  const isTrayCollector = profile?.role === "tray_collector";
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState("saved");
  const ordersRef = useRef(orders);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    let cancelled = false;
    const roomNumbers = roomLists[branch.code] ?? [];
    const initOrders = roomNumbers.map((roomNumber) => ({
      id: null,
      branch_code: branch.code,
      room_number: roomNumber,
      order_date: date,
      order_time: null,
      items_checklist: [],
      items_verified: false,
      sent_at: null,
      tray_collected: false,
      tray_collected_at: null,
      created_by_name: null,
      updated_by_name: null,
      created_at: null,
      updated_at: null,
      pms_order_id: null,
      pms_guest_name: null,
    }));

    setLoading(true);
    const loadData = async () => {
      try {
        // Load portal orders
        const portalOrders = await listBreakfastOrders(branch.code, date);

        // Load PMS data (breakfast orders come from the PMS kitchen RPC)
        const pmsResult = await fetchPmsBreakfast(branch.code, date);
        const pmsOrders = pmsResult.orders;

        if (cancelled) return;

        // Merge portal + PMS orders onto the full room list.
        const portalMap = new Map(
          (portalOrders || []).map((order) => [
            String(order.room_number),
            order,
          ]),
        );
        const pmsMap = new Map(
          (pmsOrders || []).map((order) => [
            String(order.room_number),
            order,
          ]),
        );

        const mergedOrders = initOrders.map((base) => {
          const portalOrder = portalMap.get(String(base.room_number));
          const pmsOrder = pmsMap.get(String(base.room_number));
          return {
            ...base,
            ...(portalOrder ?? {}),
            pms_order_id:
              pmsOrder?.request_id ?? portalOrder?.pms_order_id ?? null,
            pms_guest_name:
              pmsOrder?.guest_name ?? portalOrder?.pms_guest_name ?? null,
            pms_order_time:
              pmsOrder?.slot_label ?? portalOrder?.pms_order_time ?? null,
            pms_items: pmsOrder?.items ?? portalOrder?.pms_items ?? [],
            pms_status: pmsOrder?.status ?? portalOrder?.pms_status ?? null,
          };
        });

        // Include PMS rooms that are not on the static room list.
        const baseTemplate =
          initOrders[0] ?? {
            id: null,
            branch_code: branch.code,
            order_date: date,
            order_time: null,
            items_checklist: [],
            items_verified: false,
            sent_at: null,
            tray_collected: false,
            tray_collected_at: null,
            created_by_name: null,
            updated_by_name: null,
            created_at: null,
            updated_at: null,
          };

        (pmsOrders || []).forEach((pmsOrder) => {
          const roomNumber = String(pmsOrder.room_number);
          if (
            mergedOrders.some(
              (order) => String(order.room_number) === roomNumber,
            )
          ) {
            return;
          }
          mergedOrders.push({
            ...baseTemplate,
            id: null,
            room_number: roomNumber,
            pms_order_id: pmsOrder.request_id ?? null,
            pms_guest_name: pmsOrder.guest_name ?? null,
            pms_order_time: pmsOrder.slot_label ?? null,
            pms_items: pmsOrder.items ?? [],
            pms_status: pmsOrder.status ?? null,
          });
        });

        setOrders(mergedOrders);
        setLoading(false);
      } catch (error) {
        console.error("Failed to load breakfast orders:", error);
        if (cancelled) return;
        setOrders(initOrders);
        setLoading(false);
      }
    };

    loadData();

    return () => {
      cancelled = true;
    };
  }, [branch.code, date]);

  const saveOrder = async (order) => {
    try {
      setSyncState("saving");
      await saveBreakfastOrder(
        branch.code,
        order.room_number,
        date,
        {
          order_time: order.order_time,
          items_checklist: order.items_checklist,
          items_verified: order.items_verified,
          sent_at: order.sent_at,
          tray_collected: order.tray_collected,
          tray_collected_at: order.tray_collected_at,
        },
        profile?.full_name || profile?.email,
      );
      setSyncState("saved");
    } catch {
      setSyncState("error");
      setTimeout(() => setSyncState("saved"), 2000);
    }
  };

  const toggleItem = (orderIndex, itemKey) => {
    const next = orders.map((o, i) => {
      if (i !== orderIndex) return o;
      const checklist = [...(o.items_checklist ?? [])];
      const idx = checklist.indexOf(itemKey);
      if (idx >= 0) checklist.splice(idx, 1);
      else checklist.push(itemKey);
      const targetItems = getOrderItems(o);
      return {
        ...o,
        items_checklist: checklist,
        items_verified:
          targetItems.length > 0 && checklist.length >= targetItems.length,
      };
    });
    ordersRef.current = next;
    setOrders(next);
    saveOrder(next[orderIndex]);
  };

  const toggleSent = (orderIndex) => {
    const next = orders.map((o, i) => {
      if (i !== orderIndex) return o;
      return {
        ...o,
        sent_at: o.sent_at ? null : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true }),
      };
    });
    ordersRef.current = next;
    setOrders(next);
    saveOrder(next[orderIndex]);
  };

  const toggleTray = (orderIndex) => {
    const next = orders.map((o, i) => {
      if (i !== orderIndex) return o;
      return {
        ...o,
        tray_collected: !o.tray_collected,
        tray_collected_at: o.tray_collected
          ? null
          : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true }),
      };
    });
    ordersRef.current = next;
    setOrders(next);
    saveOrder(next[orderIndex]);
  };

  const sortedOrders = [...orders].sort(compareBreakfastOrders);

  const orderCount = sortedOrders.filter(hasPmsOrder).length;
  const pendingCount = sortedOrders.filter(
    (o) => hasPmsOrder(o) && !o.sent_at,
  ).length;
  const trayCount = sortedOrders.filter(
    (o) => hasPmsOrder(o) && o.sent_at && !o.tray_collected,
  ).length;

  return (
    <main className={`workspace workspace--${branch.tone}`}>
      <div className="inspection-heading">
        <button className="back-link" type="button" onClick={onBack}>
          <Icon name="arrowLeft" size={15} />
          Back to {branch.code} Branch
        </button>
        <div className="inspection-heading__row">
          <div className="branch-title">
            <span className="branch-title__badge">{branch.code}</span>
            <div>
              <p className="page-kicker">
                Food &amp; Beverages · {formatDisplayDate(date)}
              </p>
              <h1>Breakfast Orders</h1>
            </div>
          </div>
          <div className="inspection-heading__actions no-print">
            {isTrayCollector ? null : (
              <button
                className="button button--secondary"
                type="button"
                onClick={() => window.print()}
              >
                <Icon name="printer" size={15} />
                Print sheet
              </button>
            )}
          </div>
        </div>
        <p className="page-description">
          {isTrayCollector
            ? "Trays ready for collection: rooms where breakfast was sent but tray not yet collected."
            : "Room breakfast orders sorted by earliest time. Check items as verified, mark sent when delivered, and tray collector collects trays."}
        </p>
        <div className="inspection-toolbar no-print">
          <div className="breakfast-date-controls">
            <label>
              <span>Breakfast date</span>
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  const nextDate = event.target.value;
                  if (nextDate) onDateChange?.(nextDate);
                }}
              />
            </label>
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={() => onDateChange?.(getTodayISO())}
            >
              Today
            </button>
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={() => onDateChange?.(shiftDate(date, 1))}
            >
              Tomorrow
            </button>
          </div>
          <span className="toolbar-divider" />
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#b42318" }}>
            {pendingCount} pending
          </span>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#d97706" }}>
            {trayCount} trays to collect
          </span>
          <span className={`autosave-status autosave-status--${syncState}`}>
            <i />
            {syncState === "saving" ? "Saving…" : "Saved"}
          </span>
        </div>
      </div>

      <section className="panel" aria-labelledby="breakfast-title">
        <div className="panel-heading">
          <div>
            <h2 id="breakfast-title">
              {branch.code} · Breakfast Orders
            </h2>
            <p>{formatDisplayDate(date)}</p>
          </div>
          <span className="panel-meta">
            {orderCount} order{orderCount === 1 ? "" : "s"} ·{" "}
            {sortedOrders.length} room{sortedOrders.length === 1 ? "" : "s"}
          </span>
        </div>

        {loading ? (
          <p className="settings-empty">Loading breakfast orders…</p>
        ) : (
          <div className="table-wrap">
            <table className="inspection-table breakfast-table">
              <thead>
                <tr>
                  <th style={{ minWidth: "90px" }}>Room</th>
                  <th style={{ minWidth: "100px" }}>Order Time</th>
                  <th style={{ minWidth: "100px" }}>PMS Order Time</th>
                  <th>Guest</th>
                  <th style={{ minWidth: "160px" }}>PMS Items</th>
                  <th>Items Verified</th>
                  <th style={{ minWidth: "110px" }}>Sent / Out Time</th>
                  <th style={{ minWidth: "110px" }}>Tray Collected</th>
                  <th className="no-print" style={{ width: "60px" }} />
                </tr>
              </thead>
              <tbody>
                {sortedOrders.length === 0 ? (
                  <tr>
                    <td
                      className="settings-empty"
                      colSpan={9}
                    >
                      No breakfast orders for {formatDisplayDate(date)}.
                    </td>
                  </tr>
                ) : (
                  sortedOrders.map((order, orderIndex) => {
                    const hasForm = hasPmsOrder(order);
                    return (
                    <tr key={order.id ?? order.room_number}>
                      <td>
                        <strong>{order.room_number}</strong>
                      </td>
                      <td>
                        {formatClock(order.order_time)}
                      </td>
                      <td>
                        {order.pms_order_time ? formatClock(order.pms_order_time) : (
                          <em style={{ color: "#a3adb6" }}>—</em>
                        )}
                      </td>
                      <td>
                        {order.pms_guest_name || (
                          <em style={{ color: "#a3adb6" }}>—</em>
                        )}
                      </td>
                      <td>
                        {Array.isArray(order.pms_items) &&
                        order.pms_items.length > 0 ? (
                          <div className="breakfast-pms-items">
                            {order.pms_items.map((item, itemIndex) => {
                              const notes = splitPmsNotes(item?.notes);
                              return (
                                <div
                                  className="breakfast-pms-item"
                                  key={itemIndex}
                                >
                                  <strong>
                                    {item?.name || `Item ${itemIndex + 1}`}
                                  </strong>
                                  {notes.length > 0 ? (
                                    <ul>
                                      {notes.map((note, noteIndex) => (
                                        <li key={noteIndex}>{note}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </div>
                              );
                            })}
                            {order.pms_status ? (
                              <span className="breakfast-pms-status">
                                {order.pms_status}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <em style={{ color: "#a3adb6" }}>—</em>
                        )}
                      </td>
                      <td>
                        {hasForm ? (
                          <div className="breakfast-items">
                            {getOrderItems(order).map((item) => (
                              <label
                                key={item.key}
                                className="breakfast-item-label"
                                title={
                                  item.notes.length > 0
                                    ? `${item.label} — ${item.notes.join(" · ")}`
                                    : item.label
                                }
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    (order.items_checklist ?? []).includes(
                                      item.key,
                                    )
                                  }
                                  onChange={() =>
                                    toggleItem(orderIndex, item.key)
                                  }
                                  disabled={isTrayCollector}
                                />
                                <span className="breakfast-item-text">
                                  <strong>{item.label}</strong>
                                  {item.notes.map((note, noteIndex) => (
                                    <small key={noteIndex}>{note}</small>
                                  ))}
                                </span>
                              </label>
                            ))}
                            {(order.items_checklist ?? []).length > 0 && (
                              <span
                                className={
                                  order.items_verified
                                    ? "breakfast-verified"
                                    : "breakfast-partial"
                                }
                              >
                                {order.items_verified ? "Done" : "Pending"}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="breakfast-not-filled">
                            Form not filled…
                          </span>
                        )}
                      </td>
                      <td>
                        {hasForm ? (
                          order.sent_at ? (
                            <span className="breakfast-sent">
                              {order.sent_at}
                              <button
                                className="icon-button breakfast-undo"
                                type="button"
                                title="Undo sent"
                                onClick={() => toggleSent(orderIndex)}
                                disabled={isTrayCollector}
                              >
                                <Icon name="close" size={12} />
                              </button>
                            </span>
                          ) : (
                            <button
                              className="button button--ghost button--small breakfast-send"
                              type="button"
                              onClick={() => toggleSent(orderIndex)}
                              disabled={isTrayCollector}
                            >
                              <Icon name="check" size={13} />
                              Send
                            </button>
                          )
                        ) : (
                          <em style={{ color: "#a3adb6" }}>—</em>
                        )}
                      </td>
                      <td>
                        {hasForm ? (
                          order.tray_collected ? (
                            <span className="breakfast-tray-done">
                              {order.tray_collected_at || "collected"}
                              <button
                                className="icon-button breakfast-undo"
                                type="button"
                                title="Undo tray collected"
                                onClick={() => toggleTray(orderIndex)}
                                disabled={!isTrayCollector}
                              >
                                <Icon name="close" size={12} />
                              </button>
                            </span>
                          ) : (
                            <button
                              className="button button--ghost button--small breakfast-tray"
                              type="button"
                              onClick={() => toggleTray(orderIndex)}
                              disabled={
                                isTrayCollector ? false : !order.sent_at
                              }
                            >
                              <Icon name="arrowUpRight" size={13} />
                              {isTrayCollector ? "Collect" : "Tray"}
                            </button>
                          )
                        ) : (
                          <em style={{ color: "#a3adb6" }}>—</em>
                        )}
                      </td>
                      <td className="no-print" />
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="workspace-footer">
        <span>Hamsun Log Book</span>
        <span>
          {branch.code} Branch · Breakfast · {formatDisplayDate(date)}
        </span>
      </footer>
    </main>
  );
}

function SuperAdminView({ profile, onBack, onSelectBranch }) {
  const depts = [
    { code: "housekeeping", name: "Housekeeping" },
    { code: "food_beverages", name: "Food & Beverages" },
  ];
  const [testMessage, setTestMessage] = useState("Test notification from Super Admin");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const sendTestNotification = async () => {
    setTestSending(true);
    setTestResult(null);
    try {
      const staff = await listStaff();
      const allStaff = staff.filter((s) => s.is_active);

      let sent = 0;
      let failed = 0;
      for (const person of allStaff) {
        try {
          await createStaffNotification({
            staffEmail: person.email,
            staffRole: person.role,
            notificationType: "test_notification",
            title: "Test Notification from Super Admin",
            message: testMessage || "Test notification from Super Admin",
            branchCode: person.branch_code ?? null,
          });
          sent++;
        } catch {
          failed++;
        }
      }

      setTestResult({ sent, failed, total: allStaff.length });
    } catch {
      setTestResult({ sent: 0, failed: -1, total: 0 });
    } finally {
      setTestSending(false);
    }
  };

  return (
    <main className="workspace workspace--fsl">
      <div className="inspection-heading">
        <button className="back-link" type="button" onClick={onBack}>
          <Icon name="arrowLeft" size={15} />
          Back to Dashboard
        </button>
        <div className="inspection-heading__row">
          <div className="branch-title">
            <div>
              <p className="page-kicker">Super Admin Dashboard</p>
              <h1>All Departments & Branches</h1>
            </div>
          </div>
        </div>
        <p className="page-description">
          Manage all Hamsun departments and branches from one portal.
        </p>
      </div>

      <div className="inspection-toolbar">
        <div className="inspection-progress">
          <div className="inspection-progress__bar">
            <i style={{ width: "100%" }} />
          </div>
          <span>All departments active</span>
        </div>
      </div>

      <section className="panel department-list-panel">
        <div className="panel-heading">
          <div>
            <h2>Departments</h2>
            <p>View and manage all Hamsun departments and branch log books.</p>
          </div>
        </div>
        <div className="department-list">
          {depts.map((dept) => {
            // Super admin sees all branches under both department cards.
            const deptBranches = branches;
            return (
              <div key={dept.code} className="department-card">
                <div className="department-header">
                  <span className="department-icon">
                    <Icon
                      name={
                        dept.code === "housekeeping" ? "spray" : "utensils"
                      }
                      size={20}
                    />
                  </span>
                  <div className="department-info">
                    <strong>{dept.name}</strong>
                    <p>{deptBranches.length} branches</p>
                  </div>
                  <span className="department-count">
                    {deptBranches.length}
                  </span>
                </div>
                <div className="department-branches">
                  {deptBranches.map((branch) => (
                    <button
                      key={branch.code}
                      className="department-branch-btn"
                      type="button"
                      onClick={() => onSelectBranch(branch)}
                    >
                      <span className="branch-name">{branch.code} Branch</span>
                      <span className="open-btn">Open</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel test-notification-panel">
        <div className="panel-heading">
          <div>
            <h2>Test Device Notifications</h2>
            <p>
              Send a test notification to every staff member's device. Each
              person will receive a device notification with a bell sound when
              they open the app.
            </p>
          </div>
        </div>
        <div className="test-notification-form">
          <label>
            <span>Message:</span>
            <input
              type="text"
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder="Enter test message"
            />
          </label>
          <button
            className={`button button--primary ${testSending ? "button--disabled" : ""}`}
            type="button"
            onClick={sendTestNotification}
            disabled={testSending}
          >
            {testSending ? "Sending…" : "Send Test Notification to All Staff"}
          </button>
        </div>
        {testResult && (
          <div className="test-notification-result">
            <span className="result-label">Result:</span>
            <span className="result-value">
              {testResult.sent} sent
              {testResult.failed > 0 && `, ${testResult.failed} failed`}
              (of {testResult.total} staff)
            </span>
          </div>
        )}
      </section>

      <footer className="workspace-footer">
        <span>Hamsun Log Book</span>
        <span>Super Admin · All Departments</span>
      </footer>
    </main>
  );
}

function FnBManagerView({ profile, onBack, onSelectBranch }) {
  return (
    <main className="workspace workspace--ext">
      <div className="inspection-heading">
        <div className="inspection-heading__row">
          <div className="branch-title">
            <div>
              <p className="page-kicker">Food &amp; Beverages Department</p>
              <h1>FnB Log Book</h1>
            </div>
          </div>
        </div>
        <p className="page-description">
          Breakfast, utensils and crockery, wastage, deep cleaning and
          fumigation logs for every branch.
        </p>
      </div>

      <div className="inspection-toolbar">
        <div className="inspection-progress">
          <div className="inspection-progress__bar">
            <i style={{ width: "100%" }} />
          </div>
          <span>{branches.length} branches · 5 FnB logs each</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>FnB Branches</h2>
            <p>Each branch keeps its own FnB registers and daily logs.</p>
          </div>
        </div>
        <div className="branch-grid">
          {branches.map((branch) => (
            <div key={branch.code} className="stat-card">
              <div className="stat-card__icon">
                <Icon name="utensils" size={24} />
              </div>
              <div className="stat-card__body">
                <strong>{branch.code} Branch</strong>
                <p>5 FnB logs</p>
              </div>
              <div className="stat-card__actions">
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => onSelectBranch(branch)}
                >
                  Open Branch
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="workspace-footer">
        <span>Hamsun Log Book</span>
        <span>FnB Manager · Food &amp; Beverages</span>
      </footer>
    </main>
  );
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function parseRoute() {
  if (window.location.hash === "#/settings") {
    return { page: "settings", branch: null, checklist: null, date: null };
  }

  if (window.location.hash === "#/superadmin") {
    return { page: "superadmin", branch: null, checklist: null, date: null };
  }

  if (window.location.hash === "#/fnb") {
    return { page: "fnb", branch: null, checklist: null, date: null };
  }

  const fnbMatch = window.location.hash.match(
    /^#\/branch\/([A-Za-z]{3})\/fnb\/([a-z_]+)\/(\d{4}-\d{2}(?:-\d{2})?)$/,
  );

  if (fnbMatch) {
    const branch =
      branches.find((item) => item.code === fnbMatch[1].toUpperCase()) ?? null;
    const checklist =
      fnbChecklists.find((item) => item.id === fnbMatch[2]) ?? null;
    if (branch && checklist) {
      return {
        page: "fnb-log",
        branch,
        checklist: checklist.id,
        date: fnbMatch[3],
      };
    }
  }

  const breakfastMatch = window.location.hash.match(
    /^#\/branch\/([A-Za-z]{3})\/breakfast\/(\d{4}-\d{2}-\d{2})$/,
  );

  if (breakfastMatch) {
    const branch =
      branches.find((item) => item.code === breakfastMatch[1].toUpperCase()) ?? null;
    if (branch) {
      return {
        page: "breakfast",
        branch,
        date: breakfastMatch[2],
      };
    }
  }

  const match = window.location.hash.match(
    /^#\/branch\/([A-Za-z]{3})(?:\/(inspection|public-area|room-boy|linen)\/(\d{4}-\d{2}-\d{2}))?$/,
  );

  if (!match) return { ...emptyRoute };

  const branch =
    branches.find((item) => item.code === match[1].toUpperCase()) ?? null;
  if (!branch) return { ...emptyRoute };

  const pageType = match[2];
  const pageDate = match[3];

  if (pageType === "inspection" && pageDate && isValidDate(pageDate)) {
    return {
      page: "inspection",
      branch,
      checklist: "inspection",
      date: pageDate,
    };
  }

  if (pageType === "public-area" && pageDate && isValidDate(pageDate)) {
    return {
      page: "public-area",
      branch,
      checklist: "public",
      date: pageDate,
    };
  }

  if (pageType === "room-boy" && pageDate && isValidDate(pageDate)) {
    return {
      page: "room-boy",
      branch,
      checklist: "roomboy",
      date: pageDate,
    };
  }

  if (pageType === "linen" && pageDate && isValidDate(pageDate)) {
    return {
      page: "linen",
      branch,
      checklist: "linen",
      date: pageDate,
    };
  }

  return { page: "branch", branch, checklist: null, date: null };
}

export default function App() {
  const [route, setRoute] = useState(parseRoute);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [auth, setAuth] = useState(() => ({
    status: hasAuthConfig ? "loading" : "ready",
    profile: null,
    error: hasAuthConfig
      ? ""
      : "Login is not configured. Add VITE_APP_SUPABASE_URL and VITE_APP_SUPABASE_ANON_KEY to .env.",
  }));

  const profile = auth.profile;
  const visibleBranches = useMemo(() => getVisibleBranches(profile), [profile]);
  const activeBranch = useMemo(() => {
    if (!route.branch) return null;
    return (
      visibleBranches.find((branch) => branch.code === route.branch.code) ??
      null
    );
  }, [route.branch, visibleBranches]);
  const settingsActive =
    route.page === "settings" && canOpenSettings(profile);

  const [notifications, setNotifications] = useState([]);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [notificationPopup, setNotificationPopup] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  // Initialize audio on first user interaction (required by Chrome autoplay policy)
  useEffect(() => {
    const initAudio = () => {
      playBellSound();
    };
    window.addEventListener("click", initAudio, { once: true });
    return () => window.removeEventListener("click", initAudio);
  }, []);

  // Load notifications for all staff roles (not just room boys).
  useEffect(() => {
    if (!profile) return undefined;
    const staffRoles = [
      "supervisor",
      "branch_manager",
      "room_boy",
      "sweeper",
      "kitchen_incharge",
      "tray_collector",
      "dispatcher",
      "fnb_manager",
      "admin",
      "superadmin",
    ];
    if (!staffRoles.includes(profile.role)) return undefined;

    const seenStorageKey = `hamsun-staff-seen-${profile.email}`;
    let cancelled = false;
    let seenIds = new Set();
    try {
      const raw = localStorage.getItem(seenStorageKey);
      if (raw) seenIds = new Set(JSON.parse(raw));
    } catch {
      seenIds = new Set();
    }
    const firstRun = seenIds.size === 0;
    let seeded = seenIds.size > 0;

    const refresh = async () => {
      try {
        const [rbResult, staffResult] = await Promise.allSettled([
          listRoomBoyNotifications(profile.full_name, profile.branch_code),
          listStaffNotifications(profile.email),
        ]);
        if (cancelled) return;
        const rbNotifs =
          rbResult.status === "fulfilled" ? rbResult.value : [];
        const staffNotifs =
          staffResult.status === "fulfilled" ? staffResult.value : [];
        const allNotifs = [
          ...rbNotifs.map((n) => ({ ...n, id: n.id ?? `rb-${n.room_number}-${n.created_at}`, title: n.title ?? "Room Assignment" })),
          ...staffNotifs.map((n) => ({ ...n })),
        ];
        setNotifications(allNotifs);
        setNotificationsUnread(
          allNotifs.filter((n) => !n.read_at).length,
        );

        // The first refresh only remembers what is already unread so signing in
        // does not replay old alerts. Every later refresh rings for new rows.
        if (!seeded) {
          allNotifs.forEach((n) => seenIds.add(String(n.id)));
          seeded = true;
          return;
        }

        const fresh = allNotifs.filter(
          (n) => !n.read_at && !seenIds.has(String(n.id)),
        );
        if (fresh.length === 0) return;

        playBellSound();
        fresh.forEach((n) => {
          showDeviceNotification(n.title || "Hamsun Log Book", {
            body: n.message || "",
            tag: `staff-${n.id}`,
            renotify: true,
            requireInteraction: true,
            data: {
              url: n.branch_code
                ? `/#/branch/${n.branch_code}/inspection/${getTodayISO()}`
                : "/#/",
            },
          });
        });
        allNotifs.forEach((n) => seenIds.add(String(n.id)));
      } catch {
        // Notifications are best-effort; ignore errors.
      }
    };

    refresh();

    const handleFocus = () => refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    // Poll every 10 seconds; background tabs still receive alerts.
    const notifTimer = setInterval(refresh, 10000);

    return () => {
      cancelled = true;
      clearInterval(notifTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [profile, profile?.branch_code]);

  // Let Chrome's install prompt be triggered from the sidebar.
  useEffect(() => {
    const handleBeforeInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  // Breakfast alert: dispatchers and F&B managers hear the bell as soon as a
  // new PMS breakfast order appears. The first poll only seeds the seen list so
  // opening the app does not replay every existing order.
  useEffect(() => {
    if (!profile || !hasPmsConfig) return undefined;

    const alertRoles = [
      "dispatcher",
      "fnb_manager",
      "kitchen_incharge",
      "tray_collector",
      "superadmin",
    ];
    if (!alertRoles.includes(profile.role)) return undefined;

    const scopedRoles = ["dispatcher", "kitchen_incharge", "tray_collector"];
    const branchCodes =
      scopedRoles.includes(profile.role) && profile.branch_code
        ? [profile.branch_code]
        : pmsBranchCodes;
    if (branchCodes.length === 0) return undefined;

    const storageKey = (code, today) =>
      `hamsun-breakfast-seen-${code}-${today}`;

    const readSeen = (code, today) => {
      try {
        const raw = localStorage.getItem(storageKey(code, today));
        return raw ? new Set(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    };

    const writeSeen = (code, today, ids) => {
      try {
        localStorage.setItem(storageKey(code, today), JSON.stringify(ids));
      } catch {
        // Alerts still work for this page load if storage is unavailable.
      }
    };

    const fingerprint = (order, index) => {
      if (order?.request_id) return String(order.request_id);
      const items = (order?.items ?? [])
        .map((item) => item?.name ?? "")
        .join("|");
      return [
        order?.room_number ?? "room",
        order?.slot_label ?? index,
        order?.covers ?? "",
        items,
      ].join("-");
    };

    let cancelled = false;
    let running = false;

    const checkForNewOrders = async () => {
      if (cancelled || running) return;
      running = true;

      const today = getTodayISO();
      const newAlerts = [];

      try {
        for (const code of branchCodes) {
          try {
            const orders = await fetchPmsBreakfastOrders(code, today);
            if (cancelled) break;

            const entries = (orders || []).map((order, index) => ({
              order,
              id: fingerprint(order, index),
            }));
            const ids = entries.map((entry) => entry.id);
            const seen = readSeen(code, today);

            // Upgrade guard: if a previous build stored ids in a different
            // format (none of them match the current fingerprints), treat this
            // as a first run so we do not replay every existing order.
            const hasOverlap =
              !!seen && entries.some((entry) => seen.has(entry.id));
            if (seen === null || (seen.size > 0 && !hasOverlap)) {
              // First run for this branch/date: remember current orders silently.
              writeSeen(code, today, ids);
              continue;
            }

            const fresh = entries.filter((entry) => !seen.has(entry.id));
            if (fresh.length > 0) {
              newAlerts.push({
                branchCode: code,
                orders: fresh.map((entry) => entry.order),
              });
            }
            writeSeen(code, today, ids);
          } catch {
            // PMS polling is best-effort; try again on the next tick.
          }
        }

        if (!cancelled && newAlerts.length > 0) {
          playBellSound();
          newAlerts.forEach((alert) => {
            sendBreakfastNotification({ ...alert, date: today });
          });
        }
      } finally {
        running = false;
      }
    };

    checkForNewOrders();

    const handleFocus = () => checkForNewOrders();
    const handleVisibility = () => checkForNewOrders();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    // Background tabs keep polling too: staff often leave the portal minimised.
    const timer = setInterval(checkForNewOrders, 20000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [profile?.role, profile?.branch_code, profile?.email]);

  // Checkout watcher: poll PMS for the housekeeping team's branch(es) and raise
  // a shared alert whenever a room moves from an active stay to checked-out.
  // This runs on any page, not just the inspection table.
  useEffect(() => {
    if (!profile || !hasPmsConfig) return undefined;

    const watchRoles = [
      "supervisor",
      "branch_manager",
      "room_boy",
      "sweeper",
      "admin",
      "superadmin",
    ];
    if (!watchRoles.includes(profile.role)) return undefined;

    const scopedRoles = ["supervisor", "branch_manager", "room_boy", "sweeper"];
    const branchCodes =
      scopedRoles.includes(profile.role) && profile.branch_code
        ? [profile.branch_code].filter((code) =>
            pmsBranchCodes.includes(code),
          )
        : pmsBranchCodes;
    if (branchCodes.length === 0) return undefined;

    const storageKey = (code, today) => `hamsun-pms-status-${code}-${today}`;

    const readBaseline = (code, today) => {
      try {
        const raw = localStorage.getItem(storageKey(code, today));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Older builds stored a flat status map. Treat it as a first run so the
        // upgrade cannot replay checkouts that already happened earlier today.
        if (!parsed || parsed.version !== 2 || !parsed.rooms) return null;
        return parsed.rooms;
      } catch {
        return null;
      }
    };

    const writeBaseline = (code, today, rooms) => {
      try {
        localStorage.setItem(
          storageKey(code, today),
          JSON.stringify({ version: 2, rooms }),
        );
      } catch {
        // Watcher still works for this page load if storage is unavailable.
      }
    };

    let cancelled = false;
    let running = false;

    const checkForCheckouts = async () => {
      if (cancelled || running) return;
      running = true;
      const today = getTodayISO();

      try {
        for (const code of branchCodes) {
          try {
            const snapshot = await fetchBranchSnapshot(code, today);
            if (cancelled) break;

            const baseline = readBaseline(code, today);
            const nextStatuses = {};
            const checkouts = [];

            (snapshot.rooms || []).forEach((room) => {
              const status = room.pmsStatus ?? "";
              const checkin = room.checkinStatus ?? "";
              nextStatuses[room.number] = { status, checkin };

              if (!baseline) return;
              const previous = baseline[room.number] ?? {};
              const previousStatus = previous.status ?? "";
              const previousCheckin = previous.checkin ?? "";
              if (
                status === "checked_out" &&
                ["checked_in", "pending", "confirmed"].includes(
                  previousStatus,
                ) &&
                previousCheckin &&
                previousCheckin !== "CHECKED_OUT"
              ) {
                checkouts.push(room);
              }
            });

            if (baseline) {
              checkouts.forEach((room) => {
                const reference = `checkout:${code}:${
                  room.bookingId || room.number
                }:${room.checkOut || today}`;
                notifyRoomCheckout({
                  branchCode: code,
                  roomNumber: room.number,
                  bookingId: room.bookingId,
                  guestName: room.guest,
                  reference,
                }).catch(() => {
                  // Best-effort; the inspection page will retry while open.
                });
              });
            }

            writeBaseline(code, today, nextStatuses);
          } catch {
            // PMS polling is best-effort; try again on the next tick.
          }
        }
      } finally {
        running = false;
      }
    };

    checkForCheckouts();

    const handleFocus = () => checkForCheckouts();
    const handleVisibility = () => checkForCheckouts();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    const timer = setInterval(checkForCheckouts, 90000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [profile?.role, profile?.branch_code, profile?.email]);

  const installApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try {
      await installPrompt.userChoice;
    } finally {
      setInstallPrompt(null);
    }
  };

  // Keep the sidebar alert control in sync with Chrome's permission state.
  useEffect(() => {
    if (typeof Notification === "undefined") return undefined;
    const sync = () => setNotificationPermission(Notification.permission);
    sync();

    let status = null;
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "notifications" })
        .then((result) => {
          status = result;
          result.addEventListener("change", sync);
        })
        .catch(() => {});
    }

    window.addEventListener("focus", sync);
    return () => {
      if (status) status.removeEventListener("change", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") return;
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      // Register this device for background/closed-app push right away.
      if (permission === "granted" && auth.profile) {
        subscribeToPush(auth.profile).catch(() => {});
      }
    } catch {
      // Permission requests are best-effort.
    }
  };

  useEffect(() => {
    if (!hasAuthConfig) return undefined;

    let cancelled = false;
    const apply = async () => {
      try {
        const nextProfile = await loadSessionProfile();
        if (!cancelled) {
          setAuth({ status: "ready", profile: nextProfile, error: "" });
        }
      } catch (error) {
        if (!cancelled) {
          setAuth({
            status: "ready",
            profile: null,
            error: error?.message || "Could not restore your session.",
          });
        }
      }
    };

    apply();

    // Keep the session alive across tab switches / backgrounding and react to
    // explicit sign-out events instead of silently dropping the user.
    const unsubscribe = onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "TOKEN_REFRESHED") return;
      apply();
    });
    const handleVisibility = () => {
      if (document.visibilityState === "visible") apply();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Keep the push subscription current on every app open, not only at login.
  // Browsers silently rotate or expire endpoints (the push service then answers
  // 410 Gone); re-registering here makes sure closed-app alerts keep arriving.
  useEffect(() => {
    if (!auth.profile) return undefined;
    if (typeof Notification === "undefined") return undefined;
    if (Notification.permission !== "granted") return undefined;

    let cancelled = false;
    const refreshSubscription = () => {
      if (cancelled) return;
      subscribeToPush(auth.profile).catch(() => {});
    };

    refreshSubscription();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshSubscription();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [auth.profile]);

  // A push that arrives while the app is open (even in a background tab) is
  // announced by the service worker; ring the custom bell tone for it.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;

    const handleMessage = (event) => {
      if (event.data?.type === "hamsun-push") {
        playBellSound();
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    const handleHashChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setSidebarOpen(false);
  }, [route.page, route.branch?.code, route.checklist]);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  // Everyone who signs documents (superadmin, managers, supervisors, sweepers)
  // may open settings to set their signature name.
  useEffect(() => {
    if (!profile || canOpenSettings(profile)) return;

    if (route.page === "settings") {
      if (profile.branch_code) {
        window.location.hash = `/branch/${profile.branch_code}`;
      } else if (profile.role === "fnb_manager") {
        window.location.hash = "/fnb";
      } else {
        window.location.hash = "";
      }
      setRoute({ ...emptyRoute });
      return;
    }
  }, [profile, route.page]);

  // Sweepers can only access the public-area page for their own branch.
  useEffect(() => {
    if (!profile || profile.role !== "sweeper" || !profile.branch_code) return;

    if (route.page !== "public-area") {
      const branch = branches.find(
        (item) => item.code === profile.branch_code,
      );
      if (branch) {
        const date = getTodayISO();
        window.location.hash = `/branch/${branch.code}/public-area/${date}`;
        setRoute({
          page: "public-area",
          branch,
          checklist: "public",
          date,
        });
      }
      return;
    }

    if (route.branch && route.branch.code !== profile.branch_code) {
      const branch = branches.find(
        (item) => item.code === profile.branch_code,
      );
      if (branch) {
        const date = getTodayISO();
        window.location.hash = `/branch/${branch.code}/public-area/${date}`;
        setRoute({
          page: "public-area",
          branch,
          checklist: "public",
          date,
        });
      }
    }
  }, [profile, route.page, route.branch]);

  // Branch managers can only open their own branch.
  useEffect(() => {
    if (
      !profile ||
      profile.role !== "branch_manager" ||
      !profile.branch_code
    ) {
      return;
    }
    if (route.branch && route.branch.code !== profile.branch_code) {
      const branch = branches.find(
        (item) => item.code === profile.branch_code,
      );
      if (branch) {
        window.location.hash = `/branch/${branch.code}`;
        setRoute({ page: "branch", branch, checklist: null, date: null });
      }
    }
  }, [profile, route.branch]);

  // Room boys can only access the room-boy page for their own branch.
  useEffect(() => {    if (!profile || profile.role !== "room_boy" || !profile.branch_code) return;

    if (route.page !== "room-boy") {
      const branch = branches.find(
        (item) => item.code === profile.branch_code,
      );
      if (branch) {
        const date = getTodayISO();
        window.location.hash = `/branch/${branch.code}/room-boy/${date}`;
        setRoute({
          page: "room-boy",
          branch,
          checklist: "roomboy",
          date,
        });
      }
      return;
    }

    if (route.branch && route.branch.code !== profile.branch_code) {
      const branch = branches.find(
        (item) => item.code === profile.branch_code,
      );
      if (branch) {
        const date = getTodayISO();
        window.location.hash = `/branch/${branch.code}/room-boy/${date}`;
        setRoute({
          page: "room-boy",
          branch,
          checklist: "roomboy",
          date,
        });
      }
    }
  }, [profile, route.page, route.branch]);

  // Breakfast dispatchers can only open their own branch's breakfast log.
  useEffect(() => {
    if (!profile || profile.role !== "dispatcher" || !profile.branch_code) {
      return;
    }
    const branch = branches.find(
      (item) => item.code === profile.branch_code,
    );
    if (!branch) return;

    const onOwnBreakfast =
      route.page === "breakfast" &&
      route.branch?.code === profile.branch_code;
    if (onOwnBreakfast) return;

    const date = getTodayISO();
    window.location.hash = `/branch/${branch.code}/breakfast/${date}`;
    setRoute({ page: "breakfast", branch, date });
  }, [profile, route.page, route.branch]);

  // Superadmins land on their dashboard from the overview, but can still open
  // branches and access settings.
  useEffect(() => {
    if (!profile || profile.role !== "superadmin") return;

    if (route.page === "overview") {
      window.location.hash = "/superadmin";
      setRoute({ ...emptyRoute, page: "superadmin" });
    }
  }, [profile, route.page]);

  // F&B Managers land on their department dashboard and can open the F&B logs
  // for every branch.
  useEffect(() => {
    if (!profile || profile.role !== "fnb_manager") return;

    if (route.page === "overview") {
      window.location.hash = "/fnb";
      setRoute({ ...emptyRoute, page: "fnb" });
    }
  }, [profile, route.page]);

  const handleLogin = async (email, password) => {
    const nextProfile = await signInWithPassword(email, password);
    setAuth({ status: "ready", profile: nextProfile, error: "" });

    // Subscribe to push notifications so alerts arrive even when the app is
    // closed on the phone.
    subscribeToPush(nextProfile).catch(() => {});

    if (
      [
        "supervisor",
        "branch_manager",
        "room_boy",
        "sweeper",
        "kitchen_incharge",
        "tray_collector",
        "dispatcher",
        "fnb_manager",
        "admin",
      ].includes(nextProfile.role)
    ) {
      requestNotificationPermission();
    }

    if (nextProfile.role === "sweeper" && nextProfile.branch_code) {
      const branch = branches.find(
        (item) => item.code === nextProfile.branch_code,
      );
      if (branch) {
        const date = getTodayISO();
        window.location.hash = `/branch/${branch.code}/public-area/${date}`;
        setRoute({
          page: "public-area",
          branch,
          checklist: "public",
          date,
        });
        return;
      }
    }

    if (nextProfile.role === "room_boy" && nextProfile.branch_code) {
      const branch = branches.find(
        (item) => item.code === nextProfile.branch_code,
      );
      if (branch) {
        const date = getTodayISO();
        window.location.hash = `/branch/${branch.code}/room-boy/${date}`;
        setRoute({
          page: "room-boy",
          branch,
          checklist: "roomboy",
          date,
        });
        return;
      }
    }

    if (nextProfile.role === "dispatcher" && nextProfile.branch_code) {
      const branch = branches.find(
        (item) => item.code === nextProfile.branch_code,
      );
      if (branch) {
        const date = getTodayISO();
        window.location.hash = `/branch/${branch.code}/breakfast/${date}`;
        setRoute({ page: "breakfast", branch, date });
        return;
      }
    }

    if (nextProfile.role === "superadmin") {
      window.location.hash = "/superadmin";
      setRoute({ ...emptyRoute, page: "superadmin" });
      return;
    }

    if (nextProfile.role === "fnb_manager") {
      window.location.hash = "/fnb";
      setRoute({ ...emptyRoute, page: "fnb" });
      return;
    }

    if (nextProfile.role !== "admin" && nextProfile.branch_code) {
      const branch = branches.find(
        (item) => item.code === nextProfile.branch_code,
      );
      if (branch) {
        window.location.hash = `/branch/${branch.code}`;
        setRoute({
          page: "branch",
          branch,
          checklist: null,
          date: null,
        });
        return;
      }
    }

    window.location.hash = "";
    setRoute({ ...emptyRoute });
  };

  const handleLogout = async () => {
    await signOut();
    setAuth({ status: "ready", profile: null, error: "" });
    window.location.hash = "";
    setRoute({ ...emptyRoute });
    setSidebarOpen(false);
  };

  const openBranch = (branch) => {
    if (!visibleBranches.some((item) => item.code === branch.code)) return;
    window.location.hash = `/branch/${branch.code}`;
    setRoute({ page: "branch", branch, checklist: null, date: null });
    setSidebarOpen(false);
  };

  const openInspection = (branch) => {
    if (!visibleBranches.some((item) => item.code === branch.code)) return;
    const date = getTodayISO();
    window.location.hash = `/branch/${branch.code}/inspection/${date}`;
    setRoute({
      page: "inspection",
      branch,
      checklist: "inspection",
      date,
    });
    setSidebarOpen(false);
  };

  const openPublicArea = (branch) => {
    if (!visibleBranches.some((item) => item.code === branch.code)) return;
    const date = getTodayISO();
    window.location.hash = `/branch/${branch.code}/public-area/${date}`;
    setRoute({
      page: "public-area",
      branch,
      checklist: "public",
      date,
    });
    setSidebarOpen(false);
  };

  const openRoomBoy = (branch) => {
    if (!visibleBranches.some((item) => item.code === branch.code)) return;
    const date = getTodayISO();
    window.location.hash = `/branch/${branch.code}/room-boy/${date}`;
    setRoute({
      page: "room-boy",
      branch,
      checklist: "roomboy",
      date,
    });
    setSidebarOpen(false);
  };

  const openLinen = (branch) => {
    if (!visibleBranches.some((item) => item.code === branch.code)) return;
    const date = getTodayISO();
    window.location.hash = `/branch/${branch.code}/linen/${date}`;
    setRoute({
      page: "linen",
      branch,
      checklist: "linen",
      date,
    });
    setSidebarOpen(false);
  };

  const openFnbLog = (branch, checklist) => {
    if (!visibleBranches.some((item) => item.code === branch.code)) return;
    const period =
      checklist.period === "month" ? getCurrentMonth() : getTodayISO();
    window.location.hash = `/branch/${branch.code}/fnb/${checklist.id}/${period}`;
    setRoute({
      page: "fnb-log",
      branch,
      checklist: checklist.id,
      date: period,
    });
    setSidebarOpen(false);
  };

  const openBreakfast = (branch) => {
    if (!visibleBranches.some((item) => item.code === branch.code)) return;
    const date = getTodayISO();
    window.location.hash = `/branch/${branch.code}/breakfast/${date}`;
    setRoute({ page: "breakfast", branch, date });
    setSidebarOpen(false);
  };

  const changeInspectionDate = (date) => {
    if (!activeBranch) return;
    window.location.hash = `/branch/${activeBranch.code}/inspection/${date}`;
    setRoute({ ...route, page: "inspection", date });
  };

  const goHome = () => {
    if (window.location.hash) {
      window.location.hash = "";
    }
    setRoute({ ...emptyRoute });
    setSidebarOpen(false);
  };

  const goSettings = () => {
    if (!canOpenSettings(profile)) return;
    window.location.hash = "/settings";
    setRoute({ ...emptyRoute, page: "settings" });
    setSidebarOpen(false);
  };

  const markAllNotificationsRead = () => {
    const now = new Date().toISOString();
    const next = notifications.map((n) =>
      n.read_at ? n : { ...n, read_at: now },
    );
    setNotifications(next);
    setNotificationsUnread(0);
    markStaffNotificationsRead(profile.email).catch(() => {});
    markRoomBoyNotificationsRead(
      profile.full_name,
      profile.branch_code,
    ).catch(() => {});
  };

  const markOneNotificationRead = (id) => {
    const now = new Date().toISOString();
    const next = notifications.map((n) =>
      String(n.id) === String(id) && !n.read_at
        ? { ...n, read_at: now }
        : n,
    );
    setNotifications(next);
    setNotificationsUnread(next.filter((n) => !n.read_at).length);
    markStaffNotificationRead(id).catch(() => {});
    markRoomBoyNotificationRead(id).catch(() => {});
    setNotificationPopup((previous) =>
      previous && String(previous.id) === String(id)
        ? { ...previous, read_at: previous.read_at ?? now }
        : previous,
    );
  };

  if (auth.status === "loading") {
    return <AuthLoading />;
  }

  if (!profile) {
    return (
      <LoginPage initialError={auth.error} onLogin={handleLogin} />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeBranch={activeBranch}
        open={sidebarOpen}
        profile={profile}
        visibleBranches={visibleBranches}
        settingsActive={settingsActive}
        onHome={goHome}
        onSelectBranch={openBranch}
        onSettings={goSettings}
        onLogout={handleLogout}
        onClose={() => setSidebarOpen(false)}
        canInstall={Boolean(installPrompt)}
        onInstall={installApp}
        notificationPermission={notificationPermission}
        onEnableNotifications={enableNotifications}
      />

      <div className="main-shell">
        <Topbar
          activeBranch={activeBranch}
          activeChecklist={route.checklist}
          settingsActive={settingsActive}
          profile={profile}
          notifications={notifications}
          notificationsUnread={notificationsUnread}
          onMarkNotificationsRead={markAllNotificationsRead}
          onMarkNotificationRead={markOneNotificationRead}
          onOpenNotification={(notification) => setNotificationPopup(notification)}
          onMenu={() => setSidebarOpen(true)}
          onLogout={handleLogout}
        />

        {settingsActive ? (
          <SettingsPage
            profile={profile}
            onBack={goHome}
            onProfileChange={(updatedProfile) =>
              setAuth((previous) => ({
                ...previous,
                profile: updatedProfile,
              }))
            }
          />
        ) : route.page === "superadmin" ? (
          <SuperAdminView
            profile={profile}
            onBack={goHome}
            onSelectBranch={openBranch}
          />
        ) : route.page === "fnb" ? (
          <FnBManagerView
            profile={profile}
            onBack={goHome}
            onSelectBranch={openBranch}
          />
        ) : activeBranch && route.checklist === "inspection" ? (
          <InspectionPage
            branch={activeBranch}
            date={route.date}
            profile={profile}
            onBack={() => openBranch(activeBranch)}
            onDateChange={changeInspectionDate}
          />
        ) : activeBranch && route.page === "fnb-log" ? (
          <FnbLogPage
            branch={activeBranch}
            checklist={
              fnbChecklists.find((item) => item.id === route.checklist) ??
              fnbChecklists[0]
            }
            period={route.date ?? getTodayISO()}
            profile={profile}
            onBack={() => openBranch(activeBranch)}
            onPeriodChange={(nextPeriod) => {
              window.location.hash = `/branch/${activeBranch.code}/fnb/${route.checklist}/${nextPeriod}`;
              setRoute({ ...route, page: "fnb-log", date: nextPeriod });
            }}
          />
        ) : activeBranch && route.page === "breakfast" ? (
          <BreakfastOrderPage
            branch={activeBranch}
            date={route.date}
            profile={profile}
            onBack={() => openBranch(activeBranch)}
            onDateChange={(nextDate) => {
              window.location.hash = `/branch/${activeBranch.code}/breakfast/${nextDate}`;
              setRoute({ ...route, page: "breakfast", date: nextDate });
            }}
          />
        ) : activeBranch && route.page === "public-area" ? (
          <PublicAreaPage
            branch={activeBranch}
            date={route.date}
            profile={profile}
            onBack={() => openBranch(activeBranch)}
            onDateChange={(nextDate) => {
              window.location.hash = `/branch/${activeBranch.code}/public-area/${nextDate}`;
              setRoute({ ...route, page: "public-area", date: nextDate });
            }}
          />
        ) : activeBranch && route.page === "room-boy" ? (
          <RoomBoyPage
            branch={activeBranch}
            date={route.date}
            profile={profile}
            onBack={() => openBranch(activeBranch)}
            onDateChange={(nextDate) => {
              window.location.hash = `/branch/${activeBranch.code}/room-boy/${nextDate}`;
              setRoute({ ...route, page: "room-boy", date: nextDate });
            }}
          />
        ) : activeBranch && route.page === "linen" ? (
          <LinenWashingPage
            branch={activeBranch}
            date={route.date ?? getTodayISO()}
            profile={profile}
            onBack={() => openBranch(activeBranch)}
            onDateChange={(nextDate) => {
              window.location.hash = `/branch/${activeBranch.code}/linen/${nextDate}`;
              setRoute({ ...route, page: "linen", date: nextDate });
            }}
          />
        ) : activeBranch ? (
          <BranchView
            branch={activeBranch}
            visibleBranches={visibleBranches}
            onBack={goHome}
            onSwitch={openBranch}
            onOpenInspection={openInspection}
            onOpenPublicArea={openPublicArea}
            onOpenRoomBoy={openRoomBoy}
            onOpenLinen={openLinen}
            onOpenFnbLog={openFnbLog}
            onOpenBreakfast={openBreakfast}
            profile={profile}
          />
        ) : (
          <Home
            onSelect={openBranch}
            visibleBranches={visibleBranches}
            profile={profile}
          />
        )}
      </div>

      {notificationPopup ? (
        <NotificationPopup
          notification={notificationPopup}
          onClose={() => setNotificationPopup(null)}
          onDone={markOneNotificationRead}
        />
      ) : null}
    </div>
  );
}


