import Foundation

/// Applies incoming `SyncMessage`s to SQLite. All inserts are idempotent (keyed on HealthKit UUIDs), so a full
/// resync over an existing database just refreshes rows rather than duplicating them.
final class SyncDatabase: @unchecked Sendable { // only used on ReceiverModel.dbQueue once opened
    let db: SQLiteDatabase
    let url: URL
    private(set) var appliedThisSession = 0
    private var inTransaction = false
    private var sinceCommit = 0
    private let iso = ISO8601DateFormatter()

    static let schema = """
    CREATE TABLE IF NOT EXISTS characteristics (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE IF NOT EXISTS samples (
        uuid TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        value REAL,
        unit TEXT,
        text TEXT,
        count INTEGER,
        source_name TEXT, source_bundle TEXT, source_version TEXT, source_product TEXT, source_os TEXT,
        device_json TEXT,
        metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS workouts (
        uuid TEXT PRIMARY KEY,
        activity_type TEXT, activity_type_raw INTEGER,
        start_date TEXT, end_date TEXT, duration_s REAL,
        source_name TEXT, source_bundle TEXT, source_version TEXT, source_product TEXT, source_os TEXT,
        device_json TEXT, metadata_json TEXT
    );
    CREATE TABLE IF NOT EXISTS workout_statistics (
        workout_uuid TEXT, type TEXT, unit TEXT, average REAL, minimum REAL, maximum REAL, sum REAL, most_recent REAL,
        PRIMARY KEY (workout_uuid, type)
    );
    CREATE TABLE IF NOT EXISTS workout_events (workout_uuid TEXT, type TEXT, start_date TEXT, end_date TEXT, metadata_json TEXT);
    CREATE TABLE IF NOT EXISTS workout_activities (workout_uuid TEXT, activity_type TEXT, start_date TEXT, end_date TEXT, metadata_json TEXT);
    CREATE TABLE IF NOT EXISTS workout_route_points (
        workout_uuid TEXT, route_uuid TEXT, time TEXT,
        latitude REAL, longitude REAL, altitude REAL, horizontal_accuracy REAL, vertical_accuracy REAL, speed REAL, course REAL,
        PRIMARY KEY (route_uuid, time)
    );

    CREATE TABLE IF NOT EXISTS ecgs (
        uuid TEXT PRIMARY KEY, start_date TEXT, end_date TEXT, classification TEXT, symptoms_status TEXT,
        average_heart_rate REAL, sampling_frequency_hz REAL, voltage_count INTEGER,
        source_name TEXT, source_bundle TEXT, source_version TEXT, device_json TEXT, metadata_json TEXT
    );
    CREATE TABLE IF NOT EXISTS ecg_voltages (ecg_uuid TEXT, idx INTEGER, microvolts REAL, PRIMARY KEY (ecg_uuid, idx));

    CREATE TABLE IF NOT EXISTS heartbeats (series_uuid TEXT, time_since_start_s REAL, preceded_by_gap INTEGER, PRIMARY KEY (series_uuid, time_since_start_s));

    CREATE TABLE IF NOT EXISTS activity_summaries (
        date TEXT PRIMARY KEY,
        active_energy_kcal REAL, active_energy_goal_kcal REAL,
        exercise_min REAL, exercise_goal_min REAL,
        stand_hours REAL, stand_hours_goal REAL,
        move_min REAL, move_goal_min REAL
    );

    CREATE TABLE IF NOT EXISTS deleted_objects (uuid TEXT PRIMARY KEY, type TEXT, deleted_at TEXT);
    CREATE TABLE IF NOT EXISTS sync_log (id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT, device TEXT, system TEXT, full_resync INTEGER, items INTEGER);

    CREATE INDEX IF NOT EXISTS idx_samples_type_start ON samples(type, start_date);
    CREATE INDEX IF NOT EXISTS idx_workouts_start ON workouts(start_date);
    CREATE INDEX IF NOT EXISTS idx_route_points_workout ON workout_route_points(workout_uuid);
    """

    init(url: URL) throws {
        self.url = url
        db = try SQLiteDatabase(url: url)
        try db.exec(Self.schema)
    }

    private var logID: Int64?

    func apply(_ message: SyncMessage) throws {
        if !inTransaction { try db.begin(); inTransaction = true }
        switch message {
        case .hello(let h):
            logID = try db.run("INSERT INTO sync_log (started_at, device, system, full_resync, items) VALUES (?,?,?,?,0)",
                               [iso.string(from: Date()), h.deviceName, h.systemVersion, h.fullResync ? 1 : 0])

        case .characteristic(let key, let value):
            try db.run("INSERT OR REPLACE INTO characteristics VALUES (?,?)", [key, value])

        case .sample(let s):
            try db.run("""
                INSERT OR REPLACE INTO samples (uuid, type, kind, start_date, end_date, value, unit, text, count,
                    source_name, source_bundle, source_version, source_product, source_os, device_json, metadata_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, [s.uuid, s.type, s.kind, iso.string(from: s.start), iso.string(from: s.end), s.value, s.unit, s.text, s.count,
                      s.source.name, nil, nil, nil, nil,
                      nil, json(s.metadata)])
            try db.run("DELETE FROM deleted_objects WHERE uuid = ?", [s.uuid])

        case .workout(let w):
            try db.run("""
                INSERT OR REPLACE INTO workouts (uuid, activity_type, activity_type_raw, start_date, end_date, duration_s,
                    source_name, source_bundle, source_version, source_product, source_os, device_json, metadata_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, [w.uuid, w.activityType, w.activityTypeRaw, iso.string(from: w.start), iso.string(from: w.end), w.duration,
                      w.source.name, nil, nil, nil, nil,
                      nil, json(w.metadata)])
            try db.run("DELETE FROM workout_events WHERE workout_uuid = ?", [w.uuid])
            try db.run("DELETE FROM workout_activities WHERE workout_uuid = ?", [w.uuid])
            for s in w.statistics {
                try db.run("INSERT OR REPLACE INTO workout_statistics VALUES (?,?,?,?,?,?,?,?)",
                           [w.uuid, s.type, s.unit, s.average, s.minimum, s.maximum, s.sum, s.mostRecent])
            }
            for e in w.events {
                try db.run("INSERT INTO workout_events VALUES (?,?,?,?,?)", [w.uuid, e.type, iso.string(from: e.start), iso.string(from: e.end), json(e.metadata)])
            }
            for a in w.activities {
                try db.run("INSERT INTO workout_activities VALUES (?,?,?,?,?)",
                           [w.uuid, a.activityType, iso.string(from: a.start), a.end.map(iso.string), json(a.metadata)])
            }

        case .routePoint(let p):
            try db.run("INSERT OR REPLACE INTO workout_route_points VALUES (?,?,?,?,?,?,?,?,?,?)",
                       [p.workoutUUID, p.routeUUID, iso.string(from: p.time), p.latitude, p.longitude, p.altitude,
                        p.horizontalAccuracy, p.verticalAccuracy, p.speed, p.course])

        case .ecg(let e):
            try db.run("""
                INSERT OR REPLACE INTO ecgs (uuid, start_date, end_date, classification, symptoms_status, average_heart_rate,
                    sampling_frequency_hz, voltage_count, source_name, source_bundle, source_version, device_json, metadata_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, [e.uuid, iso.string(from: e.start), iso.string(from: e.end), e.classification, e.symptomsStatus, e.averageHeartRate,
                      e.samplingFrequency, e.voltageCount, e.source.name, nil, nil, nil, json(e.metadata)])

        case .ecgVoltage(let uuid, let idx, let v):
            try db.run("INSERT OR REPLACE INTO ecg_voltages VALUES (?,?,?)", [uuid, idx, v])

        case .heartbeat(let uuid, let t, let gap):
            try db.run("INSERT OR REPLACE INTO heartbeats VALUES (?,?,?)", [uuid, t, gap ? 1 : 0])

        case .activitySummary(let a):
            try db.run("INSERT OR REPLACE INTO activity_summaries VALUES (?,?,?,?,?,?,?,?,?)",
                       [a.date, a.activeEnergyBurned, a.activeEnergyBurnedGoal, a.appleExerciseTime, a.appleExerciseTimeGoal,
                        a.appleStandHours, a.appleStandHoursGoal, a.appleMoveTime, a.appleMoveTimeGoal])

        case .deleted(let uuid, let type):
            try db.run("DELETE FROM samples WHERE uuid = ?", [uuid])
            try db.run("DELETE FROM workouts WHERE uuid = ?", [uuid])
            try db.run("DELETE FROM ecgs WHERE uuid = ?", [uuid])
            try db.run("INSERT OR REPLACE INTO deleted_objects VALUES (?,?,?)", [uuid, type, iso.string(from: Date())])

        case .typeDone, .ack, .error:
            break

        case .done(let total):
            if let id = logID {
                try db.run("UPDATE sync_log SET finished_at = ?, items = ? WHERE id = ?", [iso.string(from: Date()), total, id])
            }
            try commit()
            return
        }

        appliedThisSession += 1
        sinceCommit += 1
        if sinceCommit >= 50_000 { try commit(); try db.begin(); inTransaction = true }
    }

    func commit() throws {
        guard inTransaction else { return }
        try db.commit()
        inTransaction = false
        sinceCommit = 0
    }

    func totalRows() -> Int {
        let tables = ["samples", "workouts", "workout_route_points", "ecgs", "ecg_voltages", "heartbeats", "activity_summaries", "characteristics"]
        return tables.reduce(0) { $0 + (Int((try? db.scalar("SELECT COUNT(*) FROM \($1)")) ?? "0") ?? 0) }
    }

    func lastSyncDescription() -> String {
        var line = "Never"
        try? db.query("SELECT finished_at, items, device FROM sync_log WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1") { _, v in
            guard let when = v[0] else { return }
            let date = ISO8601DateFormatter().date(from: when).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? when
            line = "\(date), \(Int(v[1] ?? "0")?.formatted() ?? "0") items from \(v[2] ?? "iPhone")"
        }
        return line
    }

    func summary() -> String {
        (try? db.summary()) ?? ""
    }

    private func json<T: Encodable>(_ v: T?) -> String? {
        guard let v else { return nil }
        return (try? JSONEncoder.sync.encode(v)).map { String(decoding: $0, as: UTF8.self) }
    }
}
