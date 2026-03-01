import Foundation

enum Brand {
    static let productName = "Life-OS"

    enum Descriptions {
        static let app =
            "Life-OS organizes tasks, notes, and conversations into a clear plan you can review and act on."
    }

    enum Terms {
        static let assistant = "Assistant"
        static let inbox = "Inbox"
        static let library = "Library"
        static let plan = "Plan"
    }

    enum TermState: String {
        case approved
        case legacy
        case underReview = "under_review"
    }

    enum TermStatus {
        static let assistant: TermState = .approved
        static let inbox: TermState = .approved
        static let library: TermState = .underReview
        static let plan: TermState = .approved
    }

    enum Messages {
        static let sessionExpired = "Session expired. Sign in again."
        static let nameRequired = "Name required."
        static let emailRequired = "Email required."
        static let passwordRequired = "Password required."
        static let newPasswordRequired = "New password required."
        static let currentPasswordRequired = "Current password required."
        static let passwordsDontMatch = "Passwords don't match."
        static let missingResetToken = "Missing reset token. Open the reset link again."
        static let profileUpdated = "Profile updated."
        static let passwordUpdated = "Password updated."
        static let passwordUpdatedSignIn = "Password updated. Sign in."
        static let resetLinkOpened = "Reset link opened. Set a new password to continue."
        static let resetLinkSent = "If that email exists, a password reset link has been sent."
    }

    enum Capture {
        static let title = "Capture"
        static let placeholder = "Capture a thought or start speaking"
        static let saveButton = "Save"
        static let saveToInbox = "Save to Inbox"
        static let savedConfirmation = "Saved to Inbox"
    }

    enum Inbox {
        static let emptyTitle = "No inbox items yet"
        static let emptyDescription = "Save a capture to review it here."
        static let retryAll = "Retry all"
        static let detailTitle = "Inbox item"
        static let notSynced = "Not synced"
    }

    static func couldnt(
        _ action: String,
        safeState: String? = nil,
        nextStep: String? = "Please try again."
    ) -> String {
        let parts: [String?] = ["Couldn't \(action).", toSentence(safeState), toSentence(nextStep)]
        return parts.compactMap { $0 }.joined(separator: " ")
    }

    private static func toSentence(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }

        if let lastCharacter = trimmed.last, [".", "!", "?"].contains(String(lastCharacter)) {
            return trimmed
        }

        return "\(trimmed)."
    }
}
