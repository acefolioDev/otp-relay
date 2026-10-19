import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var serverURL: String = RelayConfig.settings.string(forKey: "serverURL") ?? RelayConfig.defaultServerURL
    @State private var pairingJSON = ""
    @State private var status = "Import your private iPhone pairing file, then fetch a synthetic test code."
    @State private var importing = false
    @State private var waiting = false
    @State private var waitTask: URLSessionDataTask?
    @State private var waitGeneration = UUID()
    @State private var lastSeenID: String?
    @State private var latest: RelayOTP?

    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("HTTPS relay URL", text: $serverURL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    SecureField("Private iphone.json (optional paste)", text: $pairingJSON)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Import private pairing file") { importing = true }
                    Button("Save settings") { saveSettings() }
                }
                Section("Codes") {
                    Button("Fetch latest OTP") {
                        status = "Fetching…"
                        RelayClient.fetch { result in
                            DispatchQueue.main.async { show(result) }
                        }
                    }
                    Toggle("Listen while app is open", isOn: $waiting)
                        .onChange(of: waiting) { _, enabled in enabled ? startWaiting() : stopWaiting() }
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        if let otp = latest, otp.expiresAt > context.date {
                            VStack(alignment: .leading, spacing: 12) {
                                Text(otp.code).font(.title.monospaced()).textSelection(.enabled)
                                Button("Mark this code used") {
                                    RelayClient.consume(otp)
                                    latest = nil
                                    status = "Consumption requested."
                                }
                            }
                        }
                    }
                    Text(status).font(.footnote)
                }
                Section("Privacy") {
                    Text("Only this device decrypts the code. The relay stores ciphertext for up to 90 seconds. AutoFill always requires a supported field and explicit selection.")
                        .font(.footnote)
                }
            }
            .navigationTitle("OTP Relay")
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json], allowsMultipleSelection: false) { result in
                do {
                    guard let url = try result.get().first else { return }
                    let accessed = url.startAccessingSecurityScopedResource()
                    defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                    let data = try Data(contentsOf: url)
                    guard data.count <= 4096, let json = String(data: data, encoding: .utf8) else { throw RelayPayloadError.invalidPairing }
                    pairingJSON = json
                    saveSettings()
                } catch { status = "Unable to import pairing file. Use your private iphone.json." }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { RelayClient.flushConsumption(); if waiting { startWaiting() } }
                else { stopWaiting() }
            }
            .onDisappear { stopWaiting() }
        }
    }

    private func saveSettings() {
        let normalized = serverURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URLComponents(string: normalized), url.scheme == "https", url.host != nil,
              url.path.isEmpty, url.query == nil, url.fragment == nil, url.user == nil, url.password == nil else {
            status = "Enter a valid HTTPS root URL."; return
        }
        do {
            let json = pairingJSON.isEmpty ? (RelayToken.read() ?? "") : pairingJSON
            _ = try RelayPairing.parse(json)
            try RelayToken.save(json)
            pairingJSON = ""
            serverURL = normalized
            RelayConfig.settings.set(normalized, forKey: "serverURL")
            latest = nil; lastSeenID = nil
            RelayClient.flushConsumption()
            status = "Saved. Enable OTP Relay in iOS AutoFill settings."
            if waiting { startWaiting() }
        } catch { status = "Unable to save pairing. Check the file and shared Keychain signing settings." }
    }
    private func show(_ result: Result<RelayOTP?, Error>) {
        switch result {
        case .success(let otp):
            latest = otp
            if let otp { lastSeenID = otp.id; status = "Exact code is ready until its expiry." }
            else { status = "No new unexpired code." }
        case .failure: status = "Unable to fetch code. Check pairing and connection."
        }
    }
    private func startWaiting() {
        stopWaiting()
        guard scenePhase == .active else { return }
        guard let json = RelayToken.read(), (try? RelayPairing.parse(json)) != nil else {
            waiting = false; status = "Import and save your iPhone pairing first."; return
        }
        let generation = UUID(); waitGeneration = generation
        waitForNext(generation)
    }
    private func stopWaiting() { waitGeneration = UUID(); waitTask?.cancel(); waitTask = nil }
    private func waitForNext(_ generation: UUID) {
        guard waiting, scenePhase == .active, generation == waitGeneration else { return }
        waitTask = RelayClient.fetch(waitSeconds: 25, afterID: lastSeenID) { result in
            DispatchQueue.main.async {
                guard waiting, scenePhase == .active, generation == waitGeneration else { return }
                var retry = 0.1
                switch result {
                case .success(let otp): if otp != nil { show(result) }
                case .failure: status = "Connection interrupted; retrying…"; retry = Double.random(in: 2...4)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + retry) { waitForNext(generation) }
            }
        }
    }
}
