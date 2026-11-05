import Foundation
import AppKit
import Combine
import ServiceManagement

@MainActor
final class ReceiverModel: ObservableObject {
    enum Status: Equatable {
        case needsDatabase
        case waiting(port: UInt16)
        case receiving(peer: String)
        case finished
        case failed(String)
    }

    @Published var status: Status = .needsDatabase
    @Published var received = 0
    @Published var currentType = ""
    @Published var summary = ""
    @Published var databaseURL: URL? {
        didSet { UserDefaults.standard.set(databaseURL?.path, forKey: "databasePath") }
    }
    @Published var writeCSVAfterSync = false
    @Published var lastSync = ""
    /// What to type into the iPhone app's address field. Refreshed each time the listener comes up.
    @Published var addresses: [String] = []
    @Published var launchAtLogin = SMAppService.mainApp.status == .enabled {
        didSet {
            do {
                if launchAtLogin { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            } catch {
                status = .failed("Couldn't change Open at Login: \(error.localizedDescription)")
                launchAtLogin = SMAppService.mainApp.status == .enabled
            }
        }
    }

    private var database: SyncDatabase?
    private var server: SyncServer?
    /// Every use of `database` after it's opened goes through this queue: the SQLite wrapper is single-threaded.
    private let dbQueue = DispatchQueue(label: "ioHealth.db")

    init() {
        if let path = UserDefaults.standard.string(forKey: "databasePath") {
            open(URL(fileURLWithPath: path))
        }
    }

    func chooseDatabase() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "health.sqlite"
        panel.canCreateDirectories = true
        panel.message = "Choose where to keep your Health database. Pick an existing one to keep adding to it."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        open(url)
    }

    func openExistingDatabase() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        open(url)
    }

    private func open(_ url: URL) {
        server?.stop()
        do {
            let database = try SyncDatabase(url: url)
            self.database = database
            databaseURL = url
            summary = database.summary()
            lastSync = database.lastSyncDescription()
            startServer(database)
        } catch {
            // A stale or unwritable path from a previous run shouldn't keep the app stuck on launch.
            if databaseURL == url { databaseURL = nil }
            status = .failed("Couldn't open \(url.lastPathComponent): \(error.localizedDescription) Click New… to pick another location.")
        }
    }

    private func startServer(_ database: SyncDatabase) {
        let server = SyncServer(queue: dbQueue, onMessage: { [weak self] message in
            // Runs on dbQueue, which the server also uses for its network callbacks.
            try database.apply(message)
            switch message {
            case .typeDone(let type, _, _):
                let name = type.replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "").replacingOccurrences(of: "HKCategoryTypeIdentifier", with: "")
                Task { @MainActor in self?.currentType = name; self?.received = database.appliedThisSession }
            case .done:
                let n = database.appliedThisSession, summary = database.summary(), last = database.lastSyncDescription()
                Task { @MainActor in self?.finished(received: n, summary: summary, lastSync: last) }
            default:
                if database.appliedThisSession % 5_000 == 0 {
                    let n = database.appliedThisSession
                    Task { @MainActor in self?.received = n }
                }
            }
        }, onEvent: { [weak self] event in
            switch event {
            case .disconnected, .failed: try? database.commit()
            default: break
            }
            Task { @MainActor in self?.handle(event) }
        })
        server.countForAck = { database.totalRows() }
        do {
            try server.start(serviceName: Host.current().localizedName ?? "Mac")
            self.server = server
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    private func handle(_ event: SyncServer.Event) {
        switch event {
        case .listening(let port):
            status = .waiting(port: port)
            addresses = LocalAddresses.all().map { "\($0):\(port)" }
        case .connected(let peer): status = .receiving(peer: peer); received = 0; currentType = ""
        case .disconnected:
            if case .receiving = status { status = .failed("The iPhone disconnected before finishing. Data received so far was saved; run the sync again.") }
        case .failed(let e):
            status = .failed(e.localizedDescription)
        }
    }

    private func finished(received: Int, summary: String, lastSync: String) {
        self.received = received
        self.summary = summary
        self.lastSync = lastSync
        status = .finished
        if writeCSVAfterSync { exportCSV() }
    }

    func exportCSV() {
        guard let database, let url = databaseURL else { return }
        let dir = url.deletingPathExtension().appendingPathExtension("csv")
        dbQueue.async { [weak self] in
            do {
                try SyncCSVExporter(db: database.db).export(to: dir)
                Task { @MainActor in NSWorkspace.shared.activateFileViewerSelecting([dir]) }
            } catch {
                Task { @MainActor in self?.status = .failed(error.localizedDescription) }
            }
        }
    }

    func revealDatabase() {
        if let url = databaseURL { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }
}

/// The Mac's reachable names and IPv4 addresses, hostname first since it survives DHCP changes.
enum LocalAddresses {
    static func all() -> [String] {
        var out: [String] = []
        let host = ProcessInfo.processInfo.hostName
        if host.hasSuffix(".local") { out.append(host) }
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return out }
        defer { freeifaddrs(ifaddr) }
        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let ifa = ptr.pointee
            guard ifa.ifa_addr.pointee.sa_family == UInt8(AF_INET), (ifa.ifa_flags & UInt32(IFF_LOOPBACK)) == 0 else { continue }
            let name = String(cString: ifa.ifa_name)
            guard name.hasPrefix("en") || name.hasPrefix("bridge") else { continue }
            var buf = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(ifa.ifa_addr, socklen_t(ifa.ifa_addr.pointee.sa_len), &buf, socklen_t(buf.count), nil, 0, NI_NUMERICHOST) == 0 {
                out.append(String(cString: buf))
            }
        }
        return out
    }
}
