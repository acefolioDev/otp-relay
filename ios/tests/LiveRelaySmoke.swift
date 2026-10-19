import Foundation

// Executes locally with the actual shared iOS decoder; never prints a code or credential.
@main struct LiveRelaySmoke {
    static func main() async throws {
        let base = ProcessInfo.processInfo.environment["RELAY_BASE_URL"] ?? "https://otp-relay-production-a3b3.up.railway.app"
        guard base.hasPrefix("https://") else { throw RelayPayloadError.invalidPairing }
        let json = try String(contentsOfFile: "provisioning/iphone.json", encoding: .utf8)
        let pairing = try RelayPairing.parse(json)
        var request = URLRequest(url: URL(string: base + "/api/v1/otp/latest")!)
        request.setValue("Bearer \(pairing.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 8
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let otp = try RelayOTP.decode(data, pairing: pairing), otp.code == "Ab7Cd9Ef2G" else { throw RelayPayloadError.invalidEnvelope }
        var consume = URLRequest(url: URL(string: base + "/api/v1/otp/\(otp.id)/consume")!)
        consume.httpMethod = "POST"
        consume.setValue("Bearer \(pairing.token)", forHTTPHeaderField: "Authorization")
        let (_, acknowledged) = try await session.data(for: consume)
        guard (acknowledged as? HTTPURLResponse)?.statusCode == 204 else { throw RelayPayloadError.invalidEnvelope }
        print("Native Swift HTTPS fetch, exact-case decryption and consumption passed.")
    }
}
