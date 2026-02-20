import Foundation

struct IOSMockAPIResponse {
    let statusCode: Int
    let data: Data
}

actor IOSMockAPI {
    static let shared = IOSMockAPI()

    private var isAuthenticated = false
    private var userId = "user-ios-mock"
    private var userName = "Demo User"
    private var userEmail = "demo@lifeos.dev"
    private var password = "demo12345"
    private var inboxItems: [[String: Any]] = []
    private var nextInboxSequence = 1
    private var shouldFailInboxCreateOnce = ProcessInfo.processInfo.environment["LIFE_OS_MOCK_INBOX_CREATE_FAIL_ONCE"] == "1"
    private var hasConsumedInboxCreateFailure = false
    private var shouldForceInboxUnauthorizedOnce = ProcessInfo.processInfo.environment["LIFE_OS_MOCK_INBOX_UNAUTHORIZED_ONCE"] == "1"
    private var hasConsumedInboxUnauthorizedFailure = false

    private let recentProjects: [[String: Any]] = [
        [
            "id": "project-ios-1",
            "name": "Life Planning",
            "description": "Weekly planning and goals"
        ],
        [
            "id": "project-ios-2",
            "name": "Fitness",
            "description": "Training schedule and recovery"
        ]
    ]

    private let upcomingTasks: [[String: Any]] = [
        [
            "id": "task-ios-1",
            "title": "Review weekly goals",
            "description": "Assess progress and adjust priorities",
            "status": "TODO",
            "dueDate": "2026-02-11"
        ],
        [
            "id": "task-ios-2",
            "title": "Prepare sprint notes",
            "description": "Summarize outcomes and blockers",
            "status": "IN_PROGRESS",
            "dueDate": "2026-02-12"
        ]
    ]

    private let notes: [[String: Any]] = [
        [
            "id": "note-ios-1",
            "title": "Morning Notes",
            "content": "Focus blocks and deep work priorities.",
            "updatedAt": "2026-02-10T12:00:00.000Z"
        ],
        [
            "id": "note-ios-2",
            "title": "Project Reflection",
            "content": "Capture lessons from the latest sprint.",
            "updatedAt": "2026-02-10T09:30:00.000Z"
        ]
    ]

    func reset() {
        isAuthenticated = false
        userId = "user-ios-mock"
        userName = "Demo User"
        userEmail = "demo@lifeos.dev"
        password = "demo12345"
        inboxItems = []
        nextInboxSequence = 1
        shouldFailInboxCreateOnce = ProcessInfo.processInfo.environment["LIFE_OS_MOCK_INBOX_CREATE_FAIL_ONCE"] == "1"
        hasConsumedInboxCreateFailure = false
        shouldForceInboxUnauthorizedOnce = ProcessInfo.processInfo.environment["LIFE_OS_MOCK_INBOX_UNAUTHORIZED_ONCE"] == "1"
        hasConsumedInboxUnauthorizedFailure = false
    }

    func request(path: String, method: String, body: [String: String]?) -> IOSMockAPIResponse {
        let normalizedPath = path.hasPrefix("/") ? path : "/\(path)"
        let normalizedMethod = method.uppercased()

        if isAuthPath(normalizedPath, canonical: "/auth/get-session"), normalizedMethod == "GET" {
            guard isAuthenticated else {
                return errorResponse(statusCode: 401, message: "Unauthorized")
            }
            return jsonResponse(statusCode: 200, object: sessionPayload())
        }

        if isAuthPath(normalizedPath, canonical: "/auth/sign-in/email"), normalizedMethod == "POST" {
            let email = body?["email"] ?? ""
            let submittedPassword = body?["password"] ?? ""
            guard email == userEmail, submittedPassword == password else {
                return errorResponse(statusCode: 401, message: "Invalid email or password")
            }

            isAuthenticated = true
            return jsonResponse(statusCode: 200, object: ["success": true])
        }

        if isAuthPath(normalizedPath, canonical: "/auth/sign-up/email"), normalizedMethod == "POST" {
            let email = body?["email"] ?? ""
            let name = body?["name"] ?? ""
            let submittedPassword = body?["password"] ?? ""

            if email.hasSuffix("@taken.dev") {
                return errorResponse(statusCode: 409, message: "Email already exists")
            }

            guard !email.isEmpty, !name.isEmpty, !submittedPassword.isEmpty else {
                return errorResponse(statusCode: 400, message: "Missing required fields")
            }

            userEmail = email
            userName = name
            password = submittedPassword
            isAuthenticated = true

            return jsonResponse(statusCode: 200, object: ["success": true])
        }

        if isAuthPath(normalizedPath, canonical: "/auth/request-password-reset"), normalizedMethod == "POST" {
            let email = body?["email"] ?? ""
            if email == "missing@lifeos.dev" {
                return errorResponse(statusCode: 404, message: "Account not found")
            }

            return jsonResponse(statusCode: 200, object: ["success": true])
        }

        if isAuthPath(normalizedPath, canonical: "/auth/reset-password"), normalizedMethod == "POST" {
            let token = body?["token"] ?? ""
            let newPassword = body?["newPassword"] ?? ""
            guard token == "valid-reset-token", newPassword.count >= 8 else {
                return errorResponse(statusCode: 400, message: "Invalid or expired reset token")
            }

            password = newPassword
            return jsonResponse(statusCode: 200, object: ["success": true])
        }

        if isAuthPath(normalizedPath, canonical: "/auth/update-user"), normalizedMethod == "POST" {
            guard isAuthenticated else {
                return errorResponse(statusCode: 401, message: "Unauthorized")
            }

            let name = body?["name"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !name.isEmpty else {
                return errorResponse(statusCode: 400, message: "Name is required")
            }

            userName = name
            return jsonResponse(statusCode: 200, object: sessionPayload())
        }

        if isAuthPath(normalizedPath, canonical: "/auth/change-password"), normalizedMethod == "POST" {
            guard isAuthenticated else {
                return errorResponse(statusCode: 401, message: "Unauthorized")
            }

            let currentPassword = body?["currentPassword"] ?? ""
            let newPassword = body?["newPassword"] ?? ""

            guard currentPassword == password else {
                return errorResponse(statusCode: 400, message: "Current password is incorrect")
            }

            guard newPassword.count >= 8 else {
                return errorResponse(statusCode: 400, message: "Password must be at least 8 characters")
            }

            password = newPassword
            return jsonResponse(statusCode: 200, object: ["success": true])
        }

        if isAuthPath(normalizedPath, canonical: "/auth/sign-out"), normalizedMethod == "POST" {
            isAuthenticated = false
            return jsonResponse(statusCode: 200, object: ["success": true])
        }

        if isResourcePath(normalizedPath, canonical: "/home/recent-projects"), normalizedMethod == "GET" {
            guard isAuthenticated else {
                return errorResponse(statusCode: 401, message: "Unauthorized")
            }
            return jsonResponse(statusCode: 200, object: recentProjects)
        }

        if isResourcePath(normalizedPath, canonical: "/home/upcoming-tasks"), normalizedMethod == "GET" {
            guard isAuthenticated else {
                return errorResponse(statusCode: 401, message: "Unauthorized")
            }
            return jsonResponse(statusCode: 200, object: upcomingTasks)
        }

        if isResourcePath(normalizedPath, canonical: "/home/recent-notes"), normalizedMethod == "GET" {
            guard isAuthenticated else {
                return errorResponse(statusCode: 401, message: "Unauthorized")
            }
            return jsonResponse(statusCode: 200, object: notes)
        }

        if isResourcePath(normalizedPath, canonical: "/notes"), normalizedMethod == "GET" {
            guard isAuthenticated else {
                return errorResponse(statusCode: 401, message: "Unauthorized")
            }
            return jsonResponse(statusCode: 200, object: notes)
        }

        if isResourcePath(normalizedPath, canonical: "/inbox"), normalizedMethod == "GET" {
            guard isAuthenticated else {
                return errorResponse(statusCode: 401, message: "Unauthorized")
            }

            if shouldForceInboxUnauthorizedOnce, !hasConsumedInboxUnauthorizedFailure {
                hasConsumedInboxUnauthorizedFailure = true
                isAuthenticated = false
                return errorResponse(statusCode: 401, message: "Unauthorized")
            }

            let sortedItems = inboxItems.sorted { lhs, rhs in
                let lhsValue = (lhs["createdAt"] as? String) ?? ""
                let rhsValue = (rhs["createdAt"] as? String) ?? ""
                return lhsValue > rhsValue
            }
            return jsonResponse(statusCode: 200, object: sortedItems)
        }

        if isResourcePath(normalizedPath, canonical: "/inbox"), normalizedMethod == "POST" {
            guard isAuthenticated else {
                return errorResponse(statusCode: 401, message: "Unauthorized")
            }

            if ProcessInfo.processInfo.environment["LIFE_OS_MOCK_INBOX_CREATE_FAIL"] == "1" {
                return errorResponse(statusCode: 500, message: "Inbox save failed")
            }

            if shouldFailInboxCreateOnce, !hasConsumedInboxCreateFailure {
                hasConsumedInboxCreateFailure = true
                return errorResponse(statusCode: 500, message: "Inbox save failed")
            }

            let content = body?["content"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !content.isEmpty else {
                return errorResponse(statusCode: 400, message: "Content is required")
            }

            let itemId = "inbox-ios-\(nextInboxSequence)"
            nextInboxSequence += 1

            let now = ISO8601DateFormatter().string(from: Date())
            let newItem: [String: Any] = [
                "id": itemId,
                "content": content,
                "state": "SAVED",
                "createdAt": now,
                "updatedAt": now,
                "processedAt": NSNull(),
                "archivedAt": NSNull(),
            ]
            inboxItems.append(newItem)

            return jsonResponse(statusCode: 201, object: newItem)
        }

        return errorResponse(statusCode: 404, message: "Not found")
    }

    private func isResourcePath(_ path: String, canonical: String) -> Bool {
        path == canonical
    }

    private func isAuthPath(_ path: String, canonical: String) -> Bool {
        path == canonical
    }

    private func sessionPayload() -> [String: Any] {
        [
            "data": [
                "session": [
                    "user": [
                        "id": userId,
                        "name": userName,
                        "email": userEmail
                    ]
                ]
            ]
        ]
    }

    private func jsonResponse(statusCode: Int, object: Any) -> IOSMockAPIResponse {
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
        return IOSMockAPIResponse(statusCode: statusCode, data: data)
    }

    private func errorResponse(statusCode: Int, message: String) -> IOSMockAPIResponse {
        jsonResponse(statusCode: statusCode, object: ["message": message])
    }
}
