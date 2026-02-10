import SwiftUI

struct BootstrappingView: View {
    var body: some View {
        VStack(spacing: 14) {
            ProgressView()
                .progressViewStyle(.circular)
                .scaleEffect(1.2)

            Text("Checking session")
                .font(.headline.weight(.semibold))

            Text("Life-OS is validating your auth state")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(26)
        .frame(maxWidth: 340)
        .liquidCard(.regular, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .padding()
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
        ScrollView {
            VStack(spacing: 16) {
                VStack(spacing: 8) {
                    Text("Life-OS")
                        .font(.largeTitle.weight(.bold))
                    Text("Every view is protected. Authenticate to continue.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 24)

                AuthFlowSwitch(flow: $appState.authFlow) {
                    appState.clearAuthFeedback()
                }

                if let authError = appState.authError {
                    MessageBanner(text: authError, color: .red, identifier: "auth.error")
                }

                if let authSuccess = appState.authSuccess {
                    MessageBanner(text: authSuccess, color: .blue, identifier: "auth.success")
                }

                Group {
                    switch appState.authFlow {
                    case .signIn:
                        signInForm
                    case .signUp:
                        signUpForm
                    case .recover:
                        recoverForm
                    case .resetPassword:
                        resetForm
                    }
                }
                .liquidCard(.regular, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
                .padding(.horizontal)
            }
            .padding(.bottom, 30)
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

    private var signInForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Sign in")
                .font(.title3.weight(.semibold))

            TextField("Email", text: $signInEmail)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .authInputStyle()
                .accessibilityIdentifier("auth.signIn.email")

            SecureField("Password", text: $signInPassword)
                .textContentType(.password)
                .authInputStyle()
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
            .buttonStyle(.glassProminent)
            .tint(.blue)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("auth.signIn.submit")

            HStack {
                Button("Create account") {
                    appState.authFlow = .signUp
                    appState.clearAuthFeedback()
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.blue)
                .accessibilityIdentifier("auth.signIn.gotoSignUp")

                Spacer()

                Button("Forgot password?") {
                    appState.authFlow = .recover
                    appState.clearAuthFeedback()
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.blue)
                .accessibilityIdentifier("auth.signIn.gotoRecover")
            }
        }
        .padding(20)
    }

    private var signUpForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Create account")
                .font(.title3.weight(.semibold))

            TextField("Name", text: $signUpName)
                .textContentType(.name)
                .authInputStyle()
                .accessibilityIdentifier("auth.signUp.name")

            TextField("Email", text: $signUpEmail)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .authInputStyle()
                .accessibilityIdentifier("auth.signUp.email")

            SecureField("Password", text: $signUpPassword)
                .textContentType(.newPassword)
                .authInputStyle()
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
            .buttonStyle(.glassProminent)
            .tint(.blue)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("auth.signUp.submit")

            Button("Already have an account? Sign in") {
                appState.authFlow = .signIn
                appState.clearAuthFeedback()
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.blue)
            .accessibilityIdentifier("auth.signUp.gotoSignIn")
        }
        .padding(20)
    }

    private var recoverForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Recover password")
                .font(.title3.weight(.semibold))

            TextField("Email", text: $recoverEmail)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .authInputStyle()
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
            .buttonStyle(.glassProminent)
            .tint(.blue)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("auth.recover.submit")

            HStack {
                Button("Back to sign in") {
                    appState.authFlow = .signIn
                    appState.clearAuthFeedback()
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.blue)
                .accessibilityIdentifier("auth.recover.gotoSignIn")

                Spacer()

                Button("Have a token?") {
                    appState.authFlow = .resetPassword
                    appState.clearAuthFeedback()
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.blue)
                .accessibilityIdentifier("auth.recover.gotoReset")
            }
        }
        .padding(20)
    }

    private var resetForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Set new password")
                .font(.title3.weight(.semibold))

            TextField("Reset token", text: $resetToken)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .authInputStyle()
                .accessibilityIdentifier("auth.reset.token")

            SecureField("New password", text: $resetPassword)
                .textContentType(.newPassword)
                .authInputStyle()
                .accessibilityIdentifier("auth.reset.newPassword")

            SecureField("Confirm password", text: $confirmPassword)
                .textContentType(.newPassword)
                .authInputStyle()
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
            .buttonStyle(.glassProminent)
            .tint(.blue)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("auth.reset.submit")

            Button("Back to sign in") {
                appState.authFlow = .signIn
                appState.clearAuthFeedback()
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.blue)
            .accessibilityIdentifier("auth.reset.gotoSignIn")
        }
        .padding(20)
    }
}

struct AuthFlowSwitch: View {
    @Binding var flow: AuthFlow
    var onChange: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(AuthFlow.allCases) { item in
                    Button(item.title) {
                        flow = item
                        onChange()
                    }
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(flow == item ? Color.blue.opacity(0.18) : Color.white.opacity(0.12))
                    .overlay {
                        Capsule().stroke(flow == item ? Color.blue.opacity(0.45) : Color.white.opacity(0.3), lineWidth: 1)
                    }
                    .clipShape(Capsule())
                    .accessibilityIdentifier("auth.flow.\(item.rawValue)")
                }
            }
            .padding(.horizontal)
        }
        .liquidCard(.clear, in: Capsule())
        .padding(.horizontal)
    }
}

struct MessageBanner: View {
    let text: String
    let color: Color
    var identifier: String?

    var body: some View {
        let banner = Text(text)
            .font(.footnote)
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(color.opacity(0.08))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(color.opacity(0.35), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(.horizontal)

        if let identifier {
            banner.accessibilityIdentifier(identifier)
        } else {
            banner
        }
    }
}
