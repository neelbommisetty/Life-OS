import AVFoundation
import Combine
import Speech
import SwiftUI

struct ContentView: View {
    @StateObject private var speechRecognizer = SpeechRecognizer()
    @State private var noteText = ""

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.blue.opacity(0.35), Color.cyan.opacity(0.22), Color.white],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            Circle()
                .fill(Color.white.opacity(0.3))
                .frame(width: 340, height: 340)
                .offset(x: 120, y: -260)
                .blur(radius: 18)

            Circle()
                .fill(Color.blue.opacity(0.2))
                .frame(width: 260, height: 260)
                .offset(x: -140, y: -220)
                .blur(radius: 24)

            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Home")
                        .font(.largeTitle.bold())

                    Spacer()

                    Label(speechRecognizer.isRecording ? "Live" : "Ready", systemImage: speechRecognizer.isRecording ? "waveform.circle.fill" : "checkmark.circle.fill")
                        .font(.footnote.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .liquidCard(.clear, in: Capsule())
                }

                ZStack(alignment: .topLeading) {
                    TextEditor(text: $noteText)
                        .padding(12)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                .liquidCard(.regular, in: RoundedRectangle(cornerRadius: 30, style: .continuous))

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
                            .font(.title2.weight(.semibold))
                            .frame(width: 54, height: 54)
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
                        .padding(.horizontal, 6)
                }
            }
            .padding()
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: speechRecognizer.isRecording)
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
            noteText += "\n" + trimmed
        }
    }

    private var statusText: String {
        if speechRecognizer.isRecording {
            return speechRecognizer.liveTranscript.isEmpty ? "Listening..." : speechRecognizer.liveTranscript
        }
        return "Tap the glass mic to append speech"
    }
}

private extension View {
    @ViewBuilder
    func liquidCard<S: Shape>(_ glass: Glass = .regular, in shape: S) -> some View {
#if os(visionOS)
        background(.ultraThinMaterial, in: shape)
#else
        if #available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *) {
            glassEffect(glass, in: shape)
        } else {
            background(.ultraThinMaterial, in: shape)
        }
#endif
    }
}

@MainActor
final class SpeechRecognizer: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var liveTranscript = ""
    @Published var errorMessage: String?

    private let audioEngine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale.current)
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func startRecording() {
        guard !isRecording else { return }
        errorMessage = nil
        liveTranscript = ""

        Task {
            let hasSpeechAccess = await requestSpeechAuthorization()
            let hasMicAccess = await requestMicAuthorization()

            guard hasSpeechAccess else {
                errorMessage = "Speech recognition permission is required."
                return
            }

            guard hasMicAccess else {
                errorMessage = "Microphone permission is required."
                return
            }

            beginRecognition()
        }
    }

    func stopRecording() {
        guard isRecording else { return }
        isRecording = false

        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
    }

    private func beginRecognition() {
        guard let recognizer, recognizer.isAvailable else {
            errorMessage = "Speech recognition is currently unavailable."
            return
        }

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            self.request = request

            let inputNode = audioEngine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            inputNode.removeTap(onBus: 0)
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                self?.request?.append(buffer)
            }

            audioEngine.prepare()
            try audioEngine.start()

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self else { return }

                if let result {
                    self.liveTranscript = result.bestTranscription.formattedString
                }

                if error != nil, self.isRecording {
                    self.errorMessage = "Could not transcribe audio."
                    self.stopRecording()
                }
            }

            isRecording = true
        } catch {
            errorMessage = "Failed to start recording."
            stopRecording()
        }
    }

    private func requestSpeechAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    private func requestMicAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            if #available(iOS 17.0, *) {
                AVAudioApplication.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            } else {
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        }
    }
}

#Preview {
    ContentView()
}
