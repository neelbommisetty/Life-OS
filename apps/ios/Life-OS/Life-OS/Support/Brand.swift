import Foundation

enum Brand {
    static let productName = "Life-OS"
    static let oneSentenceDescription =
        "Life-OS is a minimalist AI personal assistant that organizes your tasks and knowledge into a clear plan—and helps execute it."

    enum Terms {
        static let assistant = "Assistant"
        static let inbox = "Inbox"
        static let library = "Library"
        static let plan = "Plan"
    }

    static func couldnt(_ action: String) -> String {
        "Couldn't \(action). Try again."
    }
}

