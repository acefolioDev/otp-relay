import Foundation
import Security

// IMPORTANT: Change BOTH values to match your signing team and Xcode capabilities.
enum RelayConfig {
    static let appGroup = "group.com.example.otprelay"
    static let keychainGroup = "YOUR_TEAM_ID.com.example.otprelay.shared"
    static var settings: UserDefaults { UserDefaults(suiteName: appGroup)! }
}

enum RelayToken {
    private static let account = "iphone-read-token"
    private static let service = "com.example.otprelay"
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrAccount as String: account,
         kSecAttrService as String: service,
         kSecAttrAccessGroup as String: RelayConfig.keychainGroup]
    }

    static func save(_ token: String) throws {
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = Data(token.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
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
        let host = (RelayConfig.settings.string(forKey: "serverURL") ?? "")
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

    static func fetch(completion: @escaping (Result<RelayOTP?, Error>) -> Void) {
        do {
            let (request, pairing) = try request(path: "/api/v1/otp/latest")
            session.dataTask(with: request) { data, response, error in
                if let error { completion(.failure(error)); return }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200, let data else {
                    completion(.failure(RelayPayloadError.invalidEnvelope)); return
                }
                do { completion(.success(try RelayOTP.decode(data, pairing: pairing))) }
                catch { completion(.failure(RelayPayloadError.invalidEnvelope)) }
            }.resume()
        } catch { completion(.failure(RelayPayloadError.invalidPairing)) }
    }

    // Best-effort acknowledgement after AutoFill selection; app-extension execution may be terminated.
    static func consume(_ otp: RelayOTP) {
        guard UUID(uuidString: otp.id)?.uuidString.lowercased() == otp.id,
              let (request, _) = try? request(path: "/api/v1/otp/\(otp.id)/consume", method: "POST") else { return }
        session.dataTask(with: request) { _, _, _ in }.resume()
    }
}
