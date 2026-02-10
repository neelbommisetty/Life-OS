import Foundation

enum AppNetworkError: LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized(String)
    case server(status: Int, message: String)
    case invalidBody

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid API URL. Set LIFE_OS_API_BASE_URL for iOS app config."
        case .invalidResponse:
            return "Invalid server response"
        case .unauthorized(let message):
            return message
        case .server(_, let message):
            return message
        case .invalidBody:
            return "Invalid request payload"
        }
    }

    var isUnauthorized: Bool {
        if case .unauthorized = self {
            return true
        }
        return false
    }
}
