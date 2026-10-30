// Chanchito Gastos: guarda la app para que abra sin internet.
const VERSION = "chanchito-v6";
const STATE = "chanchito-state";
const CORE = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png", "icon-maskable.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== STATE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // La sincronización con Google siempre va directo a internet.
  if (url.hostname.endsWith("google.com") || url.hostname.endsWith("googleusercontent.com")) return;

  // La página: primero internet (para recibir actualizaciones), si no hay, la copia guardada.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("index.html", copy)); return res; })
        .catch(() => caches.match("index.html"))
    );
    return;
  }

  // Íconos, fuentes y demás: la copia guardada y, si no está, internet.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});

// ---------- Avisos de gastos fijos sin pagar ----------
const fmt = (n) => "$ " + Math.round(n).toLocaleString("es-AR");
const pad = (n) => String(n).padStart(2, "0");
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const dkey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

async function checkFijos() {
  const cache = await caches.open(STATE);
  const stRes = await cache.match(new URL("__state", self.registration.scope).href);
  if (!stRes) return;
  const st = await stRes.json();
  const notifUrl = new URL("__notified", self.registration.scope).href;
  const nRes = await cache.match(notifUrl);
  const notified = nRes ? await nRes.json() : {};
  const pagados = new Set(st.pagados || []);
  const now = new Date(), hoy = dkey(now);
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const f of st.fijos || []) {
    let y = now.getFullYear(), m = now.getMonth();
    if (f.desde && f.desde > y + "-" + pad(m + 1)) { y = +f.desde.slice(0, 4); m = +f.desde.slice(5, 7) - 1; }
    let gid = "fx-" + f.id + "-" + y + "-" + pad(m + 1);
    if (pagados.has(gid)) {
      m++; if (m > 11) { m = 0; y++; }
      gid = "fx-" + f.id + "-" + y + "-" + pad(m + 1);
      if (pagados.has(gid)) continue; // ya pagado: sin aviso
    }
    const due = new Date(y, m, Math.min(Math.max(1, f.dia || 1), daysIn(y, m)));
    const left = Math.round((due - t0) / 864e5);
    if (left > (st.avisoDias || 0) || notified[gid] === hoy) continue;
    const title = left < 0 ? "Ya venció " + f.nombre : left === 0 ? "Hoy vence " + f.nombre : f.nombre + " vence en " + left + (left === 1 ? " día" : " días");
    await self.registration.showNotification("🐷 " + title, {
      body: fmt(f.monto) + " · Tocá para abrir Chanchito y marcarlo como pagado.",
      icon: "icon-192.png", badge: "icon-192.png", tag: gid
    });
    notified[gid] = hoy;
  }
  await cache.put(notifUrl, new Response(JSON.stringify(notified), { headers: { "Content-Type": "application/json" } }));
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "chanchito-fijos") e.waitUntil(checkFijos());
});
self.addEventListener("message", (e) => {
  if (e.data === "check-fijos") e.waitUntil(checkFijos());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) =>
      list.length ? list[0].focus() : self.clients.openWindow(self.registration.scope)
    )
  );
});
