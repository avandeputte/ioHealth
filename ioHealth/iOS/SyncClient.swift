import Foundation
import Security

/// Talks to the server's HTTP API (see the README's API section): POST /v1/sessions, then numbered gzip-compressed
/// NDJSON batches to /v1/sessions/{id}/items, then /v1/sessions/{id}/finish. Each batch is committed on the server
/// before it answers, so whatever was acknowledged is safely stored.
enum SyncClient {
    struct Server {
        let baseURL: URL
        /// HTTP Basic: the account's user name and password, as for the web app (the server also takes an app
        /// password in its place).
        let authorization: String

        /// Accepts "https://health.example.com", "http://192.168.1.10:47800" or a bare "host[:port]" (taken as http,
        /// port 47800 if none is given, which only works on the local network).
        init?(address: String, user: String, password: String) {
            var text = address.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty, !user.isEmpty, !password.isEmpty else { return nil }
            if !text.contains("://") {
                text = "http://" + text
                if URL(string: text)?.port == nil { text += ":\(SyncProtocol.defaultPort)" }
            }
            while text.hasSuffix("/") { text.removeLast() }
            guard let url = URL(string: text), let scheme = url.scheme, ["http", "https"].contains(scheme), url.host != nil else { return nil }
            baseURL = url
            authorization = "Basic " + Data("\(user):\(password)".utf8).base64EncodedString()
        }
    }

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    /// One sync: buffers messages as NDJSON and uploads them in batches.
    final class Upload {
        private let server: Server
        private let sessionID: Int
        private var buffer = Data()
        private var lines = 0
        private var seq = 0
        private(set) var sent = 0
        private let maxLines = 5_000
        private let maxBytes = 4 << 20

        private init(server: Server, sessionID: Int) {
            self.server = server
            self.sessionID = sessionID
        }

        static func start(server: Server, hello: SyncMessage.Hello) async throws -> Upload {
            let body = try JSONSerialization.data(withJSONObject: ["deviceName": hello.deviceName, "systemVersion": hello.systemVersion,
                                                                   "fullResync": hello.fullResync])
            let reply = try await post(server, path: "v1/sessions", body: body, contentType: "application/json")
            guard let id = reply["sessionId"] as? Int else { throw SyncError.badReply }
            return Upload(server: server, sessionID: id)
        }

        func send(_ message: SyncMessage) async throws {
            buffer.append(try JSONEncoder.sync.encode(message))
            buffer.append(0x0A)
            lines += 1
            sent += 1
            if lines >= maxLines || buffer.count >= maxBytes { try await flush() }
        }

        /// Uploads whatever is buffered and returns once the server has committed it.
        func flush() async throws {
            guard lines > 0 else { return }
            seq += 1
            _ = try await post(server, path: "v1/sessions/\(sessionID)/items", body: Gzip.compress(buffer),
                               contentType: "application/x-ndjson", headers: ["Content-Encoding": "gzip", "X-Batch-Seq": "\(seq)"])
            buffer.removeAll(keepingCapacity: true)
            lines = 0
        }

        /// Closes the sync; returns the number of rows the server now holds.
        func finish(totalSent: Int) async throws -> Int {
            try await flush()
            let reply = try await post(server, path: "v1/sessions/\(sessionID)/finish",
                                       body: try JSONSerialization.data(withJSONObject: ["totalSent": totalSent]), contentType: "application/json")
            return reply["received"] as? Int ?? 0
        }
    }

    /// GET /v1/health, for the "Test connection" button; returns the server's schema version.
    static func check(_ server: Server) async throws -> Int {
        var request = URLRequest(url: server.baseURL.appending(path: "v1/health"))
        request.timeoutInterval = 10
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw SyncError.badReply }
        return json["schemaVersion"] as? Int ?? 0
    }

    /// POSTs with up to three retries (1, 2, 4 s apart) on network errors and 5xx; a 4xx is reported straight away.
    private static func post(_ server: Server, path: String, body: Data, contentType: String,
                             headers: [String: String] = [:]) async throws -> [String: Any] {
        var request = URLRequest(url: server.baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue(server.authorization, forHTTPHeaderField: "Authorization")
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }

        var attempt = 0
        while true {
            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw SyncError.badReply }
                let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
                switch http.statusCode {
                case 200..<300: return json
                case 401: throw SyncError.unauthorized
                case 400..<500: throw SyncError.server(http.statusCode, json["error"] as? String ?? "")
                default: throw SyncError.retryable(http.statusCode, json["error"] as? String ?? "")
                }
            } catch let error as SyncError {
                guard case .retryable = error, attempt < 3 else { throw error }
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                guard attempt < 3 else { throw error }
            }
            try await Task.sleep(for: .seconds(1 << attempt))
            attempt += 1
        }
    }
}

enum SyncError: LocalizedError {
    case badReply
    case unauthorized
    case server(Int, String)
    case retryable(Int, String)
    case outOfTime
    var errorDescription: String? {
        switch self {
        case .badReply: return "The server sent an unexpected reply. Is the address right?"
        case .unauthorized: return "The server rejected the user name or password. They are the same as for the web app; an account without a password cannot sync."
        case .server(let code, let message), .retryable(let code, let message):
            return "The server answered \(code)\(message.isEmpty ? "" : ": \(message)")."
        case .outOfTime: return "iOS ended the background window before the sync finished."
        }
    }
}

/// gzip framing (RFC 1952) around the raw DEFLATE that Foundation's zlib compression produces.
enum Gzip {
    static func compress(_ data: Data) throws -> Data {
        let deflated = try (data as NSData).compressed(using: .zlib) as Data
        var out = Data([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff])
        out.append(deflated)
        var crc = crc32(data).littleEndian, size = UInt32(truncatingIfNeeded: data.count).littleEndian
        withUnsafeBytes(of: &crc) { out.append(contentsOf: $0) }
        withUnsafeBytes(of: &size) { out.append(contentsOf: $0) }
        return out
    }

    private static let table: [UInt32] = (0..<256).map { n in
        var c = UInt32(n)
        for _ in 0..<8 { c = c & 1 != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func crc32(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            for b in bytes { c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        }
        return c ^ 0xFFFF_FFFF
    }
}

/// The account password lives in the Keychain, readable after first unlock so background syncs can use it.
enum CredentialStore {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                               kSecAttrService as String: "HealthSync", // the old app name; kept so the entry survives updates
                                               kSecAttrAccount as String: "password"]

    static var password: String {
        get {
            var q = query
            q[kSecReturnData as String] = true
            var out: AnyObject?
            guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return "" }
            return String(decoding: data, as: UTF8.self)
        }
        set {
            SecItemDelete(query as CFDictionary)
            guard !newValue.isEmpty else { return }
            var q = query
            q[kSecValueData as String] = Data(newValue.utf8)
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(q as CFDictionary, nil)
        }
    }
}
