const CACHE_NAME = "hamsun-hk-v8";
const PRECACHE = ["/manifest.json"];

// Install: precache only truly static files. Do NOT precache index.html,
// otherwise a stale shell would keep loading old bundles after every deploy.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE).catch((err) => {
        console.warn("Some assets failed to cache:", err);
      });
    }),
  );
  self.skipWaiting();
});

// Activate: drop every older cache version and take control immediately.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// Focus an existing app window (or open one) when a breakfast notification is
// clicked, then jump straight to that branch's breakfast log.
// Handle push notifications (works even when the app is closed).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Hamsun Log Book", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Hamsun Log Book";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-96x96.png",
    tag: data.tag || "hamsun-push",
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: data.urgent
      ? [400, 120, 400, 120, 400, 120, 400]
      : [300, 100, 300],
    data: { url: data.url || "/" },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);

      // If the app is open (even in a background tab) tell it to ring the
      // custom bell tone. When the app is closed the system notification
      // sound still plays, and the in-app bell rings as soon as it opens.
      try {
        const clientList = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        clientList.forEach((client) =>
          client.postMessage({ type: "hamsun-push", payload: data }),
        );
      } catch {
        // Best-effort.
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            if ("navigate" in client) {
              client.navigate(targetUrl).catch(() => {});
            }
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});

function isDocumentRequest(request, url) {
  return (
    request.mode === "navigate" ||
    request.destination === "document" ||
    url.pathname === "/" ||
    url.pathname.endsWith("/index.html")
  );
}

// Fetch:
// - App shell / documents: network-first so new deployments load right away.
// - Hashed build assets: cache-first (safe because filenames change on deploy).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  if (isDocumentRequest(event.request, url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          return cached || caches.match("/index.html");
        }),
    );
    return;
  }

  // The manifest and app icons must always reflect the latest deploy so Chrome
  // can re-check installability without serving a stale icon from cache.
  if (url.pathname === "/manifest.json" || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          return cached || Response.error();
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    }),
  );
});
