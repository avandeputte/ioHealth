import Foundation
import BackgroundTasks
import HealthKit
import UIKit

/// Everything that lets the app sync without being tapped:
/// 1. HealthKit background delivery: iOS wakes the app when new samples arrive (hourly at most for most types).
/// 2. BGAppRefreshTask: an occasional catch-up slot that iOS grants at its discretion.
/// Both must be re-registered on every launch, which `AppDelegate` does.
enum BackgroundSync {
    static let refreshTaskID = "com.avandeputte.healthsync.refresh" // follows the bundle ID, kept from the old name
    private static var observers: [HKObserverQuery] = []

    static func registerRefreshTask() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshTaskID, using: nil) { task in
            handleRefresh(task as! BGAppRefreshTask)
        }
    }

    static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskID)
        request.earliestBeginDate = Date().addingTimeInterval(60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    private static func handleRefresh(_ task: BGAppRefreshTask) {
        let work = Task { @MainActor in
            await SyncEngine.shared.backgroundSync(trigger: .backgroundRefresh)
            task.setTaskCompleted(success: true)
        }
        task.expirationHandler = { work.cancel(); task.setTaskCompleted(success: false) }
        scheduleRefresh()
    }

    /// Turns on background delivery and an observer for every sample type that's switched on. Safe to call repeatedly.
    static func start(store: HKHealthStore) {
        guard observers.isEmpty, HKHealthStore.isHealthDataAvailable() else { return }
        let off = TypeSelection.disabled
        // Routes arrive with their workout, so the workout observer covers them.
        for type in HealthTypes.readTypes.compactMap({ $0 as? HKSampleType })
        where !off.contains(type.identifier) && type.identifier != TypeSelection.workoutRoutes {
            // Workouts and sleep are rare and interesting; everything else is fine at Apple's hourly cadence.
            let frequency: HKUpdateFrequency = (type is HKWorkoutType || type.identifier.hasSuffix("SleepAnalysis")) ? .immediate : .hourly
            store.enableBackgroundDelivery(for: type, frequency: frequency) { _, _ in }
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, _ in
                // iOS gives us a short window here; backgroundSync keeps inside it and coalesces the burst of
                // callbacks that arrive together (one per type) into a single sync.
                Task { @MainActor in
                    await SyncEngine.shared.backgroundSync(trigger: .healthKit)
                    completion()
                }
            }
            store.execute(query)
            observers.append(query)
        }
    }

    /// Re-installs the observers after the selection of data types changed.
    static func restart(store: HKHealthStore) {
        stop(store: store)
        start(store: store)
    }

    static func stop(store: HKHealthStore) {
        observers.forEach(store.stop)
        observers.removeAll()
        store.disableAllBackgroundDelivery { _, _ in }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        BackgroundSync.registerRefreshTask()
        BackgroundSync.scheduleRefresh()
        Task { @MainActor in
            let engine = SyncEngine.shared
            if engine.authorized && engine.autoSync { BackgroundSync.start(store: engine.reader.store) }
        }
        return true
    }
}
