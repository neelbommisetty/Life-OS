import Combine
import Foundation
import SwiftData
import SwiftUI

enum AuthFlow: String, CaseIterable, Identifiable {
    case signIn
    case signUp
    case recover
    case resetPassword

    var id: String { rawValue }

    var title: String {
        switch self {
        case .signIn:
            return "Sign in"
        case .signUp:
            return "Create account"
        case .recover:
            return "Forgot password"
        case .resetPassword:
            return "Set new password"
        }
    }
}

@MainActor
final class AppState: ObservableObject {
    @Published var sessionUser: SessionUser?
    @Published var isBootstrapping = true
    @Published var isSubmittingAuth = false
    @Published var authFlow: AuthFlow = .signIn
    @Published var authError: String?
    @Published var authSuccess: String?
    @Published var resetToken = ""

    @Published var homeSnapshot = HomeSnapshot()
    @Published var notes: [NoteItem] = []
    @Published var isRefreshingProtectedData = false
    @Published var protectedError: String?
    @Published var isRefreshingInbox = false
    @Published var isRetryingPendingInboxCreates = false
    @Published var inboxError: String?
    @Published var accountError: String?
    @Published var accountSuccess: String?

    private let authService = AuthService()
    private let appDataService = AppDataService()
    private var didBootstrap = false
    private let inboxCacheResetMigrationKey = "ios.inbox.cache.reset.2026_02_15"

    func bootstrapSessionIfNeeded(modelContext: ModelContext) async {
        guard !didBootstrap else { return }
        didBootstrap = true
        defer { isBootstrapping = false }

        resetInboxCacheIfNeeded(modelContext: modelContext)

        do {
            sessionUser = try await authService.getSession()
            if sessionUser != nil {
                await refreshInbox(modelContext: modelContext)
            }
        } catch {
            authError = error.userFacingMessage
            sessionUser = nil
            authFlow = .signIn
        }
    }

    func clearAuthFeedback() {
        authError = nil
        authSuccess = nil
    }

    func captureResetToken(from url: URL) {
        guard url.path.contains("reset-password") else { return }
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let token = components.queryItems?.first(where: { $0.name == "token" })?.value,
            !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return
        }

        resetToken = token
        authFlow = .resetPassword
        authError = nil
        authSuccess = Brand.Messages.resetLinkOpened
    }

    func signIn(email: String, password: String) async {
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !isSubmittingAuth else { return }
        guard !normalizedEmail.isEmpty else {
            authError = Brand.Messages.emailRequired
            return
        }
        guard !password.isEmpty else {
            authError = Brand.Messages.passwordRequired
            return
        }

        isSubmittingAuth = true
        clearAuthFeedback()
        defer { isSubmittingAuth = false }

        do {
            sessionUser = try await authService.signIn(
                email: normalizedEmail,
                password: password
            )
            authFlow = .signIn
            await refreshProtectedData()
            inboxError = nil
        } catch {
            authError = error.userFacingMessage
        }
    }

    func signUp(name: String, email: String, password: String) async {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !isSubmittingAuth else { return }
        guard !trimmedName.isEmpty else {
            authError = Brand.Messages.nameRequired
            return
        }
        guard !normalizedEmail.isEmpty else {
            authError = Brand.Messages.emailRequired
            return
        }
        guard !password.isEmpty else {
            authError = Brand.Messages.passwordRequired
            return
        }

        isSubmittingAuth = true
        clearAuthFeedback()
        defer { isSubmittingAuth = false }

        do {
            sessionUser = try await authService.signUp(
                name: trimmedName,
                email: normalizedEmail,
                password: password
            )
            authFlow = .signIn
            await refreshProtectedData()
            inboxError = nil
        } catch {
            authError = error.userFacingMessage
        }
    }

    func requestPasswordReset(email: String) async {
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !isSubmittingAuth else { return }
        guard !normalizedEmail.isEmpty else {
            authError = Brand.Messages.emailRequired
            return
        }

        isSubmittingAuth = true
        clearAuthFeedback()
        defer { isSubmittingAuth = false }

        do {
            try await authService.requestPasswordReset(email: normalizedEmail)
            authSuccess = Brand.Messages.resetLinkSent
        } catch {
            authError = error.userFacingMessage
        }
    }

    func resetPassword(token: String, newPassword: String, confirmPassword: String) async {
        guard !isSubmittingAuth else { return }

        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedToken.isEmpty else {
            authError = Brand.Messages.missingResetToken
            return
        }

        guard newPassword == confirmPassword else {
            authError = Brand.Messages.passwordsDontMatch
            return
        }

        guard !newPassword.isEmpty else {
            authError = Brand.Messages.newPasswordRequired
            return
        }

        isSubmittingAuth = true
        clearAuthFeedback()
        defer { isSubmittingAuth = false }

        do {
            try await authService.resetPassword(token: trimmedToken, newPassword: newPassword)
            authFlow = .signIn
            authSuccess = Brand.Messages.passwordUpdatedSignIn
        } catch {
            authError = error.userFacingMessage
        }
    }

    func signOut() async {
        guard !isSubmittingAuth else { return }
        isSubmittingAuth = true
        clearAuthFeedback()
        defer { isSubmittingAuth = false }

        do {
            try await authService.signOut()
        } catch {
            // On sign-out errors, force local logout anyway.
        }

        homeSnapshot = HomeSnapshot()
        notes = []
        sessionUser = nil
        authFlow = .signIn
    }

    func refreshProtectedData() async {
        guard sessionUser != nil else { return }

        isRefreshingProtectedData = true
        protectedError = nil
        defer { isRefreshingProtectedData = false }

        do {
            async let home = appDataService.loadHomeSnapshot()
            async let allNotes = appDataService.listNotes()

            homeSnapshot = try await home
            notes = try await allNotes
        } catch {
            if error.isUnauthorized {
                sessionUser = nil
                authFlow = .signIn
                authError = Brand.Messages.sessionExpired
            } else {
                protectedError = error.userFacingMessage
            }
        }
    }

    func refreshInbox(modelContext: ModelContext) async {
        guard sessionUser != nil else { return }

        isRefreshingInbox = true
        inboxError = nil
        defer { isRefreshingInbox = false }

        do {
            let remoteItems = try await appDataService.listInboxItems()
            try mergeInboxCache(
                with: remoteItems,
                modelContext: modelContext
            )
            try modelContext.save()
        } catch {
            if error.isUnauthorized {
                handleUnauthorizedSession()
            } else {
                inboxError = error.userFacingMessage
            }
        }
    }

    func createInboxFromCapture(content: String, modelContext: ModelContext) async -> Bool {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        do {
            let remoteItem = try await appDataService.createInboxItem(content: trimmed)
            try upsertInboxItem(
                from: remoteItem,
                modelContext: modelContext
            )
            try modelContext.save()
            inboxError = nil
            return true
        } catch {
            let unsyncedItem = InboxItem(
                content: trimmed,
                state: InboxItemState.saved.rawValue,
                createdAt: Date(),
                updatedAt: nil,
                syncStatus: InboxItemSyncStatus.failedCreate.rawValue,
                lastSyncError: error.userFacingMessage
            )
            modelContext.insert(unsyncedItem)
            try? modelContext.save()

            if error.isUnauthorized {
                handleUnauthorizedSession()
            } else {
                inboxError = error.userFacingMessage
            }
            return true
        }
    }

    func retryPendingInboxCreates(modelContext: ModelContext) async {
        guard sessionUser != nil else { return }
        guard !isRetryingPendingInboxCreates else { return }

        isRetryingPendingInboxCreates = true
        inboxError = nil
        defer { isRetryingPendingInboxCreates = false }

        do {
            let descriptor = FetchDescriptor<InboxItem>(
                sortBy: [SortDescriptor(\InboxItem.createdAt)]
            )
            let allItems = try modelContext.fetch(descriptor)
            let pendingItems = allItems.filter {
                $0.syncStatus == InboxItemSyncStatus.pendingCreate.rawValue
                    || $0.syncStatus == InboxItemSyncStatus.failedCreate.rawValue
            }

            for item in pendingItems {
                do {
                    item.syncStatus = InboxItemSyncStatus.pendingCreate.rawValue
                    let remoteItem = try await appDataService.createInboxItem(content: item.content)
                    item.serverId = remoteItem.id
                    item.content = remoteItem.content
                    item.state = remoteItem.state
                    item.createdAt = remoteItem.createdAt
                    item.updatedAt = remoteItem.updatedAt
                    item.syncStatus = InboxItemSyncStatus.synced.rawValue
                    item.lastSyncError = nil
                } catch {
                    item.syncStatus = InboxItemSyncStatus.failedCreate.rawValue
                    item.lastSyncError = error.userFacingMessage

                    if error.isUnauthorized {
                        try modelContext.save()
                        handleUnauthorizedSession()
                        return
                    }
                }
            }

            try modelContext.save()
            await refreshInbox(modelContext: modelContext)
        } catch {
            inboxError = error.userFacingMessage
        }
    }

    func clearAccountFeedback() {
        accountError = nil
        accountSuccess = nil
    }

    func updateProfile(name: String) async {
        guard !isSubmittingAuth else { return }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedName.isEmpty else {
            accountError = Brand.Messages.nameRequired
            return
        }

        isSubmittingAuth = true
        clearAccountFeedback()
        defer { isSubmittingAuth = false }

        do {
            let updatedSession = try await authService.updateProfile(name: trimmedName)
            if let updatedSession {
                sessionUser = updatedSession
            } else {
                guard let refreshedSession = try await authService.getSession() else {
                    throw AppNetworkError.unauthorized("Unauthorized")
                }
                sessionUser = refreshedSession
            }
            accountSuccess = Brand.Messages.profileUpdated
        } catch {
            if error.isUnauthorized {
                sessionUser = nil
                authFlow = .signIn
                authError = Brand.Messages.sessionExpired
            } else {
                accountError = error.userFacingMessage
            }
        }
    }

    func changePassword(currentPassword: String, newPassword: String, confirmPassword: String) async {
        guard !isSubmittingAuth else { return }

        guard !currentPassword.isEmpty else {
            accountError = Brand.Messages.currentPasswordRequired
            return
        }

        guard !newPassword.isEmpty else {
            accountError = Brand.Messages.newPasswordRequired
            return
        }

        guard newPassword == confirmPassword else {
            accountError = Brand.Messages.passwordsDontMatch
            return
        }

        isSubmittingAuth = true
        clearAccountFeedback()
        defer { isSubmittingAuth = false }

        do {
            try await authService.changePassword(
                currentPassword: currentPassword,
                newPassword: newPassword
            )
            accountSuccess = Brand.Messages.passwordUpdated
        } catch {
            if error.isUnauthorized {
                sessionUser = nil
                authFlow = .signIn
                authError = Brand.Messages.sessionExpired
            } else {
                accountError = error.userFacingMessage
            }
        }
    }

    private func handleUnauthorizedSession() {
        sessionUser = nil
        authFlow = .signIn
        authError = Brand.Messages.sessionExpired
    }

    private func resetInboxCacheIfNeeded(modelContext: ModelContext) {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: inboxCacheResetMigrationKey) else { return }

        let descriptor = FetchDescriptor<InboxItem>()
        if let cachedItems = try? modelContext.fetch(descriptor) {
            for item in cachedItems {
                modelContext.delete(item)
            }
            try? modelContext.save()
        }

        defaults.set(true, forKey: inboxCacheResetMigrationKey)
    }

    private func mergeInboxCache(with remoteItems: [InboxAPIItem], modelContext: ModelContext) throws {
        let descriptor = FetchDescriptor<InboxItem>()
        let cachedItems = try modelContext.fetch(descriptor)

        var cachedByServerId: [String: InboxItem] = [:]
        for item in cachedItems {
            if let serverId = item.serverId {
                cachedByServerId[serverId] = item
            }
        }

        var remoteServerIds: Set<String> = []

        for remoteItem in remoteItems {
            remoteServerIds.insert(remoteItem.id)

            if let cached = cachedByServerId[remoteItem.id] {
                cached.content = remoteItem.content
                cached.state = remoteItem.state
                cached.createdAt = remoteItem.createdAt
                cached.updatedAt = remoteItem.updatedAt
                cached.syncStatus = InboxItemSyncStatus.synced.rawValue
                cached.lastSyncError = nil
            } else {
                let cacheItem = InboxItem(
                    serverId: remoteItem.id,
                    content: remoteItem.content,
                    state: remoteItem.state,
                    createdAt: remoteItem.createdAt,
                    updatedAt: remoteItem.updatedAt,
                    syncStatus: InboxItemSyncStatus.synced.rawValue,
                    lastSyncError: nil
                )
                modelContext.insert(cacheItem)
            }
        }

        for item in cachedItems {
            guard item.syncStatus == InboxItemSyncStatus.synced.rawValue else { continue }
            guard let serverId = item.serverId else { continue }

            if !remoteServerIds.contains(serverId) {
                modelContext.delete(item)
            }
        }
    }

    private func upsertInboxItem(from remoteItem: InboxAPIItem, modelContext: ModelContext) throws {
        let descriptor = FetchDescriptor<InboxItem>()
        let cachedItems = try modelContext.fetch(descriptor)

        if let existing = cachedItems.first(where: { $0.serverId == remoteItem.id }) {
            existing.content = remoteItem.content
            existing.state = remoteItem.state
            existing.createdAt = remoteItem.createdAt
            existing.updatedAt = remoteItem.updatedAt
            existing.syncStatus = InboxItemSyncStatus.synced.rawValue
            existing.lastSyncError = nil
            return
        }

        let newItem = InboxItem(
            serverId: remoteItem.id,
            content: remoteItem.content,
            state: remoteItem.state,
            createdAt: remoteItem.createdAt,
            updatedAt: remoteItem.updatedAt,
            syncStatus: InboxItemSyncStatus.synced.rawValue,
            lastSyncError: nil
        )
        modelContext.insert(newItem)
    }
}
