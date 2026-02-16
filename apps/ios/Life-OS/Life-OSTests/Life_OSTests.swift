//
//  Life_OSTests.swift
//  Life-OSTests
//
//  Created by Neel Bommisetty on 2/2/26.
//

import XCTest
import SwiftData
@testable import Life_OS

final class Life_OSTests: XCTestCase {

    override func setUp() async throws {
        await IOSMockAPI.shared.reset()
    }

    func testMockAuthSignInLifecycle() async throws {
        let sessionBefore = await IOSMockAPI.shared.request(
            path: "/auth/get-session",
            method: "GET",
            body: nil
        )
        XCTAssertEqual(sessionBefore.statusCode, 401)

        let invalidSignIn = await IOSMockAPI.shared.request(
            path: "/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "wrong@lifeos.dev",
                "password": "wrong-password"
            ]
        )
        XCTAssertEqual(invalidSignIn.statusCode, 401)
        XCTAssertEqual(errorMessage(from: invalidSignIn.data), "Invalid email or password")

        let validSignIn = await IOSMockAPI.shared.request(
            path: "/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "demo@lifeos.dev",
                "password": "demo12345"
            ]
        )
        XCTAssertEqual(validSignIn.statusCode, 200)

        let sessionAfter = await IOSMockAPI.shared.request(
            path: "/auth/get-session",
            method: "GET",
            body: nil
        )
        XCTAssertEqual(sessionAfter.statusCode, 200)
        XCTAssertEqual(sessionUser(from: sessionAfter.data)?["email"] as? String, "demo@lifeos.dev")

        let signOut = await IOSMockAPI.shared.request(
            path: "/auth/sign-out",
            method: "POST",
            body: [:]
        )
        XCTAssertEqual(signOut.statusCode, 200)

        let sessionAfterSignOut = await IOSMockAPI.shared.request(
            path: "/auth/get-session",
            method: "GET",
            body: nil
        )
        XCTAssertEqual(sessionAfterSignOut.statusCode, 401)
    }

    func testMockAccountSettingsUpdateProfileAndChangePassword() async throws {
        _ = await IOSMockAPI.shared.request(
            path: "/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "demo@lifeos.dev",
                "password": "demo12345"
            ]
        )

        let updateProfile = await IOSMockAPI.shared.request(
            path: "/auth/update-user",
            method: "POST",
            body: [
                "name": "Updated Test User"
            ]
        )
        XCTAssertEqual(updateProfile.statusCode, 200)
        XCTAssertEqual(sessionUser(from: updateProfile.data)?["name"] as? String, "Updated Test User")

        let invalidCurrentPassword = await IOSMockAPI.shared.request(
            path: "/auth/change-password",
            method: "POST",
            body: [
                "currentPassword": "wrong-current",
                "newPassword": "new-password-123"
            ]
        )
        XCTAssertEqual(invalidCurrentPassword.statusCode, 400)
        XCTAssertEqual(errorMessage(from: invalidCurrentPassword.data), "Current password is incorrect")

        let changePassword = await IOSMockAPI.shared.request(
            path: "/auth/change-password",
            method: "POST",
            body: [
                "currentPassword": "demo12345",
                "newPassword": "new-password-123"
            ]
        )
        XCTAssertEqual(changePassword.statusCode, 200)

        _ = await IOSMockAPI.shared.request(path: "/auth/sign-out", method: "POST", body: [:])

        let oldPasswordSignIn = await IOSMockAPI.shared.request(
            path: "/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "demo@lifeos.dev",
                "password": "demo12345"
            ]
        )
        XCTAssertEqual(oldPasswordSignIn.statusCode, 401)

        let newPasswordSignIn = await IOSMockAPI.shared.request(
            path: "/auth/sign-in/email",
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
            path: "/notes",
            method: "GET",
            body: nil
        )
        XCTAssertEqual(notesWithoutAuth.statusCode, 401)

        _ = await IOSMockAPI.shared.request(
            path: "/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "demo@lifeos.dev",
                "password": "demo12345"
            ]
        )

        let notesWithAuth = await IOSMockAPI.shared.request(
            path: "/notes",
            method: "GET",
            body: nil
        )
        XCTAssertEqual(notesWithAuth.statusCode, 200)

        let notesArray = try XCTUnwrap(jsonObject(from: notesWithAuth.data) as? [[String: Any]])
        XCTAssertFalse(notesArray.isEmpty)
    }

    func testAppDataServiceInboxRequiresAuth() async throws {
        setenv("LIFE_OS_USE_MOCK_API", "1", 1)
        defer { unsetenv("LIFE_OS_USE_MOCK_API") }
        await IOSMockAPI.shared.reset()

        let dataService = AppDataService()

        await XCTAssertThrowsErrorAsync(
            try await dataService.listInboxItems()
        ) { error in
            XCTAssertTrue(error.isUnauthorized)
        }

        await XCTAssertThrowsErrorAsync(
            try await dataService.createInboxItem(content: "Unauthorized create")
        ) { error in
            XCTAssertTrue(error.isUnauthorized)
        }
    }

    func testAppDataServiceInboxCreateAndListRoundTrip() async throws {
        setenv("LIFE_OS_USE_MOCK_API", "1", 1)
        defer { unsetenv("LIFE_OS_USE_MOCK_API") }
        await IOSMockAPI.shared.reset()

        _ = await IOSMockAPI.shared.request(
            path: "/auth/sign-in/email",
            method: "POST",
            body: [
                "email": "demo@lifeos.dev",
                "password": "demo12345",
            ]
        )

        let dataService = AppDataService()
        let created = try await dataService.createInboxItem(content: "Capture this thought")
        XCTAssertEqual(created.content, "Capture this thought")
        XCTAssertEqual(created.state, "SAVED")

        let items = try await dataService.listInboxItems()
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items.first?.content, "Capture this thought")
        XCTAssertEqual(items.first?.id, created.id)
    }

    @MainActor
    func testCreateInboxFromCaptureStoresUnsyncedItemOnFailure() async throws {
        setenv("LIFE_OS_USE_MOCK_API", "1", 1)
        setenv("LIFE_OS_MOCK_INBOX_CREATE_FAIL", "1", 1)
        defer {
            unsetenv("LIFE_OS_USE_MOCK_API")
            unsetenv("LIFE_OS_MOCK_INBOX_CREATE_FAIL")
        }
        await IOSMockAPI.shared.reset()

        let appState = AppState()
        await appState.signIn(email: "demo@lifeos.dev", password: "demo12345")

        let modelContext = try makeInMemoryModelContext()
        let didSave = await appState.createInboxFromCapture(
            content: "Persist this even on failure",
            modelContext: modelContext
        )
        XCTAssertTrue(didSave)

        let items = try modelContext.fetch(FetchDescriptor<InboxItem>())
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].syncStatus, InboxItemSyncStatus.failedCreate.rawValue)
        XCTAssertEqual(items[0].content, "Persist this even on failure")
        XCTAssertNotNil(items[0].lastSyncError)
    }

    @MainActor
    func testRetryPendingInboxCreatesSyncsFailedItem() async throws {
        setenv("LIFE_OS_USE_MOCK_API", "1", 1)
        setenv("LIFE_OS_MOCK_INBOX_CREATE_FAIL_ONCE", "1", 1)
        defer {
            unsetenv("LIFE_OS_USE_MOCK_API")
            unsetenv("LIFE_OS_MOCK_INBOX_CREATE_FAIL_ONCE")
        }
        await IOSMockAPI.shared.reset()

        let appState = AppState()
        await appState.signIn(email: "demo@lifeos.dev", password: "demo12345")

        let modelContext = try makeInMemoryModelContext()
        _ = await appState.createInboxFromCapture(
            content: "Retry me",
            modelContext: modelContext
        )

        var items = try modelContext.fetch(FetchDescriptor<InboxItem>())
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].syncStatus, InboxItemSyncStatus.failedCreate.rawValue)

        await appState.retryPendingInboxCreates(modelContext: modelContext)

        items = try modelContext.fetch(FetchDescriptor<InboxItem>())
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].syncStatus, InboxItemSyncStatus.synced.rawValue)
        XCTAssertNotNil(items[0].serverId)
        XCTAssertNil(items[0].lastSyncError)
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
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:3001/auth/sign-in/email"))
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
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:3001/auth/sign-in/email"))
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

    private func makeInMemoryModelContext() throws -> ModelContext {
        let schema = Schema([InboxItem.self])
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        let container = try ModelContainer(for: schema, configurations: [configuration])
        return ModelContext(container)
    }
}

private func XCTAssertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    _ handler: (Error) -> Void
) async {
    do {
        _ = try await expression()
        XCTFail("Expected error to be thrown")
    } catch {
        handler(error)
    }
}
