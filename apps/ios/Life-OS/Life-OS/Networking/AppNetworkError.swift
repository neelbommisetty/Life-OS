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
            return "Couldn't connect. Check the app connection settings."
        case .invalidResponse:
            return Brand.couldnt(
                "read the server response",
                safeState: "Your data is unchanged",
                nextStep: "Please try again in a moment"
            )
        case .unauthorized(let message):
            return message
        case .server(_, let message):
            return message
        case .invalidBody:
            return Brand.couldnt(
                "send that request",
                safeState: "Your data is unchanged",
                nextStep: "Please try again"
            )
        }
    }

    var isUnauthorized: Bool {
        if case .unauthorized = self {
            return true
        }
        return false
    }
}
