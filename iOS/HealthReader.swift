import Foundation
import HealthKit
import CoreLocation

/// Reads everything out of HealthKit and hands each item to `emit`. Uses anchored queries so a second
/// run only sends what changed since the last one; anchors live in UserDefaults.
final class HealthReader {
    let store = HKHealthStore()
    private let defaults = UserDefaults.standard
    private let batchSize = 5_000

    var fullResync = false
    /// Called before any anchor is saved; the sync engine uploads everything emitted so far and returns once the
    /// server has committed it, so an anchor never moves past data the server doesn't have.
    var checkpoint: () async throws -> Void = {}

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw ReaderError.noHealthKit }
        try await store.requestAuthorization(toShare: [], read: HealthTypes.readTypes)
    }

    func clearAnchors() {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("anchor.") {
            defaults.removeObject(forKey: key)
        }
        // Beat-to-beat data is tracked by date rather than an anchor; without this a full resync skips it.
        defaults.removeObject(forKey: "heartbeats.since")
        defaults.removeObject(forKey: activitySinceKey)
    }

    // MARK: - Driving the read

    /// `progress` gets a human readable label; `emit` gets each message, and may suspend to apply backpressure.
    func readAll(progress: @escaping (String) -> Void, emit: @escaping (SyncMessage) async throws -> Void) async throws {
        if fullResync { clearAnchors() }
        // Types switched off in "Data types" are skipped entirely; their anchors stay where they were.
        let off = TypeSelection.disabled

        if !off.contains(TypeSelection.characteristics) { try await emitCharacteristics(emit) }

        let quantityTypes = HealthTypes.quantityTypes.filter { !off.contains($0.identifier) }
        let preferred = (try? await store.preferredUnits(for: Set(quantityTypes))) ?? [:]
        for type in quantityTypes {
            progress(TypeSelection.name(type.identifier))
            try await syncSamples(of: type, emit: emit) { sample in
                guard let q = sample as? HKQuantitySample else { return nil }
                let unit = HealthTypes.unit(for: type, preferred: preferred, sample: q)
                var s = self.baseSample(q, kind: "quantity")
                s.value = q.quantity.doubleValue(for: unit)
                s.unit = unit.unitString
                s.count = q.count
                return s
            }
        }

        for type in HealthTypes.categoryTypes where !off.contains(type.identifier) {
            progress(TypeSelection.name(type.identifier))
            try await syncSamples(of: type, emit: emit) { sample in
                guard let c = sample as? HKCategorySample else { return nil }
                var s = self.baseSample(c, kind: "category")
                s.value = Double(c.value)
                s.text = CategoryValueNames.name(for: type.identifier, value: c.value)
                return s
            }
        }

        if !off.contains(TypeSelection.audiograms) {
            progress("Audiograms")
            try await syncSamples(of: HKObjectType.audiogramSampleType(), emit: emit) { sample in
                guard let a = sample as? HKAudiogramSample else { return nil }
                var s = self.baseSample(a, kind: "audiogram")
                s.text = self.json(a.sensitivityPoints.map { p in
                    [
                        "frequencyHz": p.frequency.doubleValue(for: .hertz()),
                        "leftDbHL": p.leftEarSensitivity?.doubleValue(for: .decibelHearingLevel()) as Any,
                        "rightDbHL": p.rightEarSensitivity?.doubleValue(for: .decibelHearingLevel()) as Any,
                    ]
                })
                return s
            }
        }

        if !off.contains(TypeSelection.workouts) {
            progress("Workouts")
            try await syncWorkouts(emit, routes: !off.contains(TypeSelection.workoutRoutes))
        }

        if !off.contains(TypeSelection.heartbeatSeries) {
            progress("Heartbeat series")
            try await syncHeartbeatSeries(emit)
        }

        if !off.contains(TypeSelection.activityRings) {
            progress("Activity rings")
            try await emitActivitySummaries(emit)
        }
    }

    // MARK: - Characteristics

    private func emitCharacteristics(_ emit: (SyncMessage) async throws -> Void) async throws {
        if let dob = try? store.dateOfBirthComponents(), let d = Calendar.current.date(from: dob) {
            try await emit(.characteristic(key: "dateOfBirth", value: ISO8601DateFormatter().string(from: d)))
        }
        if let s = try? store.biologicalSex() { try await emit(.characteristic(key: "biologicalSex", value: "\(s.biologicalSex.rawValue)")) }
        if let b = try? store.bloodType() { try await emit(.characteristic(key: "bloodType", value: "\(b.bloodType.rawValue)")) }
        if let f = try? store.fitzpatrickSkinType() { try await emit(.characteristic(key: "fitzpatrickSkinType", value: "\(f.skinType.rawValue)")) }
        if let w = try? store.wheelchairUse() { try await emit(.characteristic(key: "wheelchairUse", value: "\(w.wheelchairUse.rawValue)")) }
        if let m = try? store.activityMoveMode() { try await emit(.characteristic(key: "activityMoveMode", value: "\(m.activityMoveMode.rawValue)")) }
    }

    // MARK: - Generic anchored sample sync

    private func syncSamples(of type: HKSampleType,
                             emit: (SyncMessage) async throws -> Void,
                             convert: (HKSample) -> SyncMessage.Sample?) async throws {
        var anchor = loadAnchor(type.identifier)
        var added = 0, deleted = 0
        while true {
            let descriptor = HKAnchoredObjectQueryDescriptor(predicates: [.sample(type: type)], anchor: anchor, limit: batchSize)
            let result = try await descriptor.result(for: store)
            for s in result.addedSamples {
                if let msg = convert(s) { try await emit(.sample(msg)); added += 1 }
            }
            for d in result.deletedObjects {
                try await emit(.deleted(uuid: d.uuid.uuidString, type: HealthTypes.storageName(type.identifier))); deleted += 1
            }
            anchor = result.newAnchor
            try await checkpoint()
            saveAnchor(anchor, type.identifier)
            if result.addedSamples.isEmpty && result.deletedObjects.isEmpty { break }
        }
        try await emit(.typeDone(type: HealthTypes.storageName(type.identifier), added: added, deleted: deleted))
    }

    // MARK: - Workouts and routes

    private func syncWorkouts(_ emit: (SyncMessage) async throws -> Void, routes: Bool) async throws {
        let type = HKObjectType.workoutType()
        var anchor = loadAnchor(type.identifier)
        var added = 0, deleted = 0
        while true {
            let descriptor = HKAnchoredObjectQueryDescriptor(predicates: [.workout()], anchor: anchor, limit: 200)
            let result = try await descriptor.result(for: store)
            for w in result.addedSamples {
                try await emit(.workout(convert(w)))
                if routes { try await emitRoutes(for: w, emit: emit) }
                added += 1
            }
            for d in result.deletedObjects {
                try await emit(.deleted(uuid: d.uuid.uuidString, type: HealthTypes.storageName(type.identifier))); deleted += 1
            }
            anchor = result.newAnchor
            try await checkpoint()
            saveAnchor(anchor, type.identifier)
            if result.addedSamples.isEmpty && result.deletedObjects.isEmpty { break }
        }
        try await emit(.typeDone(type: HealthTypes.storageName(type.identifier), added: added, deleted: deleted))
    }

    private func convert(_ w: HKWorkout) -> SyncMessage.Workout {
        var stats: [SyncMessage.Workout.Statistic] = []
        for (qt, st) in w.allStatistics {
            let unit = HealthTypes.defaultUnits[qt.identifier] ?? st.sumQuantity().flatMap(firstCompatibleUnit) ?? st.averageQuantity().flatMap(firstCompatibleUnit) ?? .count()
            stats.append(.init(type: HealthTypes.storageName(qt.identifier), unit: unit.unitString,
                               average: st.averageQuantity()?.doubleValue(for: unit),
                               minimum: st.minimumQuantity()?.doubleValue(for: unit),
                               maximum: st.maximumQuantity()?.doubleValue(for: unit),
                               sum: st.sumQuantity()?.doubleValue(for: unit),
                               mostRecent: st.mostRecentQuantity()?.doubleValue(for: unit)))
        }
        let events = (w.workoutEvents ?? []).map {
            SyncMessage.Workout.Event(type: WorkoutNames.event($0.type), start: $0.dateInterval.start, end: $0.dateInterval.end, metadata: stringify($0.metadata))
        }
        let activities = w.workoutActivities.map {
            SyncMessage.Workout.Activity(activityType: WorkoutNames.activity($0.workoutConfiguration.activityType),
                                         start: $0.startDate, end: $0.endDate, metadata: stringify($0.metadata))
        }
        return .init(uuid: w.uuid.uuidString, activityType: WorkoutNames.activity(w.workoutActivityType),
                     activityTypeRaw: Int(w.workoutActivityType.rawValue), start: w.startDate, end: w.endDate, duration: w.duration,
                     source: source(w), metadata: stringify(w.metadata),
                     statistics: stats, events: events, activities: activities)
    }

    private func emitRoutes(for workout: HKWorkout, emit: (SyncMessage) async throws -> Void) async throws {
        let routeDescriptor = HKSampleQueryDescriptor(
            predicates: [.workoutRoute(HKQuery.predicateForObjects(from: workout))],
            sortDescriptors: [])
        let routes = try await routeDescriptor.result(for: store)
        for route in routes {
            let locations = HKWorkoutRouteQueryDescriptor(route).results(for: store)
            for try await loc in locations {
                try await emit(.routePoint(.init(workoutUUID: workout.uuid.uuidString, routeUUID: route.uuid.uuidString, time: loc.timestamp,
                                                 latitude: loc.coordinate.latitude, longitude: loc.coordinate.longitude, altitude: loc.altitude,
                                                 horizontalAccuracy: loc.horizontalAccuracy, verticalAccuracy: loc.verticalAccuracy,
                                                 speed: loc.speed, course: loc.course)))
            }
        }
    }

    // MARK: - Heartbeat series (beat-to-beat intervals behind HRV)

    private func syncHeartbeatSeries(_ emit: (SyncMessage) async throws -> Void) async throws {
        let type = HKSeriesType.heartbeat()
        // The series samples themselves; the beats inside them are streamed right after via a second query.
        try await syncSamples(of: type, emit: emit) { sample in
            guard let series = sample as? HKHeartbeatSeriesSample else { return nil }
            return self.baseSample(series, kind: "heartbeatSeries")
        }
        // Beats for every series. Anchors above already limit to new series; here we re-read the ones just sent
        // by querying series newer than the last beat sync date.
        let sinceKey = "heartbeats.since"
        let since = defaults.object(forKey: sinceKey) as? Date ?? .distantPast
        let now = Date()
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.sample(type: type, predicate: HKQuery.predicateForSamples(withStart: since, end: nil, options: []))],
            sortDescriptors: [SortDescriptor(\.startDate)])
        for case let series as HKHeartbeatSeriesSample in try await descriptor.result(for: store) {
            for try await beat in HKHeartbeatSeriesQueryDescriptor(series).results(for: store) {
                try await emit(.heartbeat(seriesUUID: series.uuid.uuidString, timeSinceStart: beat.timeIntervalSinceStart, precededByGap: beat.precededByGap))
            }
        }
        try await checkpoint()
        defaults.set(now, forKey: sinceKey)
    }

    // MARK: - Activity summaries (rings)

    /// Day of the last ring sync. Rings have no anchors, so the first sync sends every day and later syncs only the
    /// days since the last one (plus two before it, in case a late Watch sync changed them).
    private let activitySinceKey = "activity.since"

    private func emitActivitySummaries(_ emit: (SyncMessage) async throws -> Void) async throws {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let from = (defaults.object(forKey: activitySinceKey) as? Date).flatMap { cal.date(byAdding: .day, value: -2, to: $0) }
            ?? cal.date(byAdding: .year, value: -15, to: today)!
        var start = cal.dateComponents([.year, .month, .day], from: from)
        var end = cal.dateComponents([.year, .month, .day], from: Date())
        start.calendar = cal; end.calendar = cal
        let predicate = HKQuery.predicate(forActivitySummariesBetweenStart: start, end: end)
        let summaries = try await HKActivitySummaryQueryDescriptor(predicate: predicate).result(for: store)
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        for s in summaries {
            guard let d = cal.date(from: s.dateComponents(for: cal)) else { continue }
            try await emit(.activitySummary(.init(
                date: f.string(from: d),
                activeEnergyBurned: s.activeEnergyBurned.doubleValue(for: .kilocalorie()),
                activeEnergyBurnedGoal: s.activeEnergyBurnedGoal.doubleValue(for: .kilocalorie()),
                appleExerciseTime: s.appleExerciseTime.doubleValue(for: .minute()),
                appleExerciseTimeGoal: s.appleExerciseTimeGoal.doubleValue(for: .minute()),
                appleStandHours: s.appleStandHours.doubleValue(for: .count()),
                appleStandHoursGoal: s.appleStandHoursGoal.doubleValue(for: .count()),
                appleMoveTime: s.appleMoveTime.doubleValue(for: .minute()),
                appleMoveTimeGoal: s.appleMoveTimeGoal.doubleValue(for: .minute()))))
        }
        try await checkpoint()
        defaults.set(today, forKey: activitySinceKey)
    }

    // MARK: - Helpers

    private func baseSample(_ s: HKSample, kind: String) -> SyncMessage.Sample {
        .init(uuid: s.uuid.uuidString, type: HealthTypes.storageName(s.sampleType.identifier), kind: kind, start: s.startDate, end: s.endDate,
              source: source(s), metadata: stringify(s.metadata))
    }

    private func source(_ o: HKObject) -> SyncMessage.Source {
        .init(name: o.sourceRevision.source.name)
    }

    private func stringify(_ metadata: [String: Any]?) -> [String: String]? {
        guard let metadata, !metadata.isEmpty else { return nil }
        var out: [String: String] = [:]
        for (k, v) in metadata {
            switch v {
            case let q as HKQuantity: out[k] = q.description
            case let d as Date: out[k] = ISO8601DateFormatter().string(from: d)
            default: out[k] = String(describing: v)
            }
        }
        return out
    }

    private func firstCompatibleUnit(_ q: HKQuantity) -> HKUnit? {
        [HKUnit.count(), .meter(), .kilocalorie(), .minute(), .watt(), .count().unitDivided(by: .minute())].first { q.is(compatibleWith: $0) }
    }

    private func json(_ obj: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
    }


    private func loadAnchor(_ id: String) -> HKQueryAnchor? {
        guard let data = defaults.data(forKey: "anchor.\(id)") else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private func saveAnchor(_ anchor: HKQueryAnchor?, _ id: String) {
        guard let anchor, let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) else { return }
        defaults.set(data, forKey: "anchor.\(id)")
    }
}

enum ReaderError: LocalizedError {
    case noHealthKit
    var errorDescription: String? { "Health data isn't available on this device." }
}
