import SwiftUI

struct LiquidBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.blue.opacity(0.35), Color.cyan.opacity(0.22), Color.white],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            Circle()
                .fill(Color.white.opacity(0.34))
                .frame(width: 360, height: 360)
                .offset(x: 140, y: -300)
                .blur(radius: 18)

            Circle()
                .fill(Color.blue.opacity(0.2))
                .frame(width: 280, height: 280)
                .offset(x: -140, y: -230)
                .blur(radius: 24)

            Circle()
                .fill(Color.cyan.opacity(0.2))
                .frame(width: 240, height: 240)
                .offset(x: 160, y: 260)
                .blur(radius: 28)
        }
    }
}
