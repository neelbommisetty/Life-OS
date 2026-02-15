import Foundation

struct SessionUser: Decodable {
    let id: String
    let name: String?
    let email: String?
}

struct SessionPayload: Decodable {
    struct DataPayload: Decodable {
        struct SessionContainer: Decodable {
            let user: SessionUser?
        }

        let session: SessionContainer?
        let user: SessionUser?
    }

    let data: DataPayload?
    let user: SessionUser?

    var resolvedUser: SessionUser? {
        data?.session?.user ?? data?.user ?? user
    }
}

struct APIErrorPayload: Decodable {
    let message: String?
    let error: String?
}

struct HomeSnapshot {
    var recentProjects: [ProjectItem] = []
    var upcomingTasks: [TaskItem] = []
    var recentNotes: [NoteItem] = []

    var isEmpty: Bool {
        recentProjects.isEmpty && upcomingTasks.isEmpty && recentNotes.isEmpty
    }
}

struct ProjectItem: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String?
}

struct TaskItem: Decodable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let status: String?
    let dueDate: String?
}

struct NoteItem: Decodable, Identifiable {
    let id: String
    let title: String
    let content: String
    let updatedAt: String?
}

enum InboxItemState: String, CaseIterable {
    case saved = "SAVED"
    case processing = "PROCESSING"
    case review = "REVIEW"
    case processed = "PROCESSED"
    case archived = "ARCHIVED"
}

enum InboxItemSyncStatus: String, CaseIterable {
    case synced = "synced"
    case pendingCreate = "pending_create"
    case failedCreate = "failed_create"
}

struct InboxAPIItem: Decodable, Identifiable {
    let id: String
    let content: String
    let state: String
    let createdAt: Date
    let updatedAt: Date?
    let processedAt: Date?
    let archivedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case content
        case state
        case createdAt
        case updatedAt
        case processedAt
        case archivedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        content = try container.decode(String.self, forKey: .content)
        state = try container.decode(String.self, forKey: .state)

        let createdAtValue = try container.decode(String.self, forKey: .createdAt)
        guard let createdAtDate = AppISO8601DateParser.date(from: createdAtValue) else {
            throw DecodingError.dataCorruptedError(
                forKey: .createdAt,
                in: container,
                debugDescription: "Invalid createdAt date format"
            )
        }
        createdAt = createdAtDate

        let updatedAtValue = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        updatedAt = updatedAtValue.flatMap(AppISO8601DateParser.date(from:))

        let processedAtValue = try container.decodeIfPresent(String.self, forKey: .processedAt)
        processedAt = processedAtValue.flatMap(AppISO8601DateParser.date(from:))

        let archivedAtValue = try container.decodeIfPresent(String.self, forKey: .archivedAt)
        archivedAt = archivedAtValue.flatMap(AppISO8601DateParser.date(from:))
    }
}

enum AppISO8601DateParser {
    private static let parserWithFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]
        return formatter
    }()

    private static let parserWithoutFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [
            .withInternetDateTime,
        ]
        return formatter
    }()

    static func date(from value: String) -> Date? {
        parserWithFractionalSeconds.date(from: value)
            ?? parserWithoutFractionalSeconds.date(from: value)
    }
}
