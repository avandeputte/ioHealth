import Foundation

/// Wire format between the iPhone and the Mac: newline-delimited JSON over a plain TCP connection
/// that the Mac advertises on the local network with Bonjour. One `SyncMessage` per line.
enum SyncProtocol {
    static let bonjourType = "_iohealth._tcp"
    /// Fixed so the Mac can be reached by typed-in address as well as by Bonjour.
    static let defaultPort: UInt16 = 47800
    static let version = 1
}

enum SyncMessage: Codable {
    case hello(Hello)
    case characteristic(key: String, value: String)
    case sample(Sample)
    case workout(Workout)
    case routePoint(RoutePoint)
    case ecg(ECG)
    case ecgVoltage(ecgUUID: String, index: Int, microvolts: Double)
    case heartbeat(seriesUUID: String, timeSinceStart: Double, precededByGap: Bool)
    case activitySummary(ActivitySummary)
    case deleted(uuid: String, type: String)
    case typeDone(type: String, added: Int, deleted: Int)
    case done(totalSent: Int)
    case ack(received: Int)
    case error(String)

    struct Hello: Codable {
        var protocolVersion: Int
        var deviceName: String
        var systemVersion: String
        var fullResync: Bool
    }

    struct Sample: Codable {
        var uuid: String
        var type: String
        /// "quantity", "category", "audiogram", "visionPrescription", "clinical", "other"
        var kind: String
        var start: Date
        var end: Date
        var value: Double?
        var unit: String?
        var text: String?
        var count: Int?
        var source: Source
        var metadata: [String: String]?
    }

    struct Source: Codable {
        var name: String
    }


    struct Workout: Codable {
        var uuid: String
        var activityType: String
        var activityTypeRaw: Int
        var start: Date
        var end: Date
        var duration: Double
        var source: Source
        var metadata: [String: String]?
        var statistics: [Statistic]
        var events: [Event]
        var activities: [Activity]

        struct Statistic: Codable { var type: String; var unit: String; var average, minimum, maximum, sum, mostRecent: Double? }
        struct Event: Codable { var type: String; var start: Date; var end: Date; var metadata: [String: String]? }
        struct Activity: Codable { var activityType: String; var start: Date; var end: Date?; var metadata: [String: String]? }
    }

    struct RoutePoint: Codable {
        var workoutUUID: String
        var routeUUID: String
        var time: Date
        var latitude, longitude, altitude, horizontalAccuracy, verticalAccuracy, speed, course: Double
    }

    struct ECG: Codable {
        var uuid: String
        var start: Date
        var end: Date
        var classification: String
        var symptomsStatus: String
        var averageHeartRate: Double?
        var samplingFrequency: Double?
        var voltageCount: Int
        var source: Source
        var metadata: [String: String]?
    }

    struct ActivitySummary: Codable {
        var date: String
        var activeEnergyBurned, activeEnergyBurnedGoal: Double
        var appleExerciseTime, appleExerciseTimeGoal: Double
        var appleStandHours, appleStandHoursGoal: Double
        var appleMoveTime, appleMoveTimeGoal: Double
    }
}

extension JSONEncoder {
    static let sync: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.withoutEscapingSlashes]
        return e
    }()
}

extension JSONDecoder {
    static let sync: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
