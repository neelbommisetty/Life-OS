import Foundation

struct AppDataService {
    private let api = APIClient()

    func loadHomeSnapshot() async throws -> HomeSnapshot {
        async let projectsData = api.request(path: "/home/recent-projects")
        async let tasksData = api.request(path: "/home/upcoming-tasks")
        async let notesData = api.request(path: "/home/recent-notes")

        let decoder = JSONDecoder()
        return HomeSnapshot(
            recentProjects: try decoder.decode([ProjectItem].self, from: try await projectsData),
            upcomingTasks: try decoder.decode([TaskItem].self, from: try await tasksData),
            recentNotes: try decoder.decode([NoteItem].self, from: try await notesData)
        )
    }

    func listNotes() async throws -> [NoteItem] {
        let data = try await api.request(path: "/notes")
        return try JSONDecoder().decode([NoteItem].self, from: data)
    }

    func listInboxItems() async throws -> [InboxAPIItem] {
        let data = try await api.request(path: "/inbox")
        return try JSONDecoder().decode([InboxAPIItem].self, from: data)
    }

    func createInboxItem(content: String) async throws -> InboxAPIItem {
        let data = try await api.request(
            path: "/inbox",
            method: "POST",
            body: [
                "content": content,
            ]
        )
        return try JSONDecoder().decode(InboxAPIItem.self, from: data)
    }
}
