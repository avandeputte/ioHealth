import Foundation

/// Streams export.xml through Foundation's XMLParser and writes every element into SQLite.
/// export.xml is often several GB, so nothing is held in memory beyond the element currently being parsed.
final class HealthImporter: NSObject, XMLParserDelegate {
    private let db: SQLiteDatabase
    private let exportDirectory: URL
    private var progress: ((Int) -> Void)?
    private var parseError: Error?

    private var elementCount = 0
    private var rowsSinceCommit = 0

    // Parent ids for nested elements.
    private var currentRecordID: Int64?
    private var currentWorkoutID: Int64?
    private var currentCorrelationID: Int64?
    private var currentAudiogramID: Int64?
    private var currentPrescriptionID: Int64?
    private var insideWorkoutRoute = false
    private var currentRouteID: Int64?

    init(db: SQLiteDatabase, exportDirectory: URL) {
        self.db = db
        self.exportDirectory = exportDirectory
    }

    // MARK: - Schema

    static let schema = """
    CREATE TABLE export_info (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE me (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE records (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        source_name TEXT, source_version TEXT, device TEXT, unit TEXT,
        creation_date TEXT, start_date TEXT, end_date TEXT,
        value TEXT,
        value_num REAL,
        correlation_id INTEGER
    );
    CREATE TABLE record_metadata (record_id INTEGER, key TEXT, value TEXT);
    CREATE TABLE hrv_beats (record_id INTEGER, bpm REAL, time TEXT);

    CREATE TABLE correlations (
        id INTEGER PRIMARY KEY, type TEXT,
        source_name TEXT, source_version TEXT, device TEXT,
        creation_date TEXT, start_date TEXT, end_date TEXT
    );
    CREATE TABLE correlation_metadata (correlation_id INTEGER, key TEXT, value TEXT);

    CREATE TABLE workouts (
        id INTEGER PRIMARY KEY,
        activity_type TEXT,
        duration REAL, duration_unit TEXT,
        total_distance REAL, total_distance_unit TEXT,
        total_energy_burned REAL, total_energy_burned_unit TEXT,
        source_name TEXT, source_version TEXT, device TEXT,
        creation_date TEXT, start_date TEXT, end_date TEXT
    );
    CREATE TABLE workout_metadata (workout_id INTEGER, key TEXT, value TEXT);
    CREATE TABLE workout_events (workout_id INTEGER, type TEXT, date TEXT, duration REAL, duration_unit TEXT);
    CREATE TABLE workout_statistics (
        workout_id INTEGER, type TEXT, start_date TEXT, end_date TEXT,
        average REAL, minimum REAL, maximum REAL, sum REAL, unit TEXT
    );
    CREATE TABLE workout_routes (
        id INTEGER PRIMARY KEY, workout_id INTEGER,
        source_name TEXT, source_version TEXT, device TEXT,
        creation_date TEXT, start_date TEXT, end_date TEXT,
        file_path TEXT
    );
    CREATE TABLE workout_route_points (
        route_id INTEGER, time TEXT, latitude REAL, longitude REAL,
        elevation REAL, speed REAL, course REAL, h_acc REAL, v_acc REAL
    );

    CREATE TABLE activity_summaries (
        date TEXT PRIMARY KEY,
        active_energy_burned REAL, active_energy_burned_goal REAL, active_energy_burned_unit TEXT,
        apple_move_time REAL, apple_move_time_goal REAL,
        apple_exercise_time REAL, apple_exercise_time_goal REAL,
        apple_stand_hours REAL, apple_stand_hours_goal REAL
    );

    CREATE TABLE clinical_records (
        id INTEGER PRIMARY KEY, type TEXT, identifier TEXT, source_name TEXT, source_url TEXT,
        fhir_version TEXT, received_date TEXT, resource_path TEXT, resource_json TEXT
    );

    CREATE TABLE audiograms (
        id INTEGER PRIMARY KEY, type TEXT, source_name TEXT, source_version TEXT, device TEXT,
        creation_date TEXT, start_date TEXT, end_date TEXT
    );
    CREATE TABLE audiogram_points (
        audiogram_id INTEGER, frequency REAL, frequency_unit TEXT,
        left_ear REAL, left_ear_unit TEXT, right_ear REAL, right_ear_unit TEXT
    );

    CREATE TABLE vision_prescriptions (
        id INTEGER PRIMARY KEY, type TEXT, date_issued TEXT, expiration_date TEXT,
        source_name TEXT, source_version TEXT, device TEXT, creation_date TEXT, start_date TEXT, end_date TEXT
    );
    CREATE TABLE vision_prescription_details (prescription_id INTEGER, element TEXT, attributes_json TEXT);

    CREATE TABLE ecgs (
        id INTEGER PRIMARY KEY, file_name TEXT, recorded_date TEXT, classification TEXT, symptoms TEXT,
        software_version TEXT, device TEXT, sample_rate TEXT, lead TEXT, unit TEXT, sample_count INTEGER
    );
    CREATE TABLE ecg_samples (ecg_id INTEGER, idx INTEGER, value REAL);

    -- Anything this importer doesn't know about lands here so nothing is lost.
    CREATE TABLE other_elements (element TEXT, parent TEXT, attributes_json TEXT);
    """

    static let indexes = """
    CREATE INDEX idx_records_type_start ON records(type, start_date);
    CREATE INDEX idx_record_metadata ON record_metadata(record_id);
    CREATE INDEX idx_hrv_beats ON hrv_beats(record_id);
    CREATE INDEX idx_workouts_start ON workouts(start_date);
    CREATE INDEX idx_workout_route_points ON workout_route_points(route_id);
    CREATE INDEX idx_ecg_samples ON ecg_samples(ecg_id);
    """

    // MARK: - Driving the parse

    func importFile(_ xml: URL, progress: @escaping (Int) -> Void) throws {
        self.progress = progress
        try db.exec(Self.schema)
        try db.run("INSERT INTO export_info VALUES (?, ?)", ["source_file", xml.path])

        guard let stream = InputStream(url: xml) else { throw ImportError.exportXMLNotFound }
        let parser = XMLParser(stream: stream)
        parser.delegate = self
        parser.shouldResolveExternalEntities = false

        try db.begin()
        let ok = parser.parse()
        try db.commit()
        if let e = parseError { throw e }
        if !ok, let e = parser.parserError { throw e }
        try db.exec(Self.indexes)
    }

    /// electrocardiograms/*.csv are not in export.xml; each file is one ECG with a key/value header and one voltage per line.
    func importECGs() throws {
        let dir = exportDirectory.appendingPathComponent("electrocardiograms")
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
        try db.begin()
        for file in files where file.pathExtension.lowercased() == "csv" {
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            var header: [String: String] = [:]
            var samples: [Double] = []
            for line in text.split(whereSeparator: \.isNewline) {
                if let v = Double(line.trimmingCharacters(in: .whitespaces)) {
                    samples.append(v)
                } else if let comma = line.firstIndex(of: ",") {
                    header[String(line[..<comma])] = String(line[line.index(after: comma)...]).trimmingCharacters(in: .whitespaces)
                }
            }
            let id = try db.run("""
                INSERT INTO ecgs (file_name, recorded_date, classification, symptoms, software_version, device, sample_rate, lead, unit, sample_count)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                """, [file.lastPathComponent, header["Recorded Date"], header["Classification"], header["Symptoms"],
                      header["Software Version"], header["Device"], header["Sample Rate"], header["Lead"], header["Unit"], samples.count])
            for (i, v) in samples.enumerated() {
                try db.run("INSERT INTO ecg_samples VALUES (?,?,?)", [id, i, v])
            }
        }
        try db.commit()
    }

    // MARK: - XMLParserDelegate

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes a: [String: String]) {
        do {
            try handleStart(name, a)
        } catch {
            parseError = error
            parser.abortParsing()
        }
        elementCount += 1
        rowsSinceCommit += 1
        if elementCount % 20_000 == 0 { progress?(elementCount) }
        // Periodic commits keep the journal small without paying a transaction per row.
        if rowsSinceCommit >= 200_000 {
            rowsSinceCommit = 0
            try? db.commit()
            try? db.begin()
        }
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        switch name {
        case "Record": currentRecordID = nil
        case "Workout": currentWorkoutID = nil
        case "Correlation": currentCorrelationID = nil
        case "Audiogram": currentAudiogramID = nil
        case "VisionPrescription": currentPrescriptionID = nil
        case "WorkoutRoute": insideWorkoutRoute = false; currentRouteID = nil
        default: break
        }
    }

    private func handleStart(_ name: String, _ a: [String: String]) throws {
        func num(_ key: String) -> Double? { a[key].flatMap(Double.init) }

        switch name {
        case "HealthData":
            for (k, v) in a { try db.run("INSERT OR REPLACE INTO export_info VALUES (?, ?)", [k, v]) }
        case "ExportDate":
            try db.run("INSERT OR REPLACE INTO export_info VALUES (?, ?)", ["export_date", a["value"]])
        case "Me":
            for (k, v) in a { try db.run("INSERT OR REPLACE INTO me VALUES (?, ?)", [k, v]) }

        case "Record":
            currentRecordID = try db.run("""
                INSERT INTO records (type, source_name, source_version, device, unit, creation_date, start_date, end_date, value, value_num, correlation_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """, [a["type"], a["sourceName"], a["sourceVersion"], a["device"], a["unit"],
                      a["creationDate"], a["startDate"], a["endDate"], a["value"], num("value"), currentCorrelationID])
        case "MetadataEntry":
            if let r = currentRecordID {
                try db.run("INSERT INTO record_metadata VALUES (?,?,?)", [r, a["key"], a["value"]])
            } else if let w = currentWorkoutID {
                try db.run("INSERT INTO workout_metadata VALUES (?,?,?)", [w, a["key"], a["value"]])
            } else if let c = currentCorrelationID {
                try db.run("INSERT INTO correlation_metadata VALUES (?,?,?)", [c, a["key"], a["value"]])
            } else {
                try other(name, a)
            }
        case "HeartRateVariabilityMetadataList":
            break
        case "InstantaneousBeatsPerMinute":
            try db.run("INSERT INTO hrv_beats VALUES (?,?,?)", [currentRecordID, num("bpm"), a["time"]])

        case "Correlation":
            currentCorrelationID = try db.run("""
                INSERT INTO correlations (type, source_name, source_version, device, creation_date, start_date, end_date)
                VALUES (?,?,?,?,?,?,?)
                """, [a["type"], a["sourceName"], a["sourceVersion"], a["device"], a["creationDate"], a["startDate"], a["endDate"]])

        case "Workout":
            currentWorkoutID = try db.run("""
                INSERT INTO workouts (activity_type, duration, duration_unit, total_distance, total_distance_unit,
                    total_energy_burned, total_energy_burned_unit, source_name, source_version, device, creation_date, start_date, end_date)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, [a["workoutActivityType"], num("duration"), a["durationUnit"], num("totalDistance"), a["totalDistanceUnit"],
                      num("totalEnergyBurned"), a["totalEnergyBurnedUnit"], a["sourceName"], a["sourceVersion"], a["device"],
                      a["creationDate"], a["startDate"], a["endDate"]])
        case "WorkoutEvent":
            try db.run("INSERT INTO workout_events VALUES (?,?,?,?,?)", [currentWorkoutID, a["type"], a["date"], num("duration"), a["durationUnit"]])
        case "WorkoutStatistics":
            try db.run("INSERT INTO workout_statistics VALUES (?,?,?,?,?,?,?,?,?)",
                       [currentWorkoutID, a["type"], a["startDate"], a["endDate"], num("average"), num("minimum"), num("maximum"), num("sum"), a["unit"]])
        case "WorkoutRoute":
            insideWorkoutRoute = true
            currentRouteID = try db.run("""
                INSERT INTO workout_routes (workout_id, source_name, source_version, device, creation_date, start_date, end_date)
                VALUES (?,?,?,?,?,?,?)
                """, [currentWorkoutID, a["sourceName"], a["sourceVersion"], a["device"], a["creationDate"], a["startDate"], a["endDate"]])
        case "FileReference":
            guard insideWorkoutRoute, let route = currentRouteID, let path = a["path"] else { return try other(name, a) }
            try db.run("UPDATE workout_routes SET file_path = ? WHERE id = ?", [path, route])
            try importGPX(relativePath: path, routeID: route)

        case "ActivitySummary":
            try db.run("""
                INSERT OR REPLACE INTO activity_summaries VALUES (?,?,?,?,?,?,?,?,?,?)
                """, [a["dateComponents"], num("activeEnergyBurned"), num("activeEnergyBurnedGoal"), a["activeEnergyBurnedUnit"],
                      num("appleMoveTime"), num("appleMoveTimeGoal"), num("appleExerciseTime"), num("appleExerciseTimeGoal"),
                      num("appleStandHours"), num("appleStandHoursGoal")])

        case "ClinicalRecord":
            var json: String?
            if let p = a["resourcePath"] {
                let url = exportDirectory.appendingPathComponent(p.hasPrefix("/") ? String(p.dropFirst()) : p)
                json = try? String(contentsOf: url, encoding: .utf8)
            }
            try db.run("""
                INSERT INTO clinical_records (type, identifier, source_name, source_url, fhir_version, received_date, resource_path, resource_json)
                VALUES (?,?,?,?,?,?,?,?)
                """, [a["type"], a["identifier"], a["sourceName"], a["sourceURL"], a["fhirVersion"], a["receivedDate"], a["resourcePath"], json])

        case "Audiogram":
            currentAudiogramID = try db.run("""
                INSERT INTO audiograms (type, source_name, source_version, device, creation_date, start_date, end_date)
                VALUES (?,?,?,?,?,?,?)
                """, [a["type"], a["sourceName"], a["sourceVersion"], a["device"], a["creationDate"], a["startDate"], a["endDate"]])
        case "SensitivityPoint":
            try db.run("INSERT INTO audiogram_points VALUES (?,?,?,?,?,?,?)",
                       [currentAudiogramID, num("frequencyValue"), a["frequencyUnit"], num("leftEarValue"), a["leftEarUnit"], num("rightEarValue"), a["rightEarUnit"]])

        case "VisionPrescription":
            currentPrescriptionID = try db.run("""
                INSERT INTO vision_prescriptions (type, date_issued, expiration_date, source_name, source_version, device, creation_date, start_date, end_date)
                VALUES (?,?,?,?,?,?,?,?,?)
                """, [a["type"], a["dateIssued"], a["expirationDate"], a["sourceName"], a["sourceVersion"], a["device"],
                      a["creationDate"], a["startDate"], a["endDate"]])

        default:
            if let p = currentPrescriptionID {
                try db.run("INSERT INTO vision_prescription_details VALUES (?,?,?)", [p, name, jsonString(a)])
            } else {
                try other(name, a)
            }
        }
    }

    private func other(_ name: String, _ a: [String: String]) throws {
        let parent = currentWorkoutID != nil ? "Workout" : currentRecordID != nil ? "Record" : currentCorrelationID != nil ? "Correlation" : nil
        try db.run("INSERT INTO other_elements VALUES (?,?,?)", [name, parent, jsonString(a)])
    }

    private func jsonString(_ a: [String: String]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: a, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: - GPX routes

    /// workout-routes/*.gpx are small, so a second XMLParser per file is fine.
    private func importGPX(relativePath: String, routeID: Int64) throws {
        let url = exportDirectory.appendingPathComponent(relativePath.hasPrefix("/") ? String(relativePath.dropFirst()) : relativePath)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        let gpx = GPXParser()
        gpx.parse(url)
        for p in gpx.points {
            try db.run("INSERT INTO workout_route_points VALUES (?,?,?,?,?,?,?,?,?)",
                       [routeID, p.time, p.lat, p.lon, p.ele, p.speed, p.course, p.hAcc, p.vAcc])
        }
    }
}

private final class GPXParser: NSObject, XMLParserDelegate {
    struct Point { var time: String?; var lat: Double?; var lon: Double?; var ele, speed, course, hAcc, vAcc: Double? }
    var points: [Point] = []
    private var current: Point?
    private var text = ""

    func parse(_ url: URL) {
        guard let parser = XMLParser(contentsOf: url) else { return }
        parser.delegate = self
        parser.parse()
    }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes a: [String: String]) {
        text = ""
        if name == "trkpt" {
            current = Point(lat: a["lat"].flatMap(Double.init), lon: a["lon"].flatMap(Double.init))
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        guard current != nil else { return }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch name {
        case "time": current?.time = value
        case "ele": current?.ele = Double(value)
        case "speed": current?.speed = Double(value)
        case "course": current?.course = Double(value)
        case "hAcc": current?.hAcc = Double(value)
        case "vAcc": current?.vAcc = Double(value)
        case "trkpt": points.append(current!); current = nil
        default: break
        }
    }
}
