import SwiftUI

struct BootstrappingView: View {
    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .progressViewStyle(.circular)

            Text("Checking session")
                .font(.headline)

            Text("Life-OS is validating your auth state")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct AuthGatewayView: View {
    @ObservedObject var appState: AppState

    @State private var signInEmail = ""
    @State private var signInPassword = ""

    @State private var signUpName = ""
    @State private var signUpEmail = ""
    @State private var signUpPassword = ""

    @State private var recoverEmail = ""

    @State private var resetToken = ""
    @State private var resetPassword = ""
    @State private var confirmPassword = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Every view is protected. Authenticate to continue.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Section("Authentication") {
                    AuthFlowSwitch(flow: $appState.authFlow) {
                        appState.clearAuthFeedback()
                    }
                }

                if let authError = appState.authError {
                    Section {
                        MessageBanner(text: authError, color: .red, identifier: "auth.error")
                    }
                }

                if let authSuccess = appState.authSuccess {
                    Section {
                        MessageBanner(text: authSuccess, color: .green, identifier: "auth.success")
                    }
                }

                activeFlowSection
            }
            .navigationTitle("Life-OS")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
        }
        .onAppear {
            if !appState.resetToken.isEmpty {
                resetToken = appState.resetToken
            }
        }
        .onChange(of: appState.resetToken) { _, newValue in
            if !newValue.isEmpty {
                resetToken = newValue
            }
        }
    }

    @ViewBuilder
    private var activeFlowSection: some View {
        switch appState.authFlow {
        case .signIn:
            signInSection
        case .signUp:
            signUpSection
        case .recover:
            recoverSection
        case .resetPassword:
            resetSection
        }
    }

    private var signInSection: some View {
        Section("Sign In") {
            TextField("Email", text: $signInEmail)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .accessibilityIdentifier("auth.signIn.email")

            SecureField("Password", text: $signInPassword)
                .textContentType(.password)
                .accessibilityIdentifier("auth.signIn.password")

            Button {
                Task {
                    await appState.signIn(email: signInEmail, password: signInPassword)
                }
            } label: {
                if appState.isSubmittingAuth {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Sign in")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("auth.signIn.submit")

            Button("Create account") {
                appState.authFlow = .signUp
                appState.clearAuthFeedback()
            }
            .accessibilityIdentifier("auth.signIn.gotoSignUp")

            Button("Forgot password?") {
                appState.authFlow = .recover
                appState.clearAuthFeedback()
            }
            .accessibilityIdentifier("auth.signIn.gotoRecover")
        }
    }

    private var signUpSection: some View {
        Section("Create Account") {
            TextField("Name", text: $signUpName)
                .textContentType(.name)
                .accessibilityIdentifier("auth.signUp.name")

            TextField("Email", text: $signUpEmail)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .accessibilityIdentifier("auth.signUp.email")

            SecureField("Password", text: $signUpPassword)
                .textContentType(.newPassword)
                .accessibilityIdentifier("auth.signUp.password")

            Button {
                Task {
                    await appState.signUp(name: signUpName, email: signUpEmail, password: signUpPassword)
                }
            } label: {
                if appState.isSubmittingAuth {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Create account")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("auth.signUp.submit")

            Button("Already have an account? Sign in") {
                appState.authFlow = .signIn
                appState.clearAuthFeedback()
            }
            .accessibilityIdentifier("auth.signUp.gotoSignIn")
        }
    }

    private var recoverSection: some View {
        Section("Recover Password") {
            TextField("Email", text: $recoverEmail)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .accessibilityIdentifier("auth.recover.email")

            Button {
                Task {
                    await appState.requestPasswordReset(email: recoverEmail)
                }
            } label: {
                if appState.isSubmittingAuth {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Send reset link")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("auth.recover.submit")

            Button("Back to sign in") {
                appState.authFlow = .signIn
                appState.clearAuthFeedback()
            }
            .accessibilityIdentifier("auth.recover.gotoSignIn")

            Button("Have a token?") {
                appState.authFlow = .resetPassword
                appState.clearAuthFeedback()
            }
            .accessibilityIdentifier("auth.recover.gotoReset")
        }
    }

    private var resetSection: some View {
        Section("Set New Password") {
            TextField("Reset token", text: $resetToken)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("auth.reset.token")

            SecureField("New password", text: $resetPassword)
                .textContentType(.newPassword)
                .accessibilityIdentifier("auth.reset.newPassword")

            SecureField("Confirm password", text: $confirmPassword)
                .textContentType(.newPassword)
                .accessibilityIdentifier("auth.reset.confirmPassword")

            Button {
                Task {
                    await appState.resetPassword(
                        token: resetToken,
                        newPassword: resetPassword,
                        confirmPassword: confirmPassword
                    )
                }
            } label: {
                if appState.isSubmittingAuth {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Update password")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("auth.reset.submit")

            Button("Back to sign in") {
                appState.authFlow = .signIn
                appState.clearAuthFeedback()
            }
            .accessibilityIdentifier("auth.reset.gotoSignIn")
        }
    }
}

struct AuthFlowSwitch: View {
    @Binding var flow: AuthFlow
    var onChange: () -> Void

    var body: some View {
        Picker("Flow", selection: $flow) {
            ForEach(AuthFlow.allCases) { item in
                Text(item.title)
                    .tag(item)
                    .accessibilityIdentifier("auth.flow.\(item.rawValue)")
            }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("auth.flow.selector")
        .onChange(of: flow) { _, _ in
            onChange()
        }
    }
}

struct MessageBanner: View {
    let text: String
    let color: Color
    var identifier: String?

    var body: some View {
        let banner = Label {
            Text(text)
                .font(.footnote)
        } icon: {
            Image(systemName: "info.circle.fill")
        }
        .foregroundStyle(color)
        .frame(maxWidth: .infinity, alignment: .leading)

        if let identifier {
            banner.accessibilityIdentifier(identifier)
        } else {
            banner
        }
    }
}
