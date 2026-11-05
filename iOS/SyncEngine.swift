import Foundation
import UIKit

/// The one place a sync runs from, whether the user tapped Sync now, the app was opened, HealthKit woke us in
/// the background, or iOS granted a background refresh. Only one sync runs at a time.
@MainActor
final class SyncEngine: ObservableObject {
    static let shared = SyncEngine()

    enum State: Equatable { case idle, authorizing, syncing, done(Int), paused(Int), failed(String) }
    enum Trigger: String { case manual, launch, healthKit, backgroundRefresh }

    @Published var state: State = .idle
    @Published var currentType = ""
    @Published var sentCount = 0
    @Published var fullResync = false
    @Published private(set) var isRunning = false
    @Published var authorized = UserDefaults.standard.bool(forKey: "authorized")
    @Published var autoSync = UserDefaults.standard.object(forKey: "autoSync") as? Bool ?? true {
        didSet { UserDefaults.standard.set(autoSync, forKey: "autoSync") }
    }
    /// The server's base URL, e.g. https://health.example.com or http://192.168.1.10:47800.
    @Published var serverAddress: String = UserDefaults.standard.string(forKey: "serverAddress") ?? "" {
        didSet { UserDefaults.standard.set(serverAddress, forKey: "serverAddress") }
    }
    /// The account: the same user name and password as in the web app (and ioPix, ioNotes, ioContacts). The
    /// password is kept in the Keychain, not UserDefaults.
    @Published var userName: String = UserDefaults.standard.string(forKey: "userName") ?? "" {
        didSet { UserDefaults.standard.set(userName, forKey: "userName") }
    }
    @Published var password: String = CredentialStore.password {
        didSet { CredentialStore.password = password }
    }
    @Published private(set) var lastSynced: Date? = UserDefaults.standard.object(forKey: "lastSynced") as? Date
    @Published private(set) var lastTrigger: Trigger? = UserDefaults.standard.string(forKey: "lastTrigger").flatMap(Trigger.init)
    @Published private(set) var lastBackgroundAttempt: Date?

    let reader = HealthReader()

    func authorize() async {
        state = .authorizing
        do {
            try await reader.requestAuthorization()
            authorized = true
            UserDefaults.standard.set(true, forKey: "authorized")
            state = .idle
            BackgroundSync.start(store: reader.store)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    var server: SyncClient.Server? {
        SyncClient.Server(address: serverAddress, user: userName.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
    }

    /// Whether a sync has somewhere to go.
    var hasTarget: Bool { server != nil }

    func syncNow(trigger: Trigger, deadline: Date?) async {
        guard let server else { return }
        await run(server: server, trigger: trigger, deadline: deadline)
    }

    /// Called from HealthKit observer wakes and background refresh. Coalesces the burst of observer callbacks
    /// that arrive together, and keeps inside the ~30 s iOS gives a background wake.
    func backgroundSync(trigger: Trigger) async {
        guard autoSync, authorized, hasTarget, !isRunning else { return }
        if let last = lastBackgroundAttempt, Date().timeIntervalSince(last) < 10 * 60 { return }
        lastBackgroundAttempt = Date()
        // iOS calls the expiration handler on the main thread.
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "ioHealth") { [weak self] in
            MainActor.assumeIsolated { self?.endBackgroundTask() }
        }
        await syncNow(trigger: trigger, deadline: Date().addingTimeInterval(22))
        endBackgroundTask()
    }

    private var backgroundTask = UIBackgroundTaskIdentifier.invalid

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    private func run(server: SyncClient.Server, trigger: Trigger, deadline: Date?) async {
        guard !isRunning else { return }
        isRunning = true
        defer { isRunning = false }
        state = .syncing
        sentCount = 0
        currentType = ""
        reader.fullResync = fullResync
        let foreground = trigger == .manual || trigger == .launch
        if foreground { UIApplication.shared.isIdleTimerDisabled = true }
        defer { if foreground { UIApplication.shared.isIdleTimerDisabled = false } }

        do {
            let upload = try await SyncClient.Upload.start(server: server, hello: .init(
                protocolVersion: SyncProtocol.version, deviceName: UIDevice.current.name,
                systemVersion: UIDevice.current.systemVersion, fullResync: fullResync))
            reader.checkpoint = { try await upload.flush() }
            defer { reader.checkpoint = {} }
            var ranOutOfTime = false
            do {
                try await reader.readAll(progress: { [weak self] label in
                    Task { @MainActor in self?.currentType = label }
                }, emit: { [weak self] message in
                    if let deadline, Date() > deadline { throw SyncError.outOfTime }
                    // The server ignores per-type markers, and each would otherwise cost an upload at the next checkpoint.
                    if case .typeDone = message { return }
                    try await upload.send(message)
                    if upload.sent % 2_000 == 0 { let n = upload.sent; await MainActor.run { self?.sentCount = n } }
                })
            } catch SyncError.outOfTime {
                // Anchors only moved for batches the server committed, so the next run picks up from there.
                ranOutOfTime = true
            }
            let n = upload.sent
            _ = try await upload.finish(totalSent: n)
            sentCount = n
            fullResync = false
            remember(trigger: trigger)
            state = ranOutOfTime ? .paused(n) : .done(n)
        } catch {
            state = .failed(error.localizedDescription)
        }
        BackgroundSync.scheduleRefresh()
    }

    private func remember(trigger: Trigger) {
        lastSynced = Date()
        lastTrigger = trigger
        UserDefaults.standard.set(lastSynced, forKey: "lastSynced")
        UserDefaults.standard.set(trigger.rawValue, forKey: "lastTrigger")
    }
}
