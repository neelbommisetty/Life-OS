import SwiftUI

struct AuthenticatedShellView: View {
    @ObservedObject var appState: AppState

    enum AppTab: Hashable {
        case home
        case notes
        case account
    }

    @State private var selectedTab: AppTab = .home

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeTabView(appState: appState)
                .tag(AppTab.home)
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            NotesTabView(appState: appState)
                .tag(AppTab.notes)
                .tabItem {
                    Label(Brand.Terms.library, systemImage: "note.text")
                }

            AccountTabView(appState: appState)
                .tag(AppTab.account)
                .tabItem {
                    Label("Account", systemImage: "person.crop.circle")
                }
        }
        .task {
            if appState.homeSnapshot.isEmpty && appState.notes.isEmpty {
                await appState.refreshProtectedData()
            }
        }
    }
}

struct HomeTabView: View {
    @ObservedObject var appState: AppState
    @StateObject private var speechRecognizer = SpeechRecognizer()
    @State private var noteText = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(greeting)
                                .font(.headline)
                            Text(appState.sessionUser?.name ?? appState.sessionUser?.email ?? "there")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        if appState.isRefreshingProtectedData {
                            ProgressView()
                        } else {
                            Button("Refresh", systemImage: "arrow.clockwise") {
                                Task {
                                    await appState.refreshProtectedData()
                                }
                            }
                            .labelStyle(.iconOnly)
                        }
                    }
                }

                if let protectedError = appState.protectedError {
                    Section {
                        MessageBanner(text: protectedError, color: .red, identifier: "home.error")
                    }
                }

                Section("Snapshot") {
                    HomeMetricRow(
                        title: "Recent projects",
                        count: appState.homeSnapshot.recentProjects.count,
                        subtitle: appState.homeSnapshot.recentProjects.first?.name ?? "No projects yet.",
                        icon: "folder"
                    )

                    HomeMetricRow(
                        title: "Upcoming tasks",
                        count: appState.homeSnapshot.upcomingTasks.count,
                        subtitle: appState.homeSnapshot.upcomingTasks.first?.title ?? "No tasks due soon.",
                        icon: "checklist"
                    )

                    HomeMetricRow(
                        title: Brand.Terms.library,
                        count: appState.homeSnapshot.recentNotes.count,
                        subtitle: appState.homeSnapshot.recentNotes.first?.title ?? "No notes here yet.",
                        icon: "note.text"
                    )
                }

                Section("Capture") {
                    Label(
                        speechRecognizer.isRecording ? "Recording" : "Ready",
                        systemImage: speechRecognizer.isRecording ? "waveform.circle.fill" : "checkmark.circle.fill"
                    )
                    .foregroundStyle(speechRecognizer.isRecording ? .red : .secondary)

                    ZStack(alignment: .topLeading) {
                        TextEditor(text: $noteText)
                            .frame(minHeight: 160)
                            .scrollContentBackground(.hidden)
                            .background(Color.clear)

                        if noteText.isEmpty {
                            Text("Type here, or use the mic to append speech…")
                                .foregroundStyle(.tertiary)
                                .padding(.top, 8)
                                .padding(.leading, 6)
                                .allowsHitTesting(false)
                        }
                    }

                    Text(statusText)
                        .font(.callout)
                        .foregroundStyle(.secondary)

                    Button {
                        toggleRecording()
                    } label: {
                        Label(
                            speechRecognizer.isRecording ? "Stop voice input" : "Start voice input",
                            systemImage: speechRecognizer.isRecording ? "stop.fill" : "mic.fill"
                        )
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(speechRecognizer.isRecording ? .red : .accentColor)
                    .accessibilityLabel(speechRecognizer.isRecording ? "Stop voice input" : "Start voice input")

                    if let errorMessage = speechRecognizer.errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Brand.productName)
        }
    }

    private func toggleRecording() {
        if speechRecognizer.isRecording {
            speechRecognizer.stopRecording()
            appendTranscript(speechRecognizer.liveTranscript)
        } else {
            speechRecognizer.startRecording()
        }
    }

    private func appendTranscript(_ transcript: String) {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            noteText = trimmed
        } else {
            noteText += "\n\(trimmed)"
        }
    }

    private var statusText: String {
        if speechRecognizer.isRecording {
            return speechRecognizer.liveTranscript.isEmpty ? "Listening…" : speechRecognizer.liveTranscript
        }
        return "Tap the mic to append speech."
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour >= 5 && hour < 12 { return "Good morning" }
        if hour >= 12 && hour < 17 { return "Good afternoon" }
        return "Good evening"
    }
}

struct HomeMetricRow: View {
    let title: String
    let count: Int
    let subtitle: String
    let icon: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Color.accentColor)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))

                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Text("\(count)")
                .font(.headline.monospacedDigit())
        }
    }
}

struct NotesTabView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        NavigationStack {
            List {
                if appState.notes.isEmpty {
                    Text("No notes here yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(appState.notes) { note in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(note.title)
                                .font(.headline)

                            if !note.content.isEmpty {
                                Text(note.content)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(3)
                            }

                            if let updatedAt = note.updatedAt {
                                Text(updatedAt)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Brand.Terms.library)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if appState.isRefreshingProtectedData {
                        ProgressView()
                    } else {
                        Button("Refresh", systemImage: "arrow.clockwise") {
                            Task {
                                await appState.refreshProtectedData()
                            }
                        }
                        .labelStyle(.iconOnly)
                    }
                }
            }
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
