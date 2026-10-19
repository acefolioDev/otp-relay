import XCTest
@testable import OTPRelay

final class RelayClientIntegrationTests: XCTestCase {
    func testLiveSharedClientAndKeychain() async throws {
        let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("relay-private-test.json")
        guard FileManager.default.fileExists(atPath: file.path) else { throw XCTSkip("Optional live test requires private local provisioning") }
        defer { try? FileManager.default.removeItem(at: file) }
        let json = try String(contentsOf: file, encoding: .utf8)
        _ = try RelayPairing.parse(json)
        try RelayToken.save(json)
        RelayConfig.settings.set(RelayConfig.defaultServerURL, forKey: "serverURL")
        let otp: RelayOTP? = try await withCheckedThrowingContinuation { continuation in
            RelayClient.fetch { continuation.resume(with: $0) }
        }
        XCTAssertTrue(otp?.code == "Ab7Cd9Ef2G", "Exact-case synthetic decryption failed")
        guard let otp else { return }
        RelayClient.consume(otp)
        var cleared = false
        for _ in 0..<20 {
            try await Task.sleep(for: .milliseconds(150))
            let current: RelayOTP? = try await withCheckedThrowingContinuation { continuation in
                RelayClient.fetch { continuation.resume(with: $0) }
            }
            if current == nil { cleared = true; break }
        }
        XCTAssertTrue(cleared, "Consumption acknowledgement did not clear the synthetic code")
    }
}
