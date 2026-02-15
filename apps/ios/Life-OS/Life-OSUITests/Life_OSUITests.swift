//
//  Life_OSUITests.swift
//  Life-OSUITests
//
//  Created by Neel Bommisetty on 2/2/26.
//

import XCTest

final class Life_OSUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testSignInShowsErrorForInvalidCredentialsThenUnlocksApp() throws {
        let app = makeApp()
        app.launch()

        let emailField = app.textFields["auth.signIn.email"]
        let passwordField = app.secureTextFields["auth.signIn.password"]
        let submitButton = app.buttons["auth.signIn.submit"]

        XCTAssertTrue(emailField.waitForExistence(timeout: 6))
        XCTAssertTrue(passwordField.exists)
        XCTAssertTrue(submitButton.exists)

        emailField.tap()
        emailField.typeText("invalid@lifeos.dev")
        passwordField.tap()
        passwordField.typeText("wrong-password")
        submitButton.tap()

        XCTAssertTrue(app.staticTexts["Invalid email or password"].waitForExistence(timeout: 4))

        emailField.clearAndTypeText("demo@lifeos.dev")
        passwordField.clearAndTypeText("demo12345")
        submitButton.tap()
        dismissKeyboardIfVisible(in: app)
        dismissSavePasswordPromptIfPresent(in: app)

        XCTAssertTrue(app.tabBars.buttons["Capture"].waitForExistence(timeout: 6))
        XCTAssertTrue(app.tabBars.buttons["Settings"].exists)
    }

    @MainActor
    func testSignInTrimsWhitespaceAroundEmail() throws {
        let app = makeApp()
        app.launch()

        let emailField = app.textFields["auth.signIn.email"]
        let passwordField = app.secureTextFields["auth.signIn.password"]
        let submitButton = app.buttons["auth.signIn.submit"]

        XCTAssertTrue(emailField.waitForExistence(timeout: 6))
        XCTAssertTrue(passwordField.exists)
        XCTAssertTrue(submitButton.exists)

        emailField.tap()
        emailField.typeText("  demo@lifeos.dev  ")
        passwordField.tap()
        passwordField.typeText("demo12345")
        submitButton.tap()
        dismissKeyboardIfVisible(in: app)
        dismissSavePasswordPromptIfPresent(in: app)

        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 6))
    }

    @MainActor
    func testCaptureSaveCreatesInboxItem() throws {
        let app = makeApp(
            extraEnvironment: [
                "LIFE_OS_UI_TEST_CAPTURE_TEXT": "Remember the grocery list",
            ]
        )
        app.launch()

        signIn(app: app, email: "demo@lifeos.dev", password: "demo12345")

        let saveButton = app.buttons["Save to Inbox"]
        XCTAssertTrue(saveButton.waitForExistence(timeout: 6))
        XCTAssertTrue(waitForEnabled(saveButton, timeout: 6))
        tapElementWhenHittable(saveButton, in: app)
        settle(seconds: 1)

        openInboxTab(in: app)
        XCTAssertTrue(app.cells.firstMatch.waitForExistence(timeout: 6))
    }

    @MainActor
    func testCaptureSaveFailureStillShowsUnsyncedItem() throws {
        let app = makeApp(
            extraEnvironment: [
                "LIFE_OS_MOCK_INBOX_CREATE_FAIL": "1",
                "LIFE_OS_UI_TEST_CAPTURE_TEXT": "Retry this capture",
            ]
        )
        app.launch()

        signIn(app: app, email: "demo@lifeos.dev", password: "demo12345")
        let saveButton = app.buttons["Save to Inbox"]
        XCTAssertTrue(saveButton.waitForExistence(timeout: 6))
        XCTAssertTrue(waitForEnabled(saveButton, timeout: 6))
        tapElementWhenHittable(saveButton, in: app)
        settle(seconds: 1)

        openInboxTab(in: app)
        XCTAssertTrue(app.cells.firstMatch.waitForExistence(timeout: 6))
        XCTAssertTrue(app.buttons["inbox.retryAll"].waitForExistence(timeout: 6))
    }

    @MainActor
    func testRetryPendingInboxCreateSucceedsAfterOneFailure() throws {
        let app = makeApp(
            extraEnvironment: [
                "LIFE_OS_MOCK_INBOX_CREATE_FAIL_ONCE": "1",
                "LIFE_OS_UI_TEST_CAPTURE_TEXT": "Fails once then retries",
            ]
        )
        app.launch()

        signIn(app: app, email: "demo@lifeos.dev", password: "demo12345")
        let saveButton = app.buttons["Save to Inbox"]
        XCTAssertTrue(saveButton.waitForExistence(timeout: 6))
        XCTAssertTrue(waitForEnabled(saveButton, timeout: 6))
        tapElementWhenHittable(saveButton, in: app)
        settle(seconds: 1)

        openInboxTab(in: app)
        let retryButton = app.buttons["inbox.retryAll"]
        XCTAssertTrue(retryButton.waitForExistence(timeout: 6))
        retryButton.tap()

        XCTAssertTrue(waitForNonExistence(app.buttons["inbox.retryAll"], timeout: 6))
    }

    @MainActor
    func testAccountSettingsProfileAndSecurityFlows() throws {
        let app = makeApp()
        app.launch()

        signIn(app: app, email: "demo@lifeos.dev", password: "demo12345")

        openAccountTab(in: app)

        let profileName = app.textFields["account.profile.name"]
        if !profileName.waitForExistence(timeout: 6) {
            let profileSection = app.descendants(matching: .any)["account.section.profile"]
            if profileSection.waitForExistence(timeout: 4) {
                tapElementWhenHittable(profileSection, in: app)
            }
        }
        XCTAssertTrue(profileName.waitForExistence(timeout: 8))
        profileName.clearAndTypeText("Neel QA")

        let saveProfile = app.descendants(matching: .any)["account.profile.save"]
        tapElementWhenHittable(saveProfile, in: app)

        XCTAssertTrue(app.staticTexts["Profile updated."].waitForExistence(timeout: 4))

        let securitySection = app.descendants(matching: .any)["account.section.security"]
        tapElementWhenHittable(securitySection, in: app)

        let currentPassword = app.secureTextFields["account.security.currentPassword"]
        let newPassword = app.secureTextFields["account.security.newPassword"]
        let confirmPassword = app.secureTextFields["account.security.confirmPassword"]

        XCTAssertTrue(currentPassword.waitForExistence(timeout: 4))
        currentPassword.tap()
        currentPassword.typeText("demo12345")
        newPassword.tap()
        newPassword.typeText("new-password-123")
        confirmPassword.tap()
        confirmPassword.typeText("different-password")

        let changePassword = app.descendants(matching: .any)["account.security.changePassword"]
        XCTAssertTrue(changePassword.exists)
        changePassword.tap()

        XCTAssertTrue(app.staticTexts["Passwords don't match."].waitForExistence(timeout: 4))

        confirmPassword.clearAndTypeText("new-password-123")
        changePassword.tap()

        XCTAssertTrue(app.staticTexts["Password updated."].waitForExistence(timeout: 4))

        let signOut = app.descendants(matching: .any)["account.signOut"]
        ensureElementExists(signOut, in: app)
        tapElementWhenHittable(signOut, in: app)

        XCTAssertTrue(app.buttons["auth.signIn.submit"].waitForExistence(timeout: 6))
    }

    private func makeApp(extraEnvironment: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["LIFE_OS_USE_MOCK_API"] = "1"
        for (key, value) in extraEnvironment {
            app.launchEnvironment[key] = value
        }
        return app
    }

    private func signIn(app: XCUIApplication, email: String, password: String) {
        let emailField = app.textFields["auth.signIn.email"]
        let passwordField = app.secureTextFields["auth.signIn.password"]
        let submitButton = app.buttons["auth.signIn.submit"]

        XCTAssertTrue(emailField.waitForExistence(timeout: 6))
        emailField.tap()
        emailField.typeText(email)

        XCTAssertTrue(passwordField.exists)
        passwordField.tap()
        passwordField.typeText(password)

        XCTAssertTrue(submitButton.exists)
        submitButton.tap()
        dismissKeyboardIfVisible(in: app)
        dismissSavePasswordPromptIfPresent(in: app)

        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 6))
        dismissSavePasswordPromptIfPresent(in: app)
    }

    private func openInboxTab(in app: XCUIApplication) {
        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 6))

        let inboxTab = tabBar.buttons["Inbox"]
        XCTAssertTrue(inboxTab.waitForExistence(timeout: 6))
        tapElementWhenHittable(inboxTab, in: app)
    }

    private func openAccountTab(in app: XCUIApplication) {
        dismissKeyboardIfVisible(in: app)

        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 6))

        let accountTabByLabel = tabBar.buttons["Settings"]
        let accountTabByIdentifier = tabBar.buttons["gearshape"]
        let fallbackAccountTab = tabBar.buttons.element(boundBy: max(tabBar.buttons.count - 1, 0))

        func accountScreenReady() -> Bool {
            let signOut = app.descendants(matching: .any)["account.signOut"]
            let profileSection = app.descendants(matching: .any)["account.section.profile"]
            let profileName = app.textFields["account.profile.name"]
            return signOut.waitForExistence(timeout: 3)
                || profileSection.waitForExistence(timeout: 3)
                || profileName.waitForExistence(timeout: 3)
        }

        if accountTabByLabel.waitForExistence(timeout: 4) {
            tapElementWhenHittable(accountTabByLabel, in: app)
        } else if accountTabByIdentifier.waitForExistence(timeout: 2) {
            tapElementWhenHittable(accountTabByIdentifier, in: app)
        } else {
            XCTAssertTrue(fallbackAccountTab.waitForExistence(timeout: 2))
            tapElementWhenHittable(fallbackAccountTab, in: app)
        }

        if !accountScreenReady() {
            if accountTabByLabel.exists {
                tapElementWhenHittable(accountTabByLabel, in: app)
            } else if accountTabByIdentifier.exists {
                tapElementWhenHittable(accountTabByIdentifier, in: app)
            } else if fallbackAccountTab.exists {
                tapElementWhenHittable(fallbackAccountTab, in: app)
            }
        }

        XCTAssertTrue(accountScreenReady())
    }

    private func tapElementWhenHittable(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 6))

        for _ in 0..<3 {
            if element.isHittable {
                break
            }

            dismissKeyboardIfVisible(in: app)

            if !element.isHittable {
                app.swipeUp()
            }

            if !element.isHittable {
                app.swipeDown()
            }
        }

        if element.isHittable {
            element.tap()
            return
        }

        // Fallback for transient simulator hit-testing issues.
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    private func ensureElementExists(_ element: XCUIElement, in app: XCUIApplication) {
        if element.waitForExistence(timeout: 2) {
            return
        }

        for _ in 0..<5 {
            app.swipeUp()
            if element.waitForExistence(timeout: 1) {
                return
            }
        }

        XCTAssertTrue(element.waitForExistence(timeout: 1))
    }

    private func dismissKeyboardIfVisible(in app: XCUIApplication) {
        guard app.keyboards.count > 0 else { return }

        let doneButton = app.toolbars.buttons["Done"]
        if doneButton.exists {
            doneButton.tap()
            return
        }

        let returnButton = app.keyboards.buttons["Return"]
        if returnButton.exists {
            returnButton.tap()
            return
        }

        app.tap()
    }

    private func dismissSavePasswordPromptIfPresent(in app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let notNowLabels = [
            "Not Now",
            "Not now",
            "Never for This App",
            "Never",
            "Cancel",
        ]

        let deadline = Date().addingTimeInterval(3)
        while Date() < deadline {
            var didDismiss = false

            for label in notNowLabels {
                let candidates: [XCUIElement] = [
                    app.alerts.buttons[label],
                    app.sheets.buttons[label],
                    app.buttons[label],
                    springboard.alerts.buttons[label],
                    springboard.sheets.buttons[label],
                    springboard.buttons[label],
                ]

                for button in candidates where button.exists && button.isHittable {
                    button.tap()
                    didDismiss = true
                    break
                }

                if didDismiss {
                    break
                }
            }

            if !didDismiss {
                return
            }

            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
    }

    private func waitForNonExistence(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !element.exists {
                return true
            }

            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }

        return !element.exists
    }

    private func waitForEnabled(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if element.exists, element.isEnabled {
                return true
            }

            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }

        return element.exists && element.isEnabled
    }

    private func settle(seconds: TimeInterval) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }
}

private extension XCUIElement {
    func clearAndTypeText(_ text: String) {
        tap()

        if let currentValue = value as? String, !currentValue.isEmpty {
            let deleteString = String(repeating: XCUIKeyboardKey.delete.rawValue, count: currentValue.count)
            typeText(deleteString)
        }

        typeText(text)
    }
}
