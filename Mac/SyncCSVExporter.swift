import Foundation

/// One CSV per sample type (HeartRate.csv, StepCount.csv, SleepAnalysis.csv, …) plus one per other table.
struct SyncCSVExporter {
    let db: SQLiteDatabase

    func export(to dir: URL) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        var types: [String] = []
        try db.query("SELECT DISTINCT type FROM samples ORDER BY type") { _, v in if let t = v[0] { types.append(t) } }
        for type in types {
            let short = type
                .replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "")
                .replacingOccurrences(of: "HKCategoryTypeIdentifier", with: "")
                .replacingOccurrences(of: "HKDataType", with: "")
            try write(sql: """
                SELECT start_date, end_date, value, unit, text, source_name, source_product, metadata_json
                FROM samples WHERE type = ? ORDER BY start_date
                """, params: [type], to: dir.appendingPathComponent("\(short).csv"))
        }
        for table in ["workouts", "workout_statistics", "workout_events", "workout_activities", "workout_route_points",
                      "ecgs", "heartbeats", "activity_summaries", "characteristics", "sync_log"] {
            try write(sql: "SELECT * FROM \(table)", to: dir.appendingPathComponent("\(table).csv"))
        }
    }

    private func write(sql: String, params: [Any?] = [], to url: URL) throws {
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        var wroteHeader = false
        var buffer = ""
        try db.query(sql, params) { names, values in
            if !wroteHeader {
                buffer += names.map(escape).joined(separator: ",") + "\n"
                wroteHeader = true
            }
            buffer += values.map { escape($0 ?? "") }.joined(separator: ",") + "\n"
            if buffer.utf8.count > 1 << 20 {
                handle.write(Data(buffer.utf8))
                buffer = ""
            }
        }
        handle.write(Data(buffer.utf8))
    }

    private func escape(_ s: String) -> String {
        guard s.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" || $0 == "\r" }) else { return s }
        return "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
}
