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
            ScrollView {
                VStack(spacing: 22) {
                    brandHeader

                    if let authError = appState.authError {
                        MessageBanner(text: authError, color: .red, identifier: "auth.error")
                    }

                    if let authSuccess = appState.authSuccess {
                        MessageBanner(text: authSuccess, color: .green, identifier: "auth.success")
                    }

                    activeFlowSection
                }
                .frame(maxWidth: 520)
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
            }
            .toolbar(.hidden, for: .navigationBar)
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

    private var brandHeader: some View {
        VStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(.regularMaterial)
                .frame(width: 100, height: 100)
                .overlay {
                    Image(systemName: "square.stack.3d.down.right.fill")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(.primary)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 26, style: .continuous)
                        .stroke(.white.opacity(0.35), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.16), radius: 20, y: 10)

            Text("Life-OS")
                .font(.system(.largeTitle, design: .rounded).weight(.bold))

            Text("YOUR DIGITAL WORKSPACE")
                .font(.footnote.weight(.semibold))
                .tracking(1)
                .foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("auth.hero")
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
        authCard(title: "Sign In", subtitle: "Access your Life-OS account") {
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    fieldLabel("Email")
                    inputField(icon: "envelope.fill") {
                        TextField("email@lifeos.com", text: $signInEmail)
                            .textContentType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.emailAddress)
                            .accessibilityIdentifier("auth.signIn.email")
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    fieldLabel("Password")
                    inputField(icon: "lock.fill") {
                        SecureField("Password", text: $signInPassword)
                            .textContentType(.password)
                            .accessibilityIdentifier("auth.signIn.password")
                    }
                }

                Button("Forgot password?") {
                    appState.authFlow = .recover
                    appState.clearAuthFeedback()
                }
                .font(.footnote.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .accessibilityIdentifier("auth.signIn.gotoRecover")

                Button {
                    Task {
                        await appState.signIn(email: signInEmail, password: signInPassword)
                    }
                } label: {
                    HStack(spacing: 8) {
                        if appState.isSubmittingAuth {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(appState.isSubmittingAuth ? "Signing in" : "Sign in")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(appState.isSubmittingAuth)
                .accessibilityIdentifier("auth.signIn.submit")

                HStack(spacing: 6) {
                    Text("Don't have an account?")
                        .foregroundStyle(.secondary)
                    Button("Create account") {
                        appState.authFlow = .signUp
                        appState.clearAuthFeedback()
                    }
                    .fontWeight(.semibold)
                    .accessibilityIdentifier("auth.signIn.gotoSignUp")
                }
                .font(.footnote)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var signUpSection: some View {
        authCard(title: "Create Account", subtitle: "Set up your Life-OS profile") {
            VStack(spacing: 14) {
                inputField(icon: "person.fill") {
                    TextField("Name", text: $signUpName)
                        .textContentType(.name)
                        .accessibilityIdentifier("auth.signUp.name")
                }

                inputField(icon: "envelope.fill") {
                    TextField("Email", text: $signUpEmail)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.emailAddress)
                        .accessibilityIdentifier("auth.signUp.email")
                }

                inputField(icon: "lock.fill") {
                    SecureField("Password", text: $signUpPassword)
                        .textContentType(.newPassword)
                        .accessibilityIdentifier("auth.signUp.password")
                }

                Button {
                    Task {
                        await appState.signUp(name: signUpName, email: signUpEmail, password: signUpPassword)
                    }
                } label: {
                    HStack(spacing: 8) {
                        if appState.isSubmittingAuth {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(appState.isSubmittingAuth ? "Creating account" : "Create account")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(appState.isSubmittingAuth)
                .accessibilityIdentifier("auth.signUp.submit")

                Button("Already have an account? Sign in") {
                    appState.authFlow = .signIn
                    appState.clearAuthFeedback()
                }
                .font(.footnote.weight(.semibold))
                .accessibilityIdentifier("auth.signUp.gotoSignIn")
            }
        }
    }

    private var recoverSection: some View {
        authCard(title: "Recover Password", subtitle: "Send a reset link to your email") {
            VStack(spacing: 14) {
                inputField(icon: "envelope.fill") {
                    TextField("Email", text: $recoverEmail)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.emailAddress)
                        .accessibilityIdentifier("auth.recover.email")
                }

                Button {
                    Task {
                        await appState.requestPasswordReset(email: recoverEmail)
                    }
                } label: {
                    HStack(spacing: 8) {
                        if appState.isSubmittingAuth {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(appState.isSubmittingAuth ? "Sending" : "Send reset link")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(appState.isSubmittingAuth)
                .accessibilityIdentifier("auth.recover.submit")

                Button("Back to sign in") {
                    appState.authFlow = .signIn
                    appState.clearAuthFeedback()
                }
                .font(.footnote.weight(.semibold))
                .accessibilityIdentifier("auth.recover.gotoSignIn")

                Button("Have a reset token?") {
                    appState.authFlow = .resetPassword
                    appState.clearAuthFeedback()
                }
                .font(.footnote.weight(.semibold))
                .accessibilityIdentifier("auth.recover.gotoReset")
            }
        }
    }

    private var resetSection: some View {
        authCard(title: "Set New Password", subtitle: "Enter your token and a new password") {
            VStack(spacing: 14) {
                inputField(icon: "key.fill") {
                    TextField("Reset token", text: $resetToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("auth.reset.token")
                }

                inputField(icon: "lock.fill") {
                    SecureField("New password", text: $resetPassword)
                        .textContentType(.newPassword)
                        .accessibilityIdentifier("auth.reset.newPassword")
                }

                inputField(icon: "lock.fill") {
                    SecureField("Confirm password", text: $confirmPassword)
                        .textContentType(.newPassword)
                        .accessibilityIdentifier("auth.reset.confirmPassword")
                }

                Button {
                    Task {
                        await appState.resetPassword(
                            token: resetToken,
                            newPassword: resetPassword,
                            confirmPassword: confirmPassword
                        )
                    }
                } label: {
                    HStack(spacing: 8) {
                        if appState.isSubmittingAuth {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(appState.isSubmittingAuth ? "Updating" : "Update password")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(appState.isSubmittingAuth)
                .accessibilityIdentifier("auth.reset.submit")

                Button("Back to sign in") {
                    appState.authFlow = .signIn
                    appState.clearAuthFeedback()
                }
                .font(.footnote.weight(.semibold))
                .accessibilityIdentifier("auth.reset.gotoSignIn")
            }
        }
    }

    private func authCard<Content: View>(
        title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.title3.weight(.bold))
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            content()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(.white.opacity(0.28), lineWidth: 1)
        }
    }

    private func inputField<Content: View>(
        icon: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.secondary)
                .frame(width: 18)

            content()
        }
        .padding(.horizontal, 14)
        .frame(height: 48)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color(uiColor: .separator).opacity(0.35), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .tracking(0.8)
    }
}

struct MessageBanner: View {
    let text: String
    let color: Color
    var identifier: String?

    private var bannerView: some View {
        Label {
            Text(text)
                .font(.footnote)
        } icon: {
            Image(systemName: "info.circle.fill")
        }
        .foregroundStyle(color)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(color.opacity(0.25), lineWidth: 1)
        }
    }

    var body: some View {
        if let identifier {
            bannerView.accessibilityIdentifier(identifier)
        } else {
            bannerView
        }
    }
}
