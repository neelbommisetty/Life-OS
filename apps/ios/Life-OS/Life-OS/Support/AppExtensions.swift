import Foundation

extension String {
    var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

extension Error {
    var userFacingMessage: String {
        if let networkError = self as? AppNetworkError {
            return networkError.errorDescription
                ?? Brand.couldnt(
                    "complete that request",
                    safeState: "Your data is unchanged"
                )
        }
        return localizedDescription
    }

    var isUnauthorized: Bool {
        (self as? AppNetworkError)?.isUnauthorized ?? false
    }
}
