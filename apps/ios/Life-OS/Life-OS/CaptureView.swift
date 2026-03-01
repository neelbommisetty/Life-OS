import SwiftData
import SwiftUI

struct CaptureView: View {
    @ObservedObject var appState: AppState
    @Environment(\.modelContext) private var modelContext
    @StateObject private var speechRecognizer = SpeechRecognizer()

    @State private var noteText = CaptureView.initialNoteText()
    @State private var recordingBaseText: String?
    @State private var saveConfirmationTick = false
    @State private var isSavingInbox = false

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground)
                .ignoresSafeArea()

            editor
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 24)

            statusOverlay
        }
        .navigationTitle(Brand.Capture.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                saveToolbarButton
            }
        }
        .safeAreaInset(edge: .bottom) {
            bottomActionArea
        }
        .onChange(of: speechRecognizer.isRecording) { _, isRecording in
            if isRecording {
                recordingBaseText = noteText
            } else {
                recordingBaseText = nil
            }
        }
        .onChange(of: speechRecognizer.liveTranscript) { _, liveTranscript in
            guard speechRecognizer.isRecording else { return }
            guard let base = recordingBaseText else { return }

            let trimmedTranscript = liveTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
            if base.isEmpty {
                noteText = trimmedTranscript
            } else if trimmedTranscript.isEmpty {
                noteText = base
            } else {
                noteText = base + (base.hasSuffix("\n") ? "" : "\n") + trimmedTranscript
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: speechRecognizer.isRecording)
    }

    private var bottomActionArea: some View {
        VStack(spacing: 12) {
            if speechRecognizer.isRecording {
                Label("Listening", systemImage: "waveform")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .transition(.opacity)
            }

            Button {
                toggleRecording()
            } label: {
                Label(
                    speechRecognizer.isRecording ? "Stop Recording" : "Start Recording",
                    systemImage: speechRecognizer.isRecording ? "stop.fill" : "mic.fill"
                )
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .tint(speechRecognizer.isRecording ? .red : Color.accentColor)
            .accessibilityLabel(speechRecognizer.isRecording ? "Stop recording" : "Start recording")
            .accessibilityIdentifier("capture.recordButton")
        }
        .padding(.horizontal, 16)
        .padding(.top, 26)
        .padding(.bottom, 14)
        .background {
            VStack(spacing: 0) {
                Divider()
                Color(.systemGroupedBackground)
            }
        }
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(.regularMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Color(.separator).opacity(0.2), lineWidth: 1)
                }

            TextEditor(text: $noteText)
                .scrollContentBackground(.hidden)
                .foregroundStyle(.primary)
                .tint(Color.accentColor)
                .font(.body)
                .padding(12)
                .background(.clear)
                .accessibilityIdentifier("capture.editor")
                .accessibilityLabel("Capture text")

            if noteText.isEmpty {
                Text(Brand.Capture.placeholder)
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .padding(12)
                    .allowsHitTesting(false)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var saveToolbarButton: some View {
        Button {
            save()
        } label: {
            Text(Brand.Capture.saveButton)
        }
        .accessibilityLabel(Brand.Capture.saveToInbox)
        .accessibilityIdentifier("capture.saveButton")
        .disabled(!canSave || isSavingInbox)
    }

    private var statusOverlay: some View {
        VStack(spacing: 8) {
            Spacer()

            if saveConfirmationTick {
                statusBadge(Brand.Capture.savedConfirmation)
                    .transition(.opacity)
                    .accessibilityLabel(Brand.Capture.savedConfirmation)
                    .accessibilityIdentifier("capture.saved")
            }

            if let inboxError = appState.inboxError {
                statusBadge(inboxError, foregroundStyle: .red)
                    .accessibilityIdentifier("capture.inboxError")
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 96)
    }

    private func statusBadge(_ text: String, foregroundStyle: Color = .primary) -> some View {
        Text(text)
            .font(.footnote.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.regularMaterial, in: Capsule())
            .foregroundStyle(foregroundStyle)
    }

    private func toggleRecording() {
        if speechRecognizer.isRecording {
            speechRecognizer.stopRecording()
        } else {
            speechRecognizer.startRecording()
        }
    }

    private var canSave: Bool {
        if !noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return true
        }

        return !(CaptureView.testCapturePrefill()?.isEmpty ?? true)
    }

    private func save() {
        guard !isSavingInbox else { return }

        if speechRecognizer.isRecording {
            speechRecognizer.stopRecording()
        }

        let trimmed = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        let contentToSave = trimmed.isEmpty ? CaptureView.testCapturePrefill() : trimmed
        guard let contentToSave, !contentToSave.isEmpty else { return }

        isSavingInbox = true

        Task { @MainActor in
            let didSave = await appState.createInboxFromCapture(
                content: contentToSave,
                modelContext: modelContext
            )
            isSavingInbox = false

            guard didSave else { return }

            noteText = ""
            saveConfirmationTick = true
            try? await Task.sleep(for: .seconds(0.9))
            saveConfirmationTick = false
        }
    }

    private static func initialNoteText() -> String {
        testCapturePrefill() ?? ""
    }

    private static func testCapturePrefill() -> String? {
        guard let prefilledText = ProcessInfo.processInfo.environment["LIFE_OS_UI_TEST_CAPTURE_TEXT"] else {
            return nil
        }

        let trimmed = prefilledText.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
