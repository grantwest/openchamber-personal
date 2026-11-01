# Personal changes

This file records Grant West's personal OpenChamber customizations. Read it before changing code or resolving upstream merge conflicts.

## Fork maintenance policy

The repository is a long-running personal fork at `grantwest/openchamber-personal`. Upstream releases come from `openchamber/openchamber`. Personal work stays on `main`, and upstream updates merge exact stable release tags after validation in a separate worktree.

`AGENTS.md` owns the maintenance rules. Commit messages must preserve the motivation, requirements, decisions, and validation needed to resolve future conflicts. Upstream contribution and public backlog workflows do not apply. The PR review and issue/PR triage skills, public PR/backlog command wrappers, and public PR review/issue intake agents are removed. Local correctness review remains available. The Russian-language exclusion comment is removed from the locale skill. Unrelated wording and formatting in `AGENTS.md` stay as upstream wrote them to minimize merge conflicts.

Validation for the policy change checks the remaining agent instructions for references to removed skills and exercises the maintenance rules with a read-only agent scenario. No application behavior changes in this policy update.

## Path-based reverse proxy hosting

Grant runs multiple applications under paths on `lab.grantwest.dev`. OpenChamber must work at `https://lab.grantwest.dev/chamber/` without reserving root-level `/api`, `/assets`, `/auth`, or service-worker routes.

### Configuration

Set `OPENCHAMBER_BASE_PATH=/chamber` in the server environment, then start OpenChamber normally. The setting defaults to root hosting. Restart the server to change it. The same browser build works at root and beneath a configured prefix. `/api`, `/auth`, and `/health` are reserved deployment roots.

The reverse proxy must preserve `/chamber` when forwarding requests. It must support WebSocket upgrades and unbuffered SSE, with long-lived connection timeouts. Redirect `/chamber` to `/chamber/`; OpenChamber also performs this redirect. For example, in a Caddy site:

```caddyfile
lab.grantwest.dev {
    @openchamber path /chamber /chamber/*
    reverse_proxy @openchamber 127.0.0.1:3000 {
        flush_interval -1
    }
}
```

Use `handle` or `reverse_proxy` with a path matcher. Caddy's `handle_path` strips the prefix and does not match this deployment contract. Keep the existing server password and network protections; a base path adds no authentication.

### Requirements and maintenance

- The server validates the configured prefix and removes it before existing routing, authentication, authorization, OpenCode proxying, SSE, and WebSocket dispatch. Existing security gates remain authoritative.
- Entry HTML supplies the deployment base before assets and inline scripts. Browser bootstrap keeps explicit native/remote runtime configuration ahead of the hosted default. Imported assets use relative build URLs.
- API calls, token minting, file links, tracker links, PWA manifests, notification links, and service-worker registration retain the prefix. The worker scope belongs to this deployment.
- Saved credentials match the complete service root, not only the origin. Preview annotations remove grants from prefixed URLs. Expiry classification follows the active service root and ignores stale probes after a runtime switch.
- Desktop, VS Code, and native shell entrypoint defaults remain unchanged. Direct remote API base URLs retain their own path prefixes. Canonical root API/auth/health routes remain available directly on the backend for existing native clients, callbacks, and relay transport; the public proxy only forwards the deployment prefix.
- Upstream merges must preserve the shared URL/auth boundary and early server HTTP/upgrade canonicalization. Recheck new root-absolute URLs in browser code and server-generated redirects or links.

### Validation

Validation used isolated server data, managed OpenCode, a local fixture model provider, and a proxy that rejected every path outside `/openchamber`. Existing user servers were left running.

- Browser proof passed for password login, streamed chat, terminal WebSocket commands, SSE events, binary upload/download, nested-path refresh, and mobile/desktop rendering. A resource audit found no same-origin requests outside the prefix. The manifest, its icons, and the controlling worker used `/openchamber/`.
- The same production build passed root-hosted startup, API/health requests, service-worker registration, and nested-path refresh. That final test caught and fixed a missing root `<base href="/">` after making build assets relative.
- 222 coordinated focused tests passed through Vitest and the existing Bun-test shim, including absent-window resource resolution and Node header overloads. Additional server-agent checks covered 126 focused tests before the final root fix. Tests cover explicit remote/native configuration precedence, prefix-aware credentials, expiry, scoped grants, cookies, redirects, manifests, callbacks, tracker links, and proxy/upgrade dispatch.
- TypeScript project checks (`tsc -b`) and the production Vite build passed. UI/web lint passed with 3 existing warnings in unrelated files. Existing CSS-highlight and chunk-size build warnings remain.
- The SDK-style Request transport test now verifies abort propagation and the abort reason. It no longer assumes signal object identity, which Node's Request constructor does not preserve.
- Independent correctness review found no remaining concrete defect.

The initial shell did not expose Bun on PATH. The Vite build reused existing built-in extension outputs rather than running the full Bun build. The service's Bun installation was later found at `/home/grant/.local/share/bun/1.4.4/bin`; use that directory on PATH for the pre-commit gate. Packaged desktop/VS Code/Capacitor startup, encrypted relay traffic, real notifications, and live third-party OAuth/provider/tracker services were not exercised. Their focused contract tests do not replace packaged or live-service proof.
