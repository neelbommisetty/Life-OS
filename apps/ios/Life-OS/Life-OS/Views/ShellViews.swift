import SwiftUI

struct AuthenticatedShellView: View {
    @ObservedObject var appState: AppState

    enum AppTab: Hashable {
        case capture
        case inbox
        case settings
    }

    @State private var selectedTab: AppTab = .capture

    var body: some View {
        TabView(selection: $selectedTab) {
            CaptureTabView(appState: appState)
                .tag(AppTab.capture)
                .tabItem {
                    Label("Capture", systemImage: "mic.fill")
                }

            InboxTabView(appState: appState)
                .tag(AppTab.inbox)
                .tabItem {
                    Label(Brand.Terms.inbox, systemImage: "tray.full")
                }

            AccountTabView(appState: appState)
                .tag(AppTab.settings)
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
    }
}

struct CaptureTabView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        NavigationStack {
            CaptureView(appState: appState)
        }
    }
}

struct InboxTabView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        NavigationStack {
            InboxView(appState: appState)
        }
    }
}

struct AccountTabView: View {
    @ObservedObject var appState: AppState
    @State private var selectedSection: AccountSection = .profile
    @State private var profileName = ""
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""

    private enum AccountSection: String, CaseIterable, Identifiable {
        case profile
        case security

        var id: String { rawValue }

        var title: String {
            switch self {
            case .profile:
                return "Profile"
            case .security:
                return "Security"
            }
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Signed in") {
                    LabeledContent("Name") {
                        Text(appState.sessionUser?.name ?? "Not set")
                    }

                    LabeledContent("Email") {
                        Text(appState.sessionUser?.email ?? "Not set")
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Settings") {
                    HStack(spacing: 8) {
                        ForEach(AccountSection.allCases) { section in
                            accountSectionButton(for: section)
                        }
                    }
                }

                if let accountError = appState.accountError {
                    Section {
                        MessageBanner(text: accountError, color: .red, identifier: "account.error")
                    }
                }

                if let accountSuccess = appState.accountSuccess {
                    Section {
                        MessageBanner(text: accountSuccess, color: .green, identifier: "account.success")
                    }
                }

                if selectedSection == .profile {
                    profileSettingsSection
                } else {
                    securitySettingsSection
                }

                Section {
                    Button(role: .destructive) {
                        Task {
                            await appState.signOut()
                        }
                    } label: {
                        if appState.isSubmittingAuth {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("Sign out")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(appState.isSubmittingAuth)
                    .accessibilityIdentifier("account.signOut")
                }
            }
            .navigationTitle("Account")
            .onAppear {
                if profileName.isEmpty {
                    profileName = appState.sessionUser?.name ?? ""
                }
            }
            .onChange(of: appState.sessionUser?.name) { _, newValue in
                profileName = newValue ?? ""
            }
        }
    }

    @ViewBuilder
    private func accountSectionButton(for section: AccountSection) -> some View {
        let button = Button(section.title) {
            selectedSection = section
            appState.clearAccountFeedback()
        }
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("account.section.\(section.rawValue)")

        if selectedSection == section {
            button.buttonStyle(.borderedProminent)
        } else {
            button.buttonStyle(.bordered)
        }
    }

    private var profileSettingsSection: some View {
        Section("Profile") {
            TextField("Name", text: $profileName)
                .textContentType(.name)
                .accessibilityIdentifier("account.profile.name")

            Button {
                Task {
                    await appState.updateProfile(name: profileName)
                }
            } label: {
                if appState.isSubmittingAuth {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Save changes")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("account.profile.save")
        }
    }

    private var securitySettingsSection: some View {
        Section("Security") {
            SecureField("Current password", text: $currentPassword)
                .textContentType(.password)
                .accessibilityIdentifier("account.security.currentPassword")

            SecureField("New password", text: $newPassword)
                .textContentType(.newPassword)
                .accessibilityIdentifier("account.security.newPassword")

            SecureField("Confirm new password", text: $confirmPassword)
                .textContentType(.newPassword)
                .accessibilityIdentifier("account.security.confirmPassword")

            Button {
                Task {
                    await appState.changePassword(
                        currentPassword: currentPassword,
                        newPassword: newPassword,
                        confirmPassword: confirmPassword
                    )
                    if appState.accountError == nil {
                        currentPassword = ""
                        newPassword = ""
                        confirmPassword = ""
                    }
                }
            } label: {
                if appState.isSubmittingAuth {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Change password")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("account.security.changePassword")
        }
    }
}
