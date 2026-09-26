# Life-OS design context

The canonical design system is [docs/DESIGN.md](docs/DESIGN.md). Read it before creating or changing any Life-OS web slice. It records the finalized ocean-blue palette for all of Life-OS, along with shared typography, shell, spacing, components, responsive behavior, and interaction guidelines.

The generated token export and component contracts are in [docs/DESIGN.json](docs/DESIGN.json). The foundations are [apps/web/src/tokens.css](apps/web/src/tokens.css); shared styles are [apps/web/src/theme.css](apps/web/src/theme.css) and [shell.css](apps/web/src/shell.css). Task-specific layouts are in [todo.css](apps/web/src/todo.css).

Keep the full specification in `docs/` so this entry point cannot become a second, drifting copy of the theme.
