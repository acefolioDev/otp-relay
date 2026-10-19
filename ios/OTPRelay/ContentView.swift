import SwiftUI

struct ContentView: View {
    @State private var serverURL: String = RelayConfig.settings.string(forKey: "serverURL") ?? ""
    @State private var pairingJSON = ""
    @State private var status = "Set the HTTPS URL and paste private iphone.json pairing data."

    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("https://your-relay.example", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("Private iphone.json pairing data", text: $pairingJSON)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Save settings") {
                        guard serverURL.hasPrefix("https://") else {
                            status = "A valid HTTPS URL is required."
                            return
                        }
                        do {
                            let json = pairingJSON.isEmpty ? (RelayToken.read() ?? "") : pairingJSON
                            _ = try RelayPairing.parse(json)
                            try RelayToken.save(json)
                            pairingJSON = ""
                            RelayConfig.settings.set(serverURL, forKey: "serverURL")
                            status = "Saved. Enable OTP Relay in Settings > General > AutoFill & Passwords."
                        } catch { status = "Keychain error: \(error.localizedDescription). Check signing and Keychain Sharing." }
                    }
                }
                Section("Test") {
                    Button("Fetch latest OTP") {
                        status = "Fetching…"
                        RelayClient.fetch { result in
                            DispatchQueue.main.async {
                                switch result {
                                case .success(let code): status = code.map { "Latest code: \($0.code)" } ?? "No unexpired code."
                                case .failure(let error): status = "Error: \(error.localizedDescription)"
                                }
                            }
                        }
                    }
                    Text(status)
                        .font(.footnote)
                        .textSelection(.enabled)
                }
                Section("Privacy") {
                    Text("The relay stores encrypted codes for up to 90 seconds. This device decrypts them locally when requested. It does not use iCloud or read iPhone SMS.")
                        .font(.footnote)
                }
            }
            .navigationTitle("OTP Relay")
        }
    }
}
