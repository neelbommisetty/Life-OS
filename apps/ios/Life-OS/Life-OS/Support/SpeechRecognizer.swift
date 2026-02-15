import AVFoundation
import Combine
import Foundation
import Speech
import SwiftUI

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
                errorMessage = "Enable Speech Recognition to use voice input."
                return
            }

            guard hasMicAccess else {
                errorMessage = "Enable Microphone access to use voice input."
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
            errorMessage = Brand.couldnt("start voice input")
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
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }

            audioEngine.prepare()
            try audioEngine.start()

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self else { return }

                Task { @MainActor in
                    if let result {
                        self.liveTranscript = result.bestTranscription.formattedString
                    }

                    if error != nil, self.isRecording {
                        self.errorMessage = Brand.couldnt("transcribe audio")
                        self.stopRecording()
                    }
                }
            }

            isRecording = true
        } catch {
            errorMessage = Brand.couldnt("start voice input")
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
