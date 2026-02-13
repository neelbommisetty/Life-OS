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

        XCTAssertTrue(app.tabBars.buttons["house.fill"].waitForExistence(timeout: 6))
        XCTAssertTrue(app.tabBars.buttons["person.crop.circle"].exists)
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

        XCTAssertTrue(app.tabBars.buttons["person.crop.circle"].waitForExistence(timeout: 6))
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

        XCTAssertTrue(app.staticTexts["Profile updated"].waitForExistence(timeout: 4))

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

        XCTAssertTrue(app.staticTexts["Passwords do not match"].waitForExistence(timeout: 4))

        confirmPassword.clearAndTypeText("new-password-123")
        changePassword.tap()

        XCTAssertTrue(app.staticTexts["Password updated"].waitForExistence(timeout: 4))

        let signOut = app.descendants(matching: .any)["account.signOut"]
        ensureElementExists(signOut, in: app)
        tapElementWhenHittable(signOut, in: app)

        XCTAssertTrue(app.buttons["auth.signIn.submit"].waitForExistence(timeout: 6))
    }

    private func makeApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["LIFE_OS_USE_MOCK_API"] = "1"
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

        XCTAssertTrue(app.tabBars.buttons["person.crop.circle"].waitForExistence(timeout: 6))
    }

    private func openAccountTab(in app: XCUIApplication) {
        dismissKeyboardIfVisible(in: app)

        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.waitForExistence(timeout: 6))

        let accountTabByLabel = tabBar.buttons["Account"]
        let accountTabByIdentifier = tabBar.buttons["person.crop.circle"]
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
