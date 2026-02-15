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
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.10, blue: 0.26),
                    Color(red: 0.02, green: 0.05, blue: 0.16),
                    .black,
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            editor
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)

            VStack(spacing: 14) {
                Spacer()

                if speechRecognizer.isRecording {
                    Image(systemName: "waveform")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.75))
                        .accessibilityHidden(true)
                        .transition(.opacity)
                }
            }

            if saveConfirmationTick {
                VStack {
                    Spacer()
                    Text("Saved to Inbox")
                        .font(.footnote.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.black.opacity(0.35), in: Capsule())
                        .foregroundStyle(.white)
                        .padding(.bottom, 104)
                }
                .transition(.opacity)
                .accessibilityLabel("Saved to Inbox")
            }

            if let inboxError = appState.inboxError {
                VStack {
                    Spacer()
                    Text(inboxError)
                        .font(.footnote)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.black.opacity(0.35), in: Capsule())
                        .foregroundStyle(.white)
                        .padding(.bottom, 62)
                }
                .accessibilityIdentifier("capture.inboxError")
            }
        }
        .safeAreaInset(edge: .bottom) {
            bottomBar
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

    private var bottomBar: some View {
        HStack(spacing: 22) {
            saveButton
            Spacer(minLength: 0)
            micButton
            Spacer(minLength: 0)
            Color.clear
                .frame(width: 56, height: 56)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
        .background(.black.opacity(0.001))
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $noteText)
                .scrollContentBackground(.hidden)
                .foregroundStyle(.white.opacity(0.95))
                .tint(.white)
                .font(.system(.body, design: .rounded))
                .padding(12)
                .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .accessibilityIdentifier("capture.editor")
                .accessibilityLabel("Capture text")

            if noteText.isEmpty {
                Text("Write or tap to\nspeak…")
                    .font(.system(size: 44, weight: .regular, design: .rounded))
                    .foregroundStyle(.white.opacity(0.22))
                    .padding(.top, 26)
                    .padding(.leading, 22)
                    .allowsHitTesting(false)
            }
        }
    }

    private var micButton: some View {
        Button {
            toggleRecording()
        } label: {
            ZStack {
                Circle()
                    .fill(speechRecognizer.isRecording ? Color.red.opacity(0.90) : Color.blue.opacity(0.95))
                    .frame(width: 78, height: 78)
                    .shadow(color: .black.opacity(0.35), radius: 18, x: 0, y: 10)

                Image(systemName: speechRecognizer.isRecording ? "stop.fill" : "mic.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(.white)
            }
        }
        .accessibilityLabel(speechRecognizer.isRecording ? "Stop recording" : "Start recording")
        .buttonStyle(.plain)
    }

    private var saveButton: some View {
        Button {
            save()
        } label: {
            ZStack {
                Circle()
                    .fill(.white.opacity(canSave ? 0.12 : 0.06))
                    .frame(width: 56, height: 56)
                    .overlay {
                        Circle()
                            .stroke(.white.opacity(canSave ? 0.18 : 0.08), lineWidth: 1)
                    }

                Image(systemName: "checkmark")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white.opacity(canSave ? 0.95 : 0.35))
            }
        }
        .accessibilityLabel("Save to Inbox")
        .disabled(!canSave || isSavingInbox)
        .buttonStyle(.plain)
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
