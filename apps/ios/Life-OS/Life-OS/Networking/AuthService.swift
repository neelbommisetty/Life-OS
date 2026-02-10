import Foundation

struct AuthService {
    private let api = APIClient()

    func getSession() async throws -> SessionUser? {
        do {
            let data = try await api.request(path: "/api/auth/get-session", method: "GET")
            let payload = try JSONDecoder().decode(SessionPayload.self, from: data)
            return payload.resolvedUser
        } catch {
            if error.isUnauthorized {
                return nil
            }
            throw error
        }
    }

    func signIn(email: String, password: String) async throws -> SessionUser {
        _ = try await api.request(
            path: "/api/auth/sign-in/email",
            method: "POST",
            body: [
                "email": email,
                "password": password,
                "callbackURL": "/"
            ]
        )

        guard let user = try await getSession() else {
            throw AppNetworkError.unauthorized("Unauthorized")
        }

        return user
    }

    func signUp(name: String, email: String, password: String) async throws -> SessionUser {
        _ = try await api.request(
            path: "/api/auth/sign-up/email",
            method: "POST",
            body: [
                "name": name,
                "email": email,
                "password": password,
                "callbackURL": "/"
            ]
        )

        guard let user = try await getSession() else {
            throw AppNetworkError.unauthorized("Unauthorized")
        }

        return user
    }

    func requestPasswordReset(email: String) async throws {
        let origin = APIEnvironment.baseURL.absoluteString.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        _ = try await api.request(
            path: "/api/auth/request-password-reset",
            method: "POST",
            body: [
                "email": email,
                "redirectTo": "\(origin)/auth/reset-password"
            ]
        )
    }

    func resetPassword(token: String, newPassword: String) async throws {
        _ = try await api.request(
            path: "/api/auth/reset-password",
            method: "POST",
            body: [
                "token": token,
                "newPassword": newPassword
            ]
        )
    }

    func updateProfile(name: String) async throws -> SessionUser? {
        let data = try await api.request(
            path: "/api/auth/update-user",
            method: "POST",
            body: [
                "name": name
            ]
        )

        if let payload = try? JSONDecoder().decode(SessionPayload.self, from: data),
           let user = payload.resolvedUser {
            return user
        }

        return nil
    }

    func changePassword(currentPassword: String, newPassword: String) async throws {
        _ = try await api.request(
            path: "/api/auth/change-password",
            method: "POST",
            body: [
                "currentPassword": currentPassword,
                "newPassword": newPassword
            ]
        )
    }

    func signOut() async throws {
        _ = try await api.request(path: "/api/auth/sign-out", method: "POST", body: [:])
        api.clearAllCookies()
    }
}
