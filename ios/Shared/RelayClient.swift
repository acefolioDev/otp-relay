import Foundation
import Security

// Public build settings must match the entitlements on both app and extension targets.
enum RelayConfig {
    static let appGroup = Bundle.main.object(forInfoDictionaryKey: "RelayAppGroup") as? String ?? "group.com.acefolio.otprelay"
    static let keychainGroup = Bundle.main.object(forInfoDictionaryKey: "RelayKeychainGroup") as? String ?? "com.acefolio.otprelay.shared"
    static let defaultServerURL = Bundle.main.object(forInfoDictionaryKey: "RelayBaseURL") as? String ?? "https://otp-relay-production-a3b3.up.railway.app"
    static var settings: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }
}

enum RelayToken {
    private static let account = "iphone-read-token"
    private static let service = "com.example.otprelay"
    private static var query: [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecAttrService as String: service
        ]
        // Only attach access group if valid non-local group exists
        if !RelayConfig.keychainGroup.isEmpty && !RelayConfig.keychainGroup.contains("LOCAL.") {
            q[kSecAttrAccessGroup as String] = RelayConfig.keychainGroup
        }
        return q
    }

    static func save(_ token: String) throws {
        let attributes: [String: Any] = [kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            attributes.forEach { add[$0.key] = $0.value }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    static func read() -> String? {
        var find = query
        find[kSecReturnData as String] = true
        find[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(find as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

private final class RelaySessionDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil) // Never forward a bearer credential to a redirect target.
    }
}

enum RelayClient {
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: RelaySessionDelegate(), delegateQueue: nil)
    }()
    private static func request(path: String, method: String = "GET") throws -> (URLRequest, RelayPairing) {
        let host = (RelayConfig.settings.string(forKey: "serverURL") ?? RelayConfig.defaultServerURL)
            .trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let components = URLComponents(string: host), components.scheme == "https",
              components.host != nil, components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil, components.path.isEmpty,
              let json = RelayToken.read(), let url = URL(string: host + path) else {
            throw RelayPayloadError.invalidPairing
        }
        let pairing = try RelayPairing.parse(json)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(pairing.token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 5
        return (request, pairing)
    }

    @discardableResult
    static func fetch(waitSeconds: Int = 0, afterID: String? = nil,
                      completion: @escaping (Result<RelayOTP?, Error>) -> Void) -> URLSessionDataTask? {
        do {
            guard (0...25).contains(waitSeconds), afterID == nil || UUID(uuidString: afterID!) != nil else { throw RelayPayloadError.invalidEnvelope }
            let suffix = waitSeconds > 0 ? "?waitSeconds=\(waitSeconds)" + (afterID.map { "&afterId=\($0)" } ?? "") : ""
            var (request, pairing) = try request(path: "/api/v1/otp/latest" + suffix)
            request.timeoutInterval = waitSeconds > 0 ? 30 : 5
            let task = session.dataTask(with: request) { data, response, error in
                if let error { completion(.failure(error)); return }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200, let data else {
                    completion(.failure(RelayPayloadError.invalidEnvelope)); return
                }
                do { completion(.success(try RelayOTP.decode(data, pairing: pairing))) }
                catch { completion(.failure(RelayPayloadError.invalidEnvelope)) }
            }
            task.resume()
            return task
        } catch { completion(.failure(RelayPayloadError.invalidPairing)); return nil }
    }

    private static let acknowledgementQueue = DispatchQueue(label: "com.acefolio.otprelay.acknowledgements")
    private static let pendingKey = "pendingConsumptionIDs"
    static func consume(_ otp: RelayOTP) {
        guard otp.expiresAt > Date(), UUID(uuidString: otp.id)?.uuidString.lowercased() == otp.id else { return }
        acknowledgementQueue.async {
            var pending = RelayConfig.settings.dictionary(forKey: pendingKey) as? [String: Double] ?? [:]
            pending[otp.id] = otp.expiresAt.timeIntervalSince1970
            RelayConfig.settings.set(pending, forKey: pendingKey)
            sendAcknowledgement(otp.id)
        }
    }
    // Contains only IDs/expiry, never codes. The foreground app retries interrupted extension acknowledgements.
    static func flushConsumption() {
        acknowledgementQueue.async {
            let pending = RelayConfig.settings.dictionary(forKey: pendingKey) as? [String: Double] ?? [:]
            let valid = pending.filter { $0.value > Date().timeIntervalSince1970 && UUID(uuidString: $0.key) != nil }
            RelayConfig.settings.set(valid, forKey: pendingKey)
            valid.keys.forEach { sendAcknowledgement($0) }
        }
    }
    private static func sendAcknowledgement(_ id: String) {
        guard let (request, _) = try? request(path: "/api/v1/otp/\(id)/consume", method: "POST") else { return }
        session.dataTask(with: request) { _, response, _ in
            guard let http = response as? HTTPURLResponse, [204, 404].contains(http.statusCode) else { return }
            acknowledgementQueue.async {
                var pending = RelayConfig.settings.dictionary(forKey: pendingKey) as? [String: Double] ?? [:]
                pending.removeValue(forKey: id)
                RelayConfig.settings.set(pending, forKey: pendingKey)
            }
        }.resume()
    }
}
