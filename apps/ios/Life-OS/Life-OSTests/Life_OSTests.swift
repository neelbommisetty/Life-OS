//
//  Life_OSTests.swift
//  Life-OSTests
//
//  Created by Neel Bommisetty on 2/2/26.
//

import XCTest
@testable import Life_OS

final class Life_OSTests: XCTestCase {

    override func setUp() async throws {
        await IOSMockAPI.shared.reset()
    }

    func testMockAuthSignInLifecycle() async throws {
        let sessionBefore = await IOSMockAPI.shared.request(
            path: "/api/auth/get-session",
            method: "GET",
            body: nil
        )
        XCTAssertEqual(sessionBefore.statusCode, 401)

        let invalidSignIn = await IOSMockAPI.shared.request(
            path: "/api/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "wrong@lifeos.dev",
                "password": "wrong-password"
            ]
        )
        XCTAssertEqual(invalidSignIn.statusCode, 401)
        XCTAssertEqual(errorMessage(from: invalidSignIn.data), "Invalid email or password")

        let validSignIn = await IOSMockAPI.shared.request(
            path: "/api/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "demo@lifeos.dev",
                "password": "demo12345"
            ]
        )
        XCTAssertEqual(validSignIn.statusCode, 200)

        let sessionAfter = await IOSMockAPI.shared.request(
            path: "/api/auth/get-session",
            method: "GET",
            body: nil
        )
        XCTAssertEqual(sessionAfter.statusCode, 200)
        XCTAssertEqual(sessionUser(from: sessionAfter.data)?["email"] as? String, "demo@lifeos.dev")

        let signOut = await IOSMockAPI.shared.request(
            path: "/api/auth/sign-out",
            method: "POST",
            body: [:]
        )
        XCTAssertEqual(signOut.statusCode, 200)

        let sessionAfterSignOut = await IOSMockAPI.shared.request(
            path: "/api/auth/get-session",
            method: "GET",
            body: nil
        )
        XCTAssertEqual(sessionAfterSignOut.statusCode, 401)
    }

    func testMockAccountSettingsUpdateProfileAndChangePassword() async throws {
        _ = await IOSMockAPI.shared.request(
            path: "/api/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "demo@lifeos.dev",
                "password": "demo12345"
            ]
        )

        let updateProfile = await IOSMockAPI.shared.request(
            path: "/api/auth/update-user",
            method: "POST",
            body: [
                "name": "Updated Test User"
            ]
        )
        XCTAssertEqual(updateProfile.statusCode, 200)
        XCTAssertEqual(sessionUser(from: updateProfile.data)?["name"] as? String, "Updated Test User")

        let invalidCurrentPassword = await IOSMockAPI.shared.request(
            path: "/api/auth/change-password",
            method: "POST",
            body: [
                "currentPassword": "wrong-current",
                "newPassword": "new-password-123"
            ]
        )
        XCTAssertEqual(invalidCurrentPassword.statusCode, 400)
        XCTAssertEqual(errorMessage(from: invalidCurrentPassword.data), "Current password is incorrect")

        let changePassword = await IOSMockAPI.shared.request(
            path: "/api/auth/change-password",
            method: "POST",
            body: [
                "currentPassword": "demo12345",
                "newPassword": "new-password-123"
            ]
        )
        XCTAssertEqual(changePassword.statusCode, 200)

        _ = await IOSMockAPI.shared.request(path: "/api/auth/sign-out", method: "POST", body: [:])

        let oldPasswordSignIn = await IOSMockAPI.shared.request(
            path: "/api/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "demo@lifeos.dev",
                "password": "demo12345"
            ]
        )
        XCTAssertEqual(oldPasswordSignIn.statusCode, 401)

        let newPasswordSignIn = await IOSMockAPI.shared.request(
            path: "/api/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "demo@lifeos.dev",
                "password": "new-password-123"
            ]
        )
        XCTAssertEqual(newPasswordSignIn.statusCode, 200)
    }

    func testMockProtectedDataRequiresAuth() async throws {
        let notesWithoutAuth = await IOSMockAPI.shared.request(
            path: "/api/notes",
            method: "GET",
            body: nil
        )
        XCTAssertEqual(notesWithoutAuth.statusCode, 401)

        _ = await IOSMockAPI.shared.request(
            path: "/api/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "demo@lifeos.dev",
                "password": "demo12345"
            ]
        )

        let notesWithAuth = await IOSMockAPI.shared.request(
            path: "/api/notes",
            method: "GET",
            body: nil
        )
        XCTAssertEqual(notesWithAuth.statusCode, 200)

        let notesArray = try XCTUnwrap(jsonObject(from: notesWithAuth.data) as? [[String: Any]])
        XCTAssertFalse(notesArray.isEmpty)
    }

    func testDecodeSessionUserHandlesEmptyAndNullPayloads() throws {
        let authService = AuthService()

        XCTAssertNil(try authService.decodeSessionUser(from: Data()))
        XCTAssertNil(try authService.decodeSessionUser(from: Data("   ".utf8)))
        XCTAssertNil(try authService.decodeSessionUser(from: Data("null".utf8)))
    }

    func testDecodeSessionUserParsesValidSessionPayload() throws {
        let authService = AuthService()
        let payload = """
        {"data":{"session":{"user":{"id":"user-123","name":"Demo","email":"demo@lifeos.dev"}}}}
        """

        let user = try authService.decodeSessionUser(from: Data(payload.utf8))
        XCTAssertEqual(user?.id, "user-123")
        XCTAssertEqual(user?.email, "demo@lifeos.dev")
    }

    @MainActor
    func testAppStateSignInTrimsEmailWhitespace() async throws {
        setenv("LIFE_OS_USE_MOCK_API", "1", 1)
        defer { unsetenv("LIFE_OS_USE_MOCK_API") }

        let appState = AppState()
        await appState.signIn(email: "  demo@lifeos.dev  ", password: "demo12345")

        XCTAssertEqual(appState.sessionUser?.email, "demo@lifeos.dev")
        XCTAssertNil(appState.authError)
    }

    func testInMemoryCookieJarStoresSecureCookieFromResponse() async throws {
        let jar = InMemoryCookieJar()
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:3001/api/auth/sign-in/email"))
        let response = try XCTUnwrap(
            HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: [
                    "Set-Cookie": "__Secure-neon-auth.session_token=abc123; Path=/; HttpOnly; Secure; SameSite=None; Partitioned"
                ]
            )
        )

        await jar.ingest(response: response, for: url)
        let cookieHeader = await jar.cookieHeader(for: url)

        XCTAssertEqual(cookieHeader, "__Secure-neon-auth.session_token=abc123")
    }

    func testInMemoryCookieJarClearRemovesStoredCookies() async throws {
        let jar = InMemoryCookieJar()
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:3001/api/auth/sign-in/email"))
        let response = try XCTUnwrap(
            HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: [
                    "Set-Cookie": "__Secure-neon-auth.session_token=abc123; Path=/; HttpOnly; Secure; SameSite=None; Partitioned"
                ]
            )
        )

        await jar.ingest(response: response, for: url)
        let headerBeforeClear = await jar.cookieHeader(for: url)
        XCTAssertNotNil(headerBeforeClear)

        await jar.clear()
        let headerAfterClear = await jar.cookieHeader(for: url)
        XCTAssertNil(headerAfterClear)
    }

    private func jsonObject(from data: Data) throws -> Any {
        try JSONSerialization.jsonObject(with: data, options: [])
    }

    private func errorMessage(from data: Data) -> String? {
        guard
            let payload = try? jsonObject(from: data) as? [String: Any],
            let message = payload["message"] as? String
        else {
            return nil
        }

        return message
    }

    private func sessionUser(from data: Data) -> [String: Any]? {
        guard
            let payload = try? jsonObject(from: data) as? [String: Any],
            let dataObject = payload["data"] as? [String: Any],
            let sessionObject = dataObject["session"] as? [String: Any],
            let user = sessionObject["user"] as? [String: Any]
        else {
            return nil
        }

        return user
    }
}
