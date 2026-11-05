import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

enum SQLiteError: LocalizedError {
    case open(String), prepare(String, String), step(String)
    var errorDescription: String? {
        switch self {
        case .open(let m): return "Couldn't create the database: \(m)"
        case .prepare(let sql, let m): return "SQL error (\(m)) in: \(sql)"
        case .step(let m): return "SQL error: \(m)"
        }
    }
}

/// Thin wrapper around the system sqlite3 library. One connection, used from one thread at a time.
final class SQLiteDatabase {
    private var db: OpaquePointer?
    private var statements: [String: OpaquePointer] = [:]

    init(url: URL) throws {
        guard sqlite3_open(url.path, &db) == SQLITE_OK else {
            throw SQLiteError.open(String(cString: sqlite3_errmsg(db)))
        }
        try exec("PRAGMA journal_mode = OFF")
        try exec("PRAGMA synchronous = OFF")
        try exec("PRAGMA temp_store = MEMORY")
    }

    deinit {
        for (_, s) in statements { sqlite3_finalize(s) }
        sqlite3_close(db)
    }

    func exec(_ sql: String) throws {
        var err: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(db, sql, nil, nil, &err) == SQLITE_OK else {
            let message = err.map { String(cString: $0) } ?? "unknown"
            sqlite3_free(err)
            throw SQLiteError.prepare(sql, message)
        }
    }

    func begin() throws { try exec("BEGIN") }
    func commit() throws { try exec("COMMIT") }

    var lastInsertID: Int64 { sqlite3_last_insert_rowid(db) }

    /// Runs a parameterised statement. Statements are cached by SQL text, so calling this in a loop is cheap.
    /// Bind values may be String, Int, Int64, Double or nil.
    @discardableResult
    func run(_ sql: String, _ params: [Any?]) throws -> Int64 {
        let stmt = try prepared(sql)
        defer { sqlite3_reset(stmt); sqlite3_clear_bindings(stmt) }
        for (i, p) in params.enumerated() {
            let idx = Int32(i + 1)
            switch p {
            case nil: sqlite3_bind_null(stmt, idx)
            case let s as String: sqlite3_bind_text(stmt, idx, s, -1, SQLITE_TRANSIENT)
            case let n as Int: sqlite3_bind_int64(stmt, idx, Int64(n))
            case let n as Int64: sqlite3_bind_int64(stmt, idx, n)
            case let d as Double: sqlite3_bind_double(stmt, idx, d)
            default: sqlite3_bind_text(stmt, idx, String(describing: p!), -1, SQLITE_TRANSIENT)
            }
        }
        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_DONE || rc == SQLITE_ROW else {
            throw SQLiteError.step(String(cString: sqlite3_errmsg(db)))
        }
        return lastInsertID
    }

    /// Reads every row of a query as an array of column strings (nil for NULL). Fine for CSV export; not for huge joins.
    func query(_ sql: String, _ params: [Any?] = [], row: ([String], [String?]) throws -> Void) throws {
        var raw: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &raw, nil) == SQLITE_OK, let stmt = raw else {
            throw SQLiteError.prepare(sql, String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(stmt) }
        for (i, p) in params.enumerated() {
            if let s = p as? String { sqlite3_bind_text(stmt, Int32(i + 1), s, -1, SQLITE_TRANSIENT) }
        }
        let count = Int(sqlite3_column_count(stmt))
        let names = (0..<count).map { String(cString: sqlite3_column_name(stmt, Int32($0))) }
        while sqlite3_step(stmt) == SQLITE_ROW {
            let values: [String?] = (0..<count).map { c in
                sqlite3_column_type(stmt, Int32(c)) == SQLITE_NULL
                    ? nil
                    : String(cString: sqlite3_column_text(stmt, Int32(c)))
            }
            try row(names, values)
        }
    }

    func scalar(_ sql: String) throws -> String? {
        var result: String?
        try query(sql) { _, v in result = v.first ?? nil }
        return result
    }

    /// Human readable row counts for the UI.
    func summary() throws -> String {
        var names: [String] = []
        try query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name") { _, v in
            if let n = v[0] { names.append(n) }
        }
        var lines: [String] = []
        for n in names {
            let c = try scalar("SELECT COUNT(*) FROM \"\(n)\"") ?? "0"
            lines.append("\(n.padding(toLength: 22, withPad: " ", startingAt: 0)) \(Int(c)?.formatted() ?? c)")
        }
        var byType: [String] = []
        let sampleTable = names.contains("samples") ? "samples" : "records"
        try query("SELECT type, COUNT(*) c FROM \(sampleTable) GROUP BY type ORDER BY c DESC LIMIT 15") { _, v in
            byType.append("  \((v[0] ?? "").replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "").replacingOccurrences(of: "HKCategoryTypeIdentifier", with: "")) \(Int(v[1] ?? "")?.formatted() ?? "")")
        }
        return (lines + ["", "Top record types:"] + byType).joined(separator: "\n")
    }

    private func prepared(_ sql: String) throws -> OpaquePointer {
        if let s = statements[sql] { return s }
        var raw: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &raw, nil) == SQLITE_OK, let stmt = raw else {
            throw SQLiteError.prepare(sql, String(cString: sqlite3_errmsg(db)))
        }
        statements[sql] = stmt
        return stmt
    }
}
