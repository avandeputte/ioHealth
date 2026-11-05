import Foundation

/// Writes one CSV per record type (e.g. HeartRate.csv, StepCount.csv) plus one per non-record table.
struct CSVExporter {
    let db: SQLiteDatabase

    func export(to dir: URL) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        var types: [String] = []
        try db.query("SELECT DISTINCT type FROM records ORDER BY type") { _, v in if let t = v[0] { types.append(t) } }
        for type in types {
            let short = type
                .replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "")
                .replacingOccurrences(of: "HKCategoryTypeIdentifier", with: "")
                .replacingOccurrences(of: "HKDataType", with: "")
            try write(sql: """
                SELECT start_date, end_date, value, unit, source_name, device, creation_date
                FROM records WHERE type = ? ORDER BY start_date
                """, params: [type], to: dir.appendingPathComponent("\(short).csv"))
        }

        for table in ["workouts", "workout_events", "workout_statistics", "workout_routes", "workout_route_points",
                      "activity_summaries", "correlations", "clinical_records", "audiograms", "audiogram_points",
                      "vision_prescriptions", "ecgs", "me", "export_info"] {
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
        if !wroteHeader { return }
        handle.write(Data(buffer.utf8))
    }

    private func escape(_ s: String) -> String {
        guard s.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" || $0 == "\r" }) else { return s }
        return "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }
}
