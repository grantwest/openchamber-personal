/// <reference lib="webworker" />

// NOTE: keep the Workbox injection point so vite-plugin-pwa can build.
// We intentionally do not use Workbox runtime helpers here: iOS Safari can be
// fragile with more complex SW bundles. For push notifications we only need a
// minimal SW.

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision?: string }>;
};

const __precacheManifest = self.__WB_MANIFEST;

// The worker has no window bootstrap. Its registration scope is the
// authoritative deployment URL, including the trailing slash.
const appScope = new URL(self.registration.scope);
const basePath = appScope.pathname.replace(/\/$/, '');
const isAppUrl = (value: string): boolean => {
  const url = new URL(value, appScope);
  return url.origin === appScope.origin && url.pathname.startsWith(appScope.pathname);
};
const resolveAppUrl = (value: string): string => {
  const url = new URL(value, appScope);
  // Older push senders use root-absolute paths. Keep those in this deployment.
  if (url.origin === appScope.origin && basePath
    && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
    url.pathname = `${basePath}${url.pathname}`;
  }
  return url.href;
};

type PushPayload = {
  title?: string;
  body?: string;
  tag?: string;
  data?: {
    url?: string;
    sessionId?: string;
    type?: string;
  };
  icon?: string;
  badge?: string;
};

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const payload = (event.data?.json() ?? null) as PushPayload | null;
    if (!payload) {
      return;
    }

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const hasVisibleClient = clients.some((client) => isAppUrl(client.url)
      && (client.visibilityState === 'visible' || client.focused));
    if (hasVisibleClient) {
      return;
    }

    const title = payload.title || 'OpenChamber';
    const body = payload.body ?? '';
    const icon = resolveAppUrl(payload.icon ?? 'apple-touch-icon-180x180.png');
    const badge = resolveAppUrl(payload.badge ?? 'favicon-32.png');

    await self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag: payload.tag,
      data: payload.data,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // SAFETY: notification data is only ever written by our own showNotification
  // and push payloads as { url, sessionId }; both fields are re-validated as
  // trimmed strings below before use.
  const data = (event.notification.data ?? null) as { url?: string; sessionId?: string } | null;
  const rawUrl = typeof data?.url === 'string' ? data.url.trim() : '';
  const rawSessionId = typeof data?.sessionId === 'string' ? data.sessionId.trim() : '';
  const url = resolveAppUrl(rawUrl || (rawSessionId ? `?session=${encodeURIComponent(rawSessionId)}` : './'));

  event.waitUntil((async () => {
    // Prefer focusing an already-open window (e.g. the installed PWA) and
    // navigating it to the target, instead of always spawning a new window.
    const target = isAppUrl(url) ? url : appScope.href;
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of windowClients) {
      if (!isAppUrl(client.url)) continue;
      try {
        if ('navigate' in client) {
          await client.navigate(target);
        }
      } catch {
        // navigate() can reject for uncontrolled clients; fall back to focus.
      }
      if ('focus' in client) {
        return client.focus();
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(target);
    }
  })());
});
