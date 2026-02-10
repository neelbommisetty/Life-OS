import Foundation

enum APIEnvironment {
    static var baseURL: URL {
        if let env = ProcessInfo.processInfo.environment["LIFE_OS_API_BASE_URL"]?.trimmedNonEmpty,
           let url = URL(string: env) {
            return url
        }

        if let plist = Bundle.main.object(forInfoDictionaryKey: "LIFE_OS_API_BASE_URL") as? String,
           let url = URL(string: plist.trimmingCharacters(in: .whitespacesAndNewlines)),
           !plist.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return url
        }

        return URL(string: "http://127.0.0.1:3001")!
    }

    static var useMockAPI: Bool {
        ProcessInfo.processInfo.environment["LIFE_OS_USE_MOCK_API"] == "1"
    }
}
