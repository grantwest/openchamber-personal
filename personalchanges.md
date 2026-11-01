# Personal changes

This file records Grant West's personal OpenChamber customizations. Read it before changing code or resolving upstream merge conflicts.

## Fork maintenance policy

The repository is a long-running personal fork at `grantwest/openchamber-personal`. Upstream releases come from `openchamber/openchamber`. Personal work stays on `main`, and upstream updates merge exact stable release tags after validation in a separate worktree.

`AGENTS.md` owns the maintenance rules. Commit messages must preserve the motivation, requirements, decisions, and validation needed to resolve future conflicts. Upstream contribution and public backlog workflows do not apply. The PR review and issue/PR triage skills, public PR/backlog command wrappers, and public PR review/issue intake agents are removed. Local correctness review remains available. The Russian-language exclusion comment is removed from the locale skill. Unrelated wording and formatting in `AGENTS.md` stay as upstream wrote them to minimize merge conflicts.

Validation for the policy change checks the remaining agent instructions for references to removed skills and exercises the maintenance rules with a read-only agent scenario. No application behavior changes in this policy update.

## Requested subpath hosting

Grant wants OpenChamber available at `https://lab.grantwest.dev/openchamber` behind a path-based reverse proxy. Initial source inspection found no complete deployment base-path configuration. Subpath hosting is not implemented or runtime-tested by this policy change.
