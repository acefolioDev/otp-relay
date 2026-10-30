import SwiftUI

// MARK: - Liquid Glass Design System Components
struct LiquidGlassBackground: View {
    @State private var animateGlow = false

    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.07, blue: 0.12)
                .ignoresSafeArea()

            // Dynamic fluid blur orbs
            Circle()
                .fill(
                    RadialGradient(
                        colors: [Color.cyan.opacity(0.4), Color.blue.opacity(0.15), Color.clear],
                        center: .center,
                        startRadius: 10,
                        endRadius: 220
                    )
                )
                .frame(width: 380, height: 380)
                .offset(x: animateGlow ? -60 : 70, y: animateGlow ? -140 : -60)
                .blur(radius: 50)

            Circle()
                .fill(
                    RadialGradient(
                        colors: [Color.indigo.opacity(0.35), Color.purple.opacity(0.15), Color.clear],
                        center: .center,
                        startRadius: 20,
                        endRadius: 260
                    )
                )
                .frame(width: 420, height: 420)
                .offset(x: animateGlow ? 80 : -90, y: animateGlow ? 180 : 100)
                .blur(radius: 60)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 8).repeatForever(autoreverses: true)) {
                animateGlow.toggle()
            }
        }
    }
}

struct LiquidGlassCard<Content: View>: View {
    var cornerRadius: CGFloat = 24
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .environment(\.colorScheme, .dark)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        LinearGradient(
                            stops: [
                                .init(color: .white.opacity(0.55), location: 0.0),
                                .init(color: .white.opacity(0.15), location: 0.3),
                                .init(color: .cyan.opacity(0.2), location: 0.7),
                                .init(color: .white.opacity(0.05), location: 1.0)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1.2
                    )
            )
            .shadow(color: Color.black.opacity(0.35), radius: 25, x: 0, y: 12)
    }
}

struct LiquidGlassButton: View {
    let title: String
    let icon: String?
    var isProminent: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: {
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.impactOccurred()
            action()
        }) {
            HStack(spacing: 8) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 16, weight: .semibold))
                }
                Text(title)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
            }
            .foregroundStyle(isProminent ? .black : .white)
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(
                Group {
                    if isProminent {
                        LinearGradient(
                            colors: [Color.cyan, Color(red: 0.3, green: 0.8, blue: 1.0)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    } else {
                        Color.white.opacity(0.1)
                    }
                }
            )
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: isProminent ? [.white.opacity(0.7), .clear] : [.white.opacity(0.4), .white.opacity(0.05)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
        }
    }
}
