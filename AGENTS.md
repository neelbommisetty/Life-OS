# Life-OS

Current scope is the local file-backed milestone in docs/vision/LOCAL-FIRST-SLICE.md. Preserve the approved Perspective and Plan behavior. The longer-term architecture is in docs/vision/VISION.md; it does not authorize implementing every planned service now.

Run from this repository with Bun. The web app uses Next.js on Node. Use `bun run typecheck`, `bun run test`, `bun run check:data`, and `bun run build` for relevant checks. Do not restore legacy code or read legacy environment values just because their files remain.

Personal runtime data belongs in the ignored `.local/` directory. Do not commit credentials, runtime snapshots, test screenshots containing personal content, or build output. No deployment or source-control push is authorized by a request to develop locally.

The attached Life vault is separate and shared, not isolated by a code branch or worktree. Before any vault work, read its current root and applicable folder-local AGENTS.md files. Do not read Archive by default. Todoist uses the `td` CLI exclusively. This milestone does not modify the vault, tasks, or calendar.

## Tools package and life CLI

`packages/tools` is the authorized todo-list milestone per `docs/vision/HANDS.md`. The `life` CLI (see `skills/todo/SKILL.md`) is the way agents act on the list: adding, changing, scheduling, completing, or reading tasks. `LIFE_DATABASE_URL` lives in the root `.env`. The calendar piece of `HANDS.md` is specced (D44, D55 to D66) and its implementation brief is the "The calendar" section of `packages/tools/README.md`; build only what that brief describes.
