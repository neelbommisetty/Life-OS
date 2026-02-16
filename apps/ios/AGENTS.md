# iOS App Instructions (`apps/ios`)

These instructions apply to all files under `apps/ios/*`.

## Scope and stack

- iOS code is Swift + SwiftUI only.
- Do not apply web/api TypeScript conventions inside `apps/ios`.
- Keep iOS implementation self-contained in `apps/ios/Life-OS`.

## iOS visual design policy

- Prefer native, minimalist iOS UI patterns over custom visual systems.
- Use system SwiftUI building blocks first: `Form`, `List`, `Section`, `NavigationStack`, `TabView`, standard `Button` styles, and SF Symbols.
- Use semantic/system colors and materials, not hardcoded custom theme palettes.
- Do not add custom iOS design-system token layers or style abstractions unless explicitly requested.
- Avoid decorative glassmorphism-heavy treatments on core product screens.
- Keep spacing and interaction patterns consistent across auth, home, notes, and account screens.
- Preserve existing accessibility identifiers on auth/account controls so XCUITests remain stable.

## Current architecture

- Keep root composition in `apps/ios/Life-OS/Life-OS/ContentView.swift`.
- Put business/session state in `apps/ios/Life-OS/Life-OS/State`.
- Put API/domain models in `apps/ios/Life-OS/Life-OS/Models`.
- Put network/auth/data clients in `apps/ios/Life-OS/Life-OS/Networking`.
- Put deterministic mock backend in `apps/ios/Life-OS/Life-OS/Mocks`.
- Put reusable helpers/extensions in `apps/ios/Life-OS/Life-OS/Support`.
- Put SwiftUI screen/tab components in `apps/ios/Life-OS/Life-OS/Views`.

## Auth and app behavior

- Keep every app view behind authenticated session state.
- Unauthenticated state must render auth gateway only.
- Authenticated state must render tab shell only.
- On unauthorized API responses, route user back to sign-in state.
- Maintain accessibility identifiers for auth/account controls because XCUITests depend on them.

## API and environment rules

- Use canonical no-prefix backend routes only (including auth as `/auth/*` and app data as `/home/*`, `/notes*`, `/inbox*`).
- Keep API access centralized via `APIClient`, `AuthService`, and `AppDataService`.
- Use `LIFE_OS_API_BASE_URL` for real backend endpoint configuration.
- Use `LIFE_OS_USE_MOCK_API=1` for deterministic local/unit/UI test behavior.

## Testing requirements

- Unit tests: `apps/ios/Life-OS/Life-OSTests` (XCTest).
- UI e2e tests: `apps/ios/Life-OS/Life-OSUITests` (XCUITest).
- When changing iOS auth/navigation/data behavior, update both unit and UI coverage in the same change.
- Keep selectors/assertions resilient to simulator timing and keyboard state.

## Required validation commands

- Run iOS unit tests:
  - `xcodebuild -project apps/ios/Life-OS/Life-OS.xcodeproj -scheme Life-OS -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.2' -only-testing:'Life-OSTests' test`
- Run iOS UI tests:
  - `xcodebuild -project apps/ios/Life-OS/Life-OS.xcodeproj -scheme Life-OS -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.2' -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 -only-testing:'Life-OSUITests' test`

## Repo policy reminders

- Never use `git commit --no-verify`.
- Pre-commit is branch-aware: `main` runs iOS unit + UI tests when available, `develop` runs iOS unit tests when available, and other branches run iOS unit tests when staged files include `apps/ios/*`.
- Update `docs/test-plan.md` whenever iOS feature behavior changes.
