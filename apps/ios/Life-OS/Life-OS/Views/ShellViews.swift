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
                    Label("Notes", systemImage: "note.text")
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
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Welcome")
                                .font(.title.bold())
                            Text(appState.sessionUser?.name ?? appState.sessionUser?.email ?? "Authenticated User")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Button {
                            Task {
                                await appState.refreshProtectedData()
                            }
                        } label: {
                            if appState.isRefreshingProtectedData {
                                ProgressView()
                                    .frame(width: 44, height: 44)
                            } else {
                                Image(systemName: "arrow.clockwise")
                                    .font(.headline.weight(.semibold))
                                    .frame(width: 44, height: 44)
                            }
                        }
                        .buttonStyle(.glassProminent)
                        .tint(.blue)
                    }

                    if let protectedError = appState.protectedError {
                        MessageBanner(text: protectedError, color: .red, identifier: "home.error")
                            .padding(.horizontal, -16)
                    }

                    HomeSnapshotCards(snapshot: appState.homeSnapshot)

                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Quick capture")
                                .font(.headline.weight(.semibold))

                            Spacer()

                            Label(
                                speechRecognizer.isRecording ? "Live" : "Ready",
                                systemImage: speechRecognizer.isRecording ? "waveform.circle.fill" : "checkmark.circle.fill"
                            )
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .liquidCard(.clear, in: Capsule())
                        }

                        ZStack(alignment: .topLeading) {
                            TextEditor(text: $noteText)
                                .padding(12)
                                .frame(minHeight: 180)
                                .scrollContentBackground(.hidden)
                                .background(.clear)

                            if noteText.isEmpty {
                                Text("Type here or tap the mic to append speech...")
                                    .foregroundStyle(.secondary)
                                    .padding(.top, 22)
                                    .padding(.leading, 18)
                                    .allowsHitTesting(false)
                            }
                        }
                        .liquidCard(.regular, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                        HStack(spacing: 12) {
                            Text(statusText)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)

                            Spacer()

                            Button {
                                toggleRecording()
                            } label: {
                                Image(systemName: speechRecognizer.isRecording ? "stop.fill" : "mic.fill")
                                    .font(.title3.weight(.semibold))
                                    .frame(width: 52, height: 52)
                            }
                            .buttonStyle(.glassProminent)
                            .tint(speechRecognizer.isRecording ? .red : .blue)
                            .accessibilityLabel(speechRecognizer.isRecording ? "Stop voice input" : "Start voice input")
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .liquidCard(.clear, in: Capsule())

                        if let errorMessage = speechRecognizer.errorMessage {
                            Text(errorMessage)
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                    }
                    .padding(16)
                    .liquidCard(.regular, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
                }
                .padding()
            }
            .navigationTitle("Life-OS")
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
            return speechRecognizer.liveTranscript.isEmpty ? "Listening..." : speechRecognizer.liveTranscript
        }
        return "Tap the glass mic to append speech"
    }
}

struct HomeSnapshotCards: View {
    let snapshot: HomeSnapshot

    var body: some View {
        VStack(spacing: 10) {
            HomeMetricCard(
                title: "Recent projects",
                count: snapshot.recentProjects.count,
                subtitle: snapshot.recentProjects.first?.name ?? "No projects yet",
                icon: "folder"
            )

            HomeMetricCard(
                title: "Upcoming tasks",
                count: snapshot.upcomingTasks.count,
                subtitle: snapshot.upcomingTasks.first?.title ?? "No tasks pending",
                icon: "checklist"
            )

            HomeMetricCard(
                title: "Recent notes",
                count: snapshot.recentNotes.count,
                subtitle: snapshot.recentNotes.first?.title ?? "No notes yet",
                icon: "note.text"
            )
        }
    }
}

struct HomeMetricCard: View {
    let title: String
    let count: Int
    let subtitle: String
    let icon: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.headline)
                .frame(width: 38, height: 38)
                .liquidCard(.clear, in: Circle())

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
                .font(.headline.weight(.bold))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .liquidCard(.clear, in: Capsule())
        }
        .padding(14)
        .liquidCard(.regular, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

struct NotesTabView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        NavigationStack {
            Group {
                if appState.notes.isEmpty {
                    Text("No notes yet")
                        .foregroundStyle(.secondary)
                        .padding()
                        .liquidCard(.regular, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                } else {
                    ScrollView {
                        VStack(spacing: 10) {
                            ForEach(appState.notes) { note in
                                VStack(alignment: .leading, spacing: 8) {
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
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                                .liquidCard(.regular, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Notes")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            await appState.refreshProtectedData()
                        }
                    } label: {
                        Image(systemName: "arrow.clockwise")
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
            ScrollView {
                VStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Signed in")
                            .font(.headline)

                        Text(appState.sessionUser?.name ?? "No name")
                            .font(.title3.weight(.semibold))

                        Text(appState.sessionUser?.email ?? "No email")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18)
                    .liquidCard(.regular, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                    HStack(spacing: 8) {
                        ForEach(AccountSection.allCases) { section in
                            Button(section.title) {
                                selectedSection = section
                                appState.clearAccountFeedback()
                            }
                            .font(.footnote.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(selectedSection == section ? Color.blue.opacity(0.18) : Color.white.opacity(0.12))
                            .overlay {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(selectedSection == section ? Color.blue.opacity(0.45) : Color.white.opacity(0.28), lineWidth: 1)
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .accessibilityIdentifier("account.section.\(section.rawValue)")
                        }
                    }
                    .padding(8)
                    .liquidCard(.clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

                    if let accountError = appState.accountError {
                        MessageBanner(text: accountError, color: .red, identifier: "account.error")
                            .padding(.horizontal, -16)
                    }

                    if let accountSuccess = appState.accountSuccess {
                        MessageBanner(text: accountSuccess, color: .blue, identifier: "account.success")
                            .padding(.horizontal, -16)
                    }

                    if selectedSection == .profile {
                        profileSettingsCard
                    } else {
                        securitySettingsCard
                    }

                    Button {
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
                    .buttonStyle(.glassProminent)
                    .tint(.red)
                    .disabled(appState.isSubmittingAuth)
                    .accessibilityIdentifier("account.signOut")
                }
                .padding()
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

    private var profileSettingsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Profile settings")
                .font(.headline.weight(.semibold))

            VStack(alignment: .leading, spacing: 6) {
                Text("Email")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(appState.sessionUser?.email ?? "No email")
                    .font(.body)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.1))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.white.opacity(0.26), lineWidth: 1)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Name")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                TextField("Name", text: $profileName)
                    .textContentType(.name)
                    .authInputStyle()
                    .accessibilityIdentifier("account.profile.name")
            }

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
            .buttonStyle(.glassProminent)
            .tint(.blue)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("account.profile.save")
        }
        .padding(16)
        .liquidCard(.regular, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var securitySettingsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Security settings")
                .font(.headline.weight(.semibold))

            SecureField("Current password", text: $currentPassword)
                .textContentType(.password)
                .authInputStyle()
                .accessibilityIdentifier("account.security.currentPassword")

            SecureField("New password", text: $newPassword)
                .textContentType(.newPassword)
                .authInputStyle()
                .accessibilityIdentifier("account.security.newPassword")

            SecureField("Confirm new password", text: $confirmPassword)
                .textContentType(.newPassword)
                .authInputStyle()
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
            .buttonStyle(.glassProminent)
            .tint(.blue)
            .disabled(appState.isSubmittingAuth)
            .accessibilityIdentifier("account.security.changePassword")
        }
        .padding(16)
        .liquidCard(.regular, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}
