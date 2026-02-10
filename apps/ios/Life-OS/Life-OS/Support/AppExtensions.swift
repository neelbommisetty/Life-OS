import Foundation
import SwiftUI

extension String {
    var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

extension Error {
    var userFacingMessage: String {
        if let networkError = self as? AppNetworkError {
            return networkError.errorDescription ?? "Something went wrong"
        }
        return localizedDescription
    }

    var isUnauthorized: Bool {
        (self as? AppNetworkError)?.isUnauthorized ?? false
    }
}

extension View {
    @ViewBuilder
    func liquidCard<S: Shape>(_ glass: Glass = .regular, in shape: S) -> some View {
#if os(visionOS)
        background(.ultraThinMaterial, in: shape)
#else
        if #available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *) {
            glassEffect(glass, in: shape)
        } else {
            background(.ultraThinMaterial, in: shape)
        }
#endif
    }

    func authInputStyle() -> some View {
        self
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color.white.opacity(0.16))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.white.opacity(0.26), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
