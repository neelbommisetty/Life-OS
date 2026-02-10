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
