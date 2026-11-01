# Browser build and bootstrap

## Ownership

This package builds the browser HTML, assets, runtime adapters, and push service worker. `src/runtimeConfig.ts` applies injected runtime configuration. Shared UI URL and authentication logic lives in `packages/ui/src/lib/`. The server owns deployment-path validation, HTML injection, dynamic manifest responses, and route mounting.

## Invariants

- A build can run at the origin root or under a server-selected deployment path. `OPENCHAMBER_BASE_PATH` is a server setting, not a build setting.
- The server injects `window.__OPENCHAMBER_BASE_PATH__` before inline scripts. Its value is empty at root or a normalized path without a trailing slash.
- For prefixed hosting, the server supplies a `<base href="/prefix/">` before relative assets. This also supports nested navigation URLs. The proxy preserves the prefix.
- Browser bootstrap uses the deployment API base only when no explicit runtime API base is present. Desktop and native runtime configuration keeps precedence. An absent deployment path preserves root defaults.
- The browser registers `sw.js` with the deployment root as its scope. Development cleanup unregisters only that exact scope.
- The service worker derives asset and notification targets from its registration scope. It does not focus or navigate windows outside that scope.
- The inline fallback manifest uses absolute deployment URLs because its blob URL cannot resolve relative resources. The static manifest resolves resources relative to its own URL.
- Hosted phone rendering through `index.html` shares browser PWA registration. The explicit `mobile.html` entrypoint keeps its native shell behavior and does not add service worker registration.

## Decisions

### Why the build uses relative assets

Vite uses `base: './'` so one build works at root, under a deployment prefix, and in native shells. A build-time deployment prefix would require a separate artifact for each server.

### Why service worker registration configures Workbox directly

The virtual PWA registration embeds the build base and scope. Direct Workbox configuration reads the server-selected deployment path at runtime and preserves page reload after worker updates. The worker keeps automatic activation through `skipWaiting()` and `clients.claim()`.
