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
            return "Couldn't connect. Check LIFE_OS_API_BASE_URL."
        case .invalidResponse:
            return Brand.couldnt("read the server response")
        case .unauthorized(let message):
            return message
        case .server(_, let message):
            return message
        case .invalidBody:
            return Brand.couldnt("send that request")
        }
    }

    var isUnauthorized: Bool {
        if case .unauthorized = self {
            return true
        }
        return false
    }
}
