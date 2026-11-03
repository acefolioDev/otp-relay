import SwiftUI

struct MessageItem: Identifiable, Equatable {
    let id: String
    let sender: String
    let body: String
    let code: String?
    let timestamp: Date
    let isUsed: Bool
}

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = 0
    @State private var serverURL: String = RelayConfig.settings.string(forKey: "serverURL") ?? RelayConfig.defaultServerURL

    // Auth & User Profile State
    @AppStorage("user_email") private var userEmail: String = ""
    @AppStorage("user_name") private var userName: String = ""
    @AppStorage("device_id") private var deviceId: String = ""
    @AppStorage("device_token") private var deviceToken: String = ""
    @State private var isGoogleSigningIn = false

    // Auth Form State (Login / Register)
    @State private var authMode: AuthMode = .login
    @State private var authName = ""
    @State private var authEmail = ""
    @State private var authPassword = ""
    @State private var authStatusMessage = ""
    @State private var isSubmittingAuth = false

    enum AuthMode { case login, register }

    // Pairing State
    @State private var showScanner = false
    @State private var showPinSheet = false
    @State private var showManualJsonSheet = false
    @State private var manualJsonInput = ""
    @State private var pinCodeInput = ""
    @State private var pairingStatus = "No device paired yet."
    @State private var isPairingActive = false

    // Messages & Codes
    @State private var messages: [MessageItem] = []
    @State private var latestOTP: RelayOTP?
    @State private var isListening = true
    @State private var waitTask: URLSessionDataTask?

    var body: some View {
        ZStack {
            LiquidGlassBackground()

            TabView(selection: $selectedTab) {
                // TAB 1: Messages & Codes View
                messagesView
                    .tabItem {
                        Label("Messages", systemImage: "bubble.left.and.bubble.right.fill")
                    }
                    .tag(0)

                // TAB 2: Device Pairing (QR & PIN Code)
                pairingView
                    .tabItem {
                        Label("Devices", systemImage: "iphone.and.arrow.forward")
                    }
                    .tag(1)

                // TAB 3: Account & Security
                accountView
                    .tabItem {
                        Label("Account", systemImage: "person.crop.circle.fill")
                    }
                    .tag(2)
            }
            .tint(.cyan)
        }
        .preferredColorScheme(.dark)
        .onAppear {
            checkCurrentPairing()
            if isListening { startListening() }
        }
        .sheet(isPresented: $showScanner) {
            QRScannerView(
                onCodeFound: { payload in
                    showScanner = false
                    handleScannedQRPayload(payload)
                },
                onCancel: {
                    showScanner = false
                }
            )
        }
        .sheet(isPresented: $showPinSheet) {
            pinEntrySheet
        }
        .sheet(isPresented: $showManualJsonSheet) {
            manualJsonSheet
        }
    }

    // MARK: - Tab 1: Messages Stream
    private var messagesView: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Top Live AutoFill Banner
                    LiquidGlassCard {
                        HStack(spacing: 14) {
                            ZStack {
                                Circle()
                                    .fill(isListening ? Color.cyan.opacity(0.2) : Color.gray.opacity(0.2))
                                    .frame(width: 44, height: 44)
                                Image(systemName: isListening ? "antenna.radiowaves.left.and.right" : "bolt.slash.fill")
                                    .font(.system(size: 20))
                                    .foregroundStyle(isListening ? .cyan : .secondary)
                            }
                            VStack(alignment: .leading, spacing: 3) {
                                Text(isListening ? "Relay Stream Active" : "Relay Paused")
                                    .font(.headline)
                                    .foregroundStyle(.white)
                                Text("Incoming SMS codes display in liquid glass stream")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                    }

                    // Latest OTP Card (if present)
                    if let otp = latestOTP, otp.expiresAt > Date() {
                        LiquidGlassCard {
                            VStack(alignment: .leading, spacing: 14) {
                                HStack {
                                    Label("Latest Verification Code", systemImage: "key.fill")
                                        .font(.subheadline.bold())
                                        .foregroundStyle(.cyan)
                                    Spacer()
                                    Text("Valid for 90s")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }

                                Text(otp.code)
                                    .font(.system(size: 38, weight: .bold, design: .monospaced))
                                    .foregroundStyle(.white)
                                    .textSelection(.enabled)

                                HStack(spacing: 12) {
                                    LiquidGlassButton(title: "Copy Code", icon: "doc.on.doc", isProminent: true) {
                                        UIPasteboard.general.string = otp.code
                                    }
                                    LiquidGlassButton(title: "Mark Used", icon: "checkmark", isProminent: false) {
                                        RelayClient.consume(otp)
                                        latestOTP = nil
                                    }
                                }
                            }
                        }
                    }

                    // Message Stream / History
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Recent Relayed Messages")
                            .font(.subheadline.bold())
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 4)

                        if messages.isEmpty {
                            LiquidGlassCard {
                                VStack(spacing: 12) {
                                    Image(systemName: "tray")
                                        .font(.system(size: 32))
                                        .foregroundStyle(.secondary)
                                    Text("Waiting for incoming messages…")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                    Text("Messages and codes received on your Android will show up here automatically.")
                                        .font(.caption)
                                        .multilineTextAlignment(.center)
                                        .foregroundStyle(.gray)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 20)
                            }
                        } else {
                            ForEach(messages) { msg in
                                messageCard(msg)
                            }
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Messages")
        }
    }

    private func messageCard(_ msg: MessageItem) -> some View {
        LiquidGlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(msg.sender)
                        .font(.headline)
                        .foregroundStyle(.white)
                    Spacer()
                    Text(msg.timestamp, style: .time)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Text(msg.body)
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.85))

                if let code = msg.code {
                    HStack {
                        Text("CODE:")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)
                        Text(code)
                            .font(.title3.monospaced().bold())
                            .foregroundStyle(.cyan)
                        Spacer()
                        Button(action: { UIPasteboard.general.string = code }) {
                            Image(systemName: "doc.on.doc")
                                .foregroundStyle(.cyan)
                        }
                    }
                    .padding(10)
                    .background(Color.white.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }

    // MARK: - Tab 2: Device Pairing (QR & PIN)
    private var pairingView: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    LiquidGlassCard {
                        VStack(spacing: 16) {
                            Image(systemName: isPairingActive ? "checkmark.shield.fill" : "link.badge.plus")
                                .font(.system(size: 44))
                                .foregroundStyle(isPairingActive ? .green : .cyan)

                            Text(isPairingActive ? "Device Paired Securely" : "Pair with Android Phone")
                                .font(.title3.bold())
                                .foregroundStyle(.white)

                            Text("Connect your Android and iPhone to relay incoming SMS and verification codes end-to-end encrypted.")
                                .font(.subheadline)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(.secondary)

                            Divider().background(Color.white.opacity(0.1))

                            Text(pairingStatus)
                                .font(.footnote)
                                .foregroundStyle(isPairingActive ? .green : .cyan)
                        }
                    }

                    // Pairing Actions
                    VStack(spacing: 14) {
                        LiquidGlassButton(title: "Scan Android QR Code", icon: "qrcode.viewfinder", isProminent: true) {
                            showScanner = true
                        }

                        LiquidGlassButton(title: "Paste Pairing Payload (Simulator)", icon: "doc.on.clipboard", isProminent: false) {
                            if let clip = UIPasteboard.general.string, clip.contains("role") {
                                manualJsonInput = clip
                            }
                            showManualJsonSheet = true
                        }

                        LiquidGlassButton(title: "Enter 8-Digit PIN Code", icon: "number", isProminent: false) {
                            showPinSheet = true
                        }
                    }

                    // Security Info
                    LiquidGlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Label("End-to-End Privacy", systemImage: "lock.fill")
                                .font(.headline)
                                .foregroundStyle(.white)
                            Text("The AES-256 encryption key is exchanged strictly between your devices. The server cannot decrypt or inspect your SMS messages or OTPs.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Device Pairing")
        }
    }

    // MARK: - Tab 3: Account & Settings
    private var accountView: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    if userEmail.isEmpty {
                        // Registration & Login Form
                        LiquidGlassCard {
                            VStack(spacing: 16) {
                                Image(systemName: "person.crop.circle.badge.plus")
                                    .font(.system(size: 48))
                                    .foregroundStyle(.cyan)

                                // Segmented Control for Login vs Register
                                Picker("Auth Mode", selection: $authMode) {
                                    Text("Sign In").tag(AuthMode.login)
                                    Text("Create Account").tag(AuthMode.register)
                                }
                                .pickerStyle(.segmented)
                                .padding(.bottom, 6)

                                if authMode == .register {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("Full Name").font(.caption.bold()).foregroundStyle(.secondary)
                                        TextField("Your Name", text: $authName)
                                            .padding(12)
                                            .background(Color.white.opacity(0.08))
                                            .clipShape(RoundedRectangle(cornerRadius: 12))
                                            .foregroundStyle(.white)
                                    }
                                }

                                VStack(alignment: .leading, spacing: 6) {
                                    Text("Email").font(.caption.bold()).foregroundStyle(.secondary)
                                    TextField("user@example.com", text: $authEmail)
                                        .keyboardType(.emailAddress)
                                        .textInputAutocapitalization(.never)
                                        .autocorrectionDisabled()
                                        .padding(12)
                                        .background(Color.white.opacity(0.08))
                                        .clipShape(RoundedRectangle(cornerRadius: 12))
                                        .foregroundStyle(.white)
                                }

                                VStack(alignment: .leading, spacing: 6) {
                                    Text("Password").font(.caption.bold()).foregroundStyle(.secondary)
                                    SecureField("••••••••", text: $authPassword)
                                        .textInputAutocapitalization(.never)
                                        .padding(12)
                                        .background(Color.white.opacity(0.08))
                                        .clipShape(RoundedRectangle(cornerRadius: 12))
                                        .foregroundStyle(.white)
                                }

                                if !authStatusMessage.isEmpty {
                                    Text(authStatusMessage)
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                }

                                LiquidGlassButton(
                                    title: isSubmittingAuth ? "Processing..." : (authMode == .register ? "Create Account" : "Sign In"),
                                    icon: authMode == .register ? "person.badge.plus" : "arrow.right.circle",
                                    isProminent: true
                                ) {
                                    submitAuth()
                                }

                                Divider().background(Color.white.opacity(0.1))

                                // Optional Google Sign In
                                Text("OR")
                                    .font(.caption2.bold())
                                    .foregroundStyle(.secondary)

                                LiquidGlassButton(title: "Sign in with Google (Coming Soon)", icon: "g.circle.fill", isProminent: false) {
                                    // Google Sign-In is not yet available
                                }
                                .disabled(true)
                                .opacity(0.5)
                            }
                        }
                    } else {
                        // User Profile Card
                        LiquidGlassCard {
                            VStack(spacing: 16) {
                                Image(systemName: "person.crop.circle.fill.badge.checkmark")
                                    .font(.system(size: 48))
                                    .foregroundStyle(.cyan)

                                Text(userName.isEmpty ? "Connected Account" : userName)
                                    .font(.title3.bold())
                                    .foregroundStyle(.white)
                                Text(userEmail)
                                    .font(.subheadline)
                                    .foregroundStyle(.cyan)

                                LiquidGlassButton(title: "Sign Out", icon: "rectangle.portrait.and.arrow.right", isProminent: false) {
                                    signOut()
                                }
                            }
                        }
                    }

                    LiquidGlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Relay Server URL")
                                .font(.subheadline.bold())
                                .foregroundStyle(.white)

                            TextField("https://...", text: $serverURL)
                                .textFieldStyle(.plain)
                                .padding(12)
                                .background(Color.white.opacity(0.08))
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .foregroundStyle(.white)

                            LiquidGlassButton(title: "Save Server URL", icon: "tray.and.arrow.down", isProminent: false) {
                                RelayConfig.settings.set(serverURL, forKey: "serverURL")
                                pairingStatus = "Server URL updated."
                            }
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Account")
        }
    }

    // MARK: - Manual PIN Entry Sheet
    private var pinEntrySheet: some View {
        ZStack {
            LiquidGlassBackground()
            VStack(spacing: 20) {
                Text("Enter Pairing PIN")
                    .font(.title2.bold())
                    .foregroundStyle(.white)

                Text("Enter the 8-character PIN code displayed on your Android phone's pairing screen.")
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                TextField("e.g. 9B4F1A2C", text: $pinCodeInput)
                    .font(.system(size: 28, weight: .bold, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .padding()
                    .background(Color.white.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .foregroundStyle(.white)
                    .padding(.horizontal)

                HStack(spacing: 16) {
                    LiquidGlassButton(title: "Cancel", icon: nil, isProminent: false) {
                        showPinSheet = false
                    }
                    LiquidGlassButton(title: "Pair Device", icon: "link", isProminent: true) {
                        completePinPairing(pinCodeInput)
                    }
                }
                .padding(.horizontal)
            }
            .padding()
        }
        .presentationDetents([.fraction(0.45)])
    }

    // MARK: - Manual JSON Sheet (for Simulator / No-Camera)
    private var manualJsonSheet: some View {
        ZStack {
            LiquidGlassBackground()
            VStack(spacing: 18) {
                Text("Paste Pairing JSON")
                    .font(.title2.bold())
                    .foregroundStyle(.white)

                Text("Paste the pairing payload from the Android app or provision file.")
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                TextEditor(text: $manualJsonInput)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(.white)
                    .padding(8)
                    .background(Color.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .frame(height: 120)
                    .padding(.horizontal)

                HStack(spacing: 16) {
                    LiquidGlassButton(title: "Paste Clipboard", icon: "doc.on.clipboard", isProminent: false) {
                        if let clip = UIPasteboard.general.string {
                            manualJsonInput = clip
                        }
                    }
                    LiquidGlassButton(title: "Apply Pairing", icon: "checkmark", isProminent: true) {
                        showManualJsonSheet = false
                        handleScannedQRPayload(manualJsonInput.trimmingCharacters(in: .whitespacesAndNewlines))
                    }
                }
                .padding(.horizontal)
            }
            .padding()
        }
        .presentationDetents([.fraction(0.55)])
    }

    // MARK: - Logic & Actions
    private func checkCurrentPairing() {
        if let token = RelayToken.read(), !token.isEmpty {
            isPairingActive = true
            pairingStatus = "Connected to registered relay pairing."
        } else {
            isPairingActive = false
            pairingStatus = "Scan QR code or enter PIN from Android to connect."
        }
    }

    private func startListening() {
        RelayClient.fetch { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let otp):
                    if let otp = otp {
                        self.latestOTP = otp
                        let newItem = MessageItem(
                            id: otp.id,
                            sender: "Verification OTP",
                            body: "Relayed code: \(otp.code)",
                            code: otp.code,
                            timestamp: Date(),
                            isUsed: false
                        )
                        if !self.messages.contains(where: { $0.id == otp.id }) {
                            self.messages.insert(newItem, at: 0)
                        }
                    }
                case .failure:
                    break
                }
                if self.isListening {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                        self.startListening()
                    }
                }
            }
        }
    }

    private func handleScannedQRPayload(_ payload: String) {
        do {
            let _ = try RelayPairing.parse(payload)
            try RelayToken.save(payload)
            isPairingActive = true
            pairingStatus = "Successfully paired via QR code!"
            startListening()
        } catch {
            if payload.count == 8 {
                completePinPairing(payload)
            } else {
                pairingStatus = "Invalid QR code format."
            }
        }
    }

    private func completePinPairing(_ pin: String) {
        showPinSheet = false
        guard !deviceId.isEmpty, !deviceToken.isEmpty else {
            pairingStatus = "Please sign in first before pairing."
            return
        }
        pairingStatus = "Verifying pairing code..."

        let endpoint = "\(serverURL)/api/v1/devices/pair/complete"
        guard let url = URL(string: endpoint) else {
            pairingStatus = "Invalid server URL."
            return
        }

        let payload: [String: Any] = [
            "pairCode": pin.uppercased(),
            "deviceId": deviceId
        ]

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(deviceToken)", forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        URLSession.shared.dataTask(with: req) { data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    self.pairingStatus = "Pairing failed: \(error.localizedDescription)"
                    return
                }
                guard let data = data,
                      let http = response as? HTTPURLResponse else {
                    self.pairingStatus = "Invalid server response."
                    return
                }
                if http.statusCode == 200 {
                    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let pairingData = json["pairing"] as? [String: Any],
                          let pairingJsonData = try? JSONSerialization.data(withJSONObject: pairingData),
                          let pairingJsonString = String(data: pairingJsonData, encoding: .utf8) else {
                        self.pairingStatus = "Failed to parse pairing keys."
                        return
                    }

                    do {
                        try RelayToken.save(pairingJsonString)
                        self.isPairingActive = true
                        self.pairingStatus = "Pairing complete and verified!"
                        self.startListening()
                    } catch {
                        self.pairingStatus = "Failed to save pairing to Keychain."
                    }
                } else {
                    let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                    self.pairingStatus = "Pairing failed: \(msg ?? "HTTP \(http.statusCode)")"
                }
            }
        }.resume()
    }

    private func submitAuth() {
        guard !authEmail.trimmingCharacters(in: .whitespaces).isEmpty,
              authPassword.count >= 6 else {
            authStatusMessage = "Enter a valid email and 6+ character password"
            return
        }
        isSubmittingAuth = true
        authStatusMessage = ""

        let endpoint = authMode == .register ? "/api/v1/auth/register" : "/api/v1/auth/login"
        guard let url = URL(string: "\(serverURL)\(endpoint)") else {
            authStatusMessage = "Invalid Server URL"
            isSubmittingAuth = false
            return
        }

        var payload: [String: Any] = [
            "email": authEmail.trimmingCharacters(in: .whitespaces).lowercased(),
            "password": authPassword,
            "deviceName": "iPhone 14",
            "deviceType": "ios"
        ]
        if authMode == .register {
            payload["name"] = authName.isEmpty ? "iPhone User" : authName
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        URLSession.shared.dataTask(with: req) { data, response, error in
            DispatchQueue.main.async {
                self.isSubmittingAuth = false
                if let error = error {
                    self.authStatusMessage = "Connection failed: \(error.localizedDescription)"
                    return
                }
                guard let data = data else {
                    self.authStatusMessage = "Authentication failed. Check credentials."
                    return
                }
                guard let httpResponse = response as? HTTPURLResponse else {
                    self.authStatusMessage = "Invalid server response."
                    return
                }
                if httpResponse.statusCode == 409 {
                    self.authStatusMessage = "An account with this email already exists."
                    return
                }
                if httpResponse.statusCode == 401 {
                    self.authStatusMessage = "Invalid email or password."
                    return
                }
                if !(200..<300).contains(httpResponse.statusCode) {
                    // Try to parse the error field from JSON
                    if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let errorMsg = json["error"] as? String {
                        self.authStatusMessage = errorMsg
                    } else {
                        self.authStatusMessage = "Authentication failed (HTTP \(httpResponse.statusCode))."
                    }
                    return
                }
                guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let user = json["user"] as? [String: Any] else {
                    self.authStatusMessage = "Authentication failed. Check credentials."
                    return
                }

                self.userEmail = user["email"] as? String ?? self.authEmail
                self.userName = user["name"] as? String ?? self.authName
                if let device = json["device"] as? [String: Any] {
                    self.deviceId = device["id"] as? String ?? ""
                    self.deviceToken = device["token"] as? String ?? ""
                }
            }
        }.resume()
    }

    private func triggerGoogleSignIn() {
        isGoogleSigningIn = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            self.userEmail = "user@gmail.com"
            self.userName = "Google User"
            self.isGoogleSigningIn = false
        }
    }

    private func signOut() {
        userEmail = ""
        userName = ""
        deviceId = ""
        try? RelayToken.save("")
        isPairingActive = false
        latestOTP = nil
        messages.removeAll()
        pairingStatus = "Signed out."
    }
}
