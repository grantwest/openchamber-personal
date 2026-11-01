# OpenChamber Agent Guide

## Purpose

OpenChamber provides shared web, desktop, VS Code, hosted-mobile, and native-mobile UI surfaces for OpenCode.

This file contains only always-on repository rules and routing. Detailed workflows belong to project skills and module documentation.

This checkout is Grant West's long-running personal fork. Work serves Grant's requirements. Changes stay in the personal fork; upstream contribution, public issue triage, and upstream PR workflows do not apply.

## Personal fork and upstream updates

Read [personalchanges.md](personalchanges.md) before changing code or resolving upstream merge conflicts. Keep it current when adding, changing, or removing personal customizations.

- Personal changes live directly on `main`. A separate long-lived customization branch is not required.
- The intended remotes are `origin` for `grantwest/openchamber-personal` and `upstream` for `openchamber/openchamber`. Verify the remotes before using them.
- Update from the latest published stable tagged upstream release. Fetch upstream tags, verify the latest non-prerelease release, inspect its changes, and merge that exact tag. `upstream/main` can contain unreleased work.
- Prepare release merges in a separate Git worktree based on the current head of personal `main`. Run the applicable checks and tests there. Integrate only after behavior is validated and questions are resolved.
- Before integration, recheck that the primary worktree is clean and `main` is unchanged. Fast-forward it to the tested merge commit; otherwise stop or revalidate.
- Preserve personal history with merge commits when needed. Never reset personal `main` to upstream, force-push, rewrite shared history, or discard personal or remote work to synchronize it.
- Before merging, inspect the worktree and coordinate with other agents. Stage and commit only files belonging to the task. Ask before restarting a running server.
- Publish only to the verified personal `origin` when requested, with a normal non-force push and without publishing tags. Verify the remote commit matches local `main`. Stop and report authentication failures, publication failures, or divergent history.
- Keep upstream product and contribution documents unchanged for personal customizations, including `docs/`, `packages/docs/`, and `CONTRIBUTING.md`. Record personal requirements, behavior, validation, and maintenance notes in `personalchanges.md`. This overrides general instructions to update upstream documentation for personal changes. Keep owning module `DOCUMENTATION.md` contracts accurate. Upstream release merges can update upstream documentation.
- During conflict resolution, read `personalchanges.md` and the relevant personal commit messages. Reconcile the requirements with upstream changes; ask Grant when they cannot be reconciled safely.

### Commit messages preserve intent

Use a conventional commit subject and a body that explains why the change exists. Record the motivation and use case, requirements and exclusions, consequential decisions and trade-offs, and validation performed or omitted. Keep this information in the message itself so a future merge can preserve the intended behavior without the original conversation.

## Instruction Order

These steps are mandatory. Before editing, you **MUST**:

1. Follow this root guide.
2. Load every project skill whose `description` matches the change, and every
   reference those skills require. Any source change starts with
   `openchamber-change-discipline`.
3. Read the nearest `DOCUMENTATION.md` (under `packages/**`) for each module you
   change, and the package `README.md` for package-level work.
4. Follow local code and test precedent.

If these sources materially conflict, stop and resolve the conflict instead of silently choosing one.
Do not start editing before every matching skill and required reference is read.

## Working a Change

Every fix and feature goes through these steps, in order. What counts as proof, and where to run each kind of change, is in `openchamber-change-discipline` (*Proof*, *Where to run it*).

1. **Reproduce.** Make the failure happen the way a user hits it, in the runtime that runs the code; for a feature, see what that runtime does today where the feature goes. Unreproduced goes to the report with what you tried before any fix.
2. **Fix the cause.** The smallest change that removes it. A correctness problem you trip over in code you touch is fixed in the same change; one elsewhere goes to the report.
3. **Prove it.** Run the same reproduction and watch it pass. Report what the proof covered and what it did not.
4. **Second look.** The `review` agent on the diff (`.opencode/agent/review.md`), or a reviewer on another model where your tool has no such agent; one-line and text-only edits go without. Answer findings per `openchamber-change-discipline` (*Answering Review Findings*).
5. **Hand off.** The working tree for Grant. Commit and publish only when requested.

Product decisions belong to Grant. Ask before implementing an unresolved behavior choice, changed default, new control, or removal of deliberate behavior. An explicit request settles the choices it specifies. Bug fixes restore the behavior the code claims to provide.

## Runtime Boundaries

- `packages/ui`: shared React UI, state, sync, and runtime contracts.
- `packages/web`: web surfaces, OpenChamber server, managed/external OpenCode lifecycle, and CLI.
- `packages/electron`: native desktop shell and privileged Electron boundary.
- `packages/vscode`: extension host, webview, and runtime bridge.
- `packages/mobile`: Capacitor iOS/Android shell; bundles the mobile web surface and connects to an existing OpenChamber server.
- `packages/docs`: product documentation; not a Bun workspace.
- `packages/sdk`: guest contract for third-party panels. Manifest parse, iframe envelope, `connectHost`. Host and guest import from here; do not copy these types into `packages/ui`.
- `packages/extensions`: app-owned SDK extensions and their build registry, not a Bun workspace. See its `DOCUMENTATION.md` for trust, packaging, and migration rules.

Shared UI data access and OpenCode calls: `ui-api-decoupling`.

Shared contracts must define intentional behavior for every applicable runtime: web, desktop, VS Code, hosted mobile, and Capacitor mobile.

## Always-On Constraints

- Do not modify `../opencode`; it is a separate repository.
- Do not run git or GitHub commands unless the user explicitly asks.
- Do not add dependencies unless explicitly requested.
- Never add or log secrets, bearer tokens, pairing credentials, or sensitive user data.
- Launch Google Chrome for automation with `--disable-features=MacAppCodeSignClone` (`scripts/perf/cdp.mjs` does). Without it each launch on macOS copies the 1.4 GB app into `$TMPDIR`, and a killed browser leaves the copy.
- Preserve unrelated worktree changes.
- Several agent sessions often work in the same checkout at once. Never `git stash` to compare against a clean tree or to test something: a stash takes every session's uncommitted work, and a session writing to a stashed file meanwhile makes the pop fail. Compare in a detached worktree instead (`git worktree add --detach /tmp/<name> HEAD`, with `node_modules` symlinked).
- `changelog/` is read-only, and a fix, feature, or merged PR lands without a changelog line. Release notes are written only when the maintainer asks to update the changelog, through the `update-changelog` skill.
- Enforce security and correctness in core/runtime logic, not only UI visibility or prompts.

## Correctness Invariants

- Prefer authoritative state over heuristics.
- Derive live activity from live channels, not persisted history.
- Scope temporary fallbacks narrowly and clear them when authoritative state arrives.
- Never let fetch failure masquerade as authoritative empty success.
- Make partial results, rollback, cleanup, and stale-data behavior explicit.
- One failed entity must not erase or block unrelated complete entities.

## Communication

Answer in the language you were addressed in; code, comments, and docs stay in English.

Load the `communication-style` skill once, at the start of the session, before your first reply. It stays in context for the rest of the session: every reply, in any language, and every text people read follows it. Later turns use it as loaded; they do not load it again.

## Project Skills

Project skills live in `.agents/skills/*/SKILL.md`, and each skill's `description`
says when it applies. If your tool does not list skill descriptions, read them in
those files before you start. Pure code-reading or explanation needs no
implementation skills unless a specialized subsystem has to be interpreted.

## Validation

- Use `package.json` scripts as the command source of truth. Which checks a change needs is in `openchamber-change-discipline`.
- Before every commit of source changes, `bun run check:changed` passes (`scripts/check-changed.mjs` says what it runs). Fix the new findings; the pre-existing backlog stays out of scope unless the task is that cleanup. Never silence a rule, weaken severity, or launder types to make a check pass.
