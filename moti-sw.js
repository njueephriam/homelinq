/* ============================================================
   HomeLinq + Moti service worker
   - Makes the Moti app and HomeLinq Pro installable to the
     home screen (PWA).
   - Receives web-push notifications from Moti and shows them
     even when the app is closed.
   ============================================================ */
var CACHE = "homelinq-moti-v19";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Network-first, fall back to cache (keeps the app usable offline
   and satisfies PWA installability). */
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  if (e.request.url.indexOf("http") !== 0) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});

/* A push arrived from the Moti server. */
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (_e) { d = { body: e.data ? e.data.text() : "" }; }
  var title = d.title || "Moti";
  var opts = {
    body: d.body || "Moti has an update for you.",
    icon: d.icon || "moti/icons/moti-icon-192.png",
    badge: "moti/icons/moti-icon-192.png",
    tag: d.tag || "moti-update",
    renotify: true,
    data: { url: d.url || "moti.html" },
    vibrate: [80, 40, 80]
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

/* The engineer tapped the notification — focus or open Moti. */
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "moti.html";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(target) !== -1 && "focus" in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
