import SwiftUI

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @StateObject private var appState = AppState()

    var body: some View {
        ZStack {
            LiquidBackground()

            if appState.isBootstrapping {
                BootstrappingView()
            } else if appState.sessionUser == nil {
                AuthGatewayView(appState: appState)
            } else {
                AuthenticatedShellView(appState: appState)
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: appState.isBootstrapping)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: appState.sessionUser?.id)
        .task {
            await appState.bootstrapSessionIfNeeded(modelContext: modelContext)
        }
        .onOpenURL { url in
            appState.captureResetToken(from: url)
        }
    }
}

#Preview {
    ContentView()
}
