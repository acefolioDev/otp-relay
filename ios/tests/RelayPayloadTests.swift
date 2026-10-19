import Foundation
import CryptoKit

@main struct RelayPayloadTests {
    static func main() throws {
        let key = SymmetricKey(size: .bits256)
        func b64(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
        let pairId = UUID().uuidString.lowercased()
        let json = try JSONSerialization.data(withJSONObject: ["role": "iphone", "pairId": pairId, "token": String(repeating: "a", count: 43), "keyId": "test", "encryptionKey": key.withUnsafeBytes { b64(Data($0)) }])
        let pairing = try RelayPairing.parse(String(decoding: json, as: UTF8.self))
        let now = Date()
        let dates = ISO8601DateFormatter(); dates.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var count = 0
        for code in ["Ab7Cd9Ef2G", "aB7cD9eF2g", "001234", "123456", String(repeating: "Z", count: 32)] {
            let id = UUID().uuidString.lowercased(), receivedAt = dates.string(from: now)
            let aad = "[\"otp-relay/v1\",\"\(pairId)\",\"\(id)\",\"android\",\"\(receivedAt)\",\"test\"]"
            let sealed = try AES.GCM.seal(Data(code.utf8), using: key, authenticating: Data(aad.utf8))
            var item: [String: Any] = ["id": id, "receivedAt": receivedAt, "expiresAt": dates.string(from: now.addingTimeInterval(90)), "encrypted": ["algorithm": "A256GCM", "keyId": "test", "nonce": sealed.nonce.withUnsafeBytes { b64(Data($0)) }, "ciphertext": b64(sealed.ciphertext), "tag": b64(sealed.tag)]]
            func response(_ item: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: ["available": true, "otp": item]) }
            let decoded = try RelayOTP.decode(response(item), pairing: pairing, now: now)
            precondition(decoded?.code == code); count += 1
            let expired = try RelayOTP.decode(response(item), pairing: pairing, now: now.addingTimeInterval(91))
            precondition(expired == nil); count += 1
            item["id"] = UUID().uuidString.lowercased()
            do { _ = try RelayOTP.decode(response(item), pairing: pairing, now: now); fatalError("Tampered AAD accepted") } catch { count += 1 }
        }
        let empty = try RelayOTP.decode(Data("{\"available\":false}".utf8), pairing: pairing)
        precondition(empty == nil); count += 1
        // Node-generated public vector verifies actual cross-language AAD and ciphertext compatibility.
        let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "tests/fixtures/encryption-vector.json"))) as! [String: Any]
        let fixturePairing = try RelayPairing.parse(String(decoding: JSONSerialization.data(withJSONObject: fixture["pairing"]!), as: UTF8.self))
        let fixtureData = try JSONSerialization.data(withJSONObject: fixture["response"]!)
        let fixtureCode = try RelayOTP.decode(fixtureData, pairing: fixturePairing, now: dates.date(from: "2026-10-19T12:00:01.000Z")!)
        precondition(fixtureCode?.code == fixture["code"] as? String); count += 1
        print("Passed \(count) synthetic iOS payload tests (including Node interoperability; no OTP values logged).")
    }
}
