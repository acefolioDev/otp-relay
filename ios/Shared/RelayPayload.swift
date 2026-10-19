import Foundation
import CryptoKit

// Shared by app and extension. Contains no UI, Keychain access or logging.
struct RelayPairing: Decodable {
    let role: String
    let pairId: String
    let token: String
    let keyId: String
    let encryptionKey: String

    static func parse(_ json: String) throws -> RelayPairing {
        let value = try JSONDecoder().decode(RelayPairing.self, from: Data(json.utf8))
        guard value.role == "iphone", UUID(uuidString: value.pairId)?.uuidString.lowercased() == value.pairId,
              value.token.range(of: "^[A-Za-z0-9_-]{43,128}$", options: .regularExpression) != nil,
              value.keyId.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil,
              base64url(value.encryptionKey)?.count == 32 else { throw RelayPayloadError.invalidPairing }
        return value
    }
}

enum RelayPayloadError: Error { case invalidPairing, invalidEnvelope }
func base64url(_ value: String) -> Data? {
    let b64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    return Data(base64Encoded: b64 + String(repeating: "=", count: (4 - b64.count % 4) % 4))
}

struct RelayOTP {
    let id: String
    let code: String
    let expiresAt: Date

    static func decode(_ data: Data, pairing: RelayPairing, now: Date = Date()) throws -> RelayOTP? {
        struct Envelope: Decodable {
            struct Encrypted: Decodable { let algorithm: String; let keyId: String; let nonce: String; let ciphertext: String; let tag: String }
            let id: String; let receivedAt: String; let expiresAt: String; let encrypted: Encrypted
        }
        struct Response: Decodable { let available: Bool; let otp: Envelope? }
        let response = try JSONDecoder().decode(Response.self, from: data)
        guard response.available else { return nil }
        guard let item = response.otp, UUID(uuidString: item.id)?.uuidString.lowercased() == item.id,
              item.encrypted.algorithm == "A256GCM", item.encrypted.keyId == pairing.keyId,
              let key = base64url(pairing.encryptionKey), key.count == 32,
              let nonce = base64url(item.encrypted.nonce), nonce.count == 12,
              let ciphertext = base64url(item.encrypted.ciphertext), (4...32).contains(ciphertext.count),
              let tag = base64url(item.encrypted.tag), tag.count == 16 else { throw RelayPayloadError.invalidEnvelope }
        let dates = ISO8601DateFormatter()
        dates.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let serverExpires = dates.date(from: item.expiresAt), let received = dates.date(from: item.receivedAt) else { throw RelayPayloadError.invalidEnvelope }
        let expires = min(serverExpires, received.addingTimeInterval(90))
        guard expires > now, received.timeIntervalSince(now) <= 10 else { return nil }
        // Exact wire format used by Android and the reference encryptor. All interpolated fields validated.
        let aad = "[\"otp-relay/v1\",\"\(pairing.pairId)\",\"\(item.id)\",\"android\",\"\(item.receivedAt)\",\"\(item.encrypted.keyId)\"]"
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: ciphertext, tag: tag)
        let clear = try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: Data(aad.utf8))
        guard let code = String(data: clear, encoding: .utf8), (4...32).contains(code.utf8.count),
              code.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) }) else { throw RelayPayloadError.invalidEnvelope }
        // Never parse as an integer, normalize case, or trim the decrypted code.
        return RelayOTP(id: item.id, code: code, expiresAt: expires)
    }
}
