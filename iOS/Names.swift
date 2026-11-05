import HealthKit

/// Human readable names for HealthKit enums, so the database isn't full of bare integers.
enum WorkoutNames {
    static func activity(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .americanFootball: return "americanFootball"; case .archery: return "archery"; case .australianFootball: return "australianFootball"
        case .badminton: return "badminton"; case .baseball: return "baseball"; case .basketball: return "basketball"; case .bowling: return "bowling"
        case .boxing: return "boxing"; case .climbing: return "climbing"; case .cricket: return "cricket"; case .crossTraining: return "crossTraining"
        case .curling: return "curling"; case .cycling: return "cycling"; case .elliptical: return "elliptical"; case .equestrianSports: return "equestrianSports"
        case .fencing: return "fencing"; case .fishing: return "fishing"; case .functionalStrengthTraining: return "functionalStrengthTraining"
        case .golf: return "golf"; case .gymnastics: return "gymnastics"; case .handball: return "handball"; case .hiking: return "hiking"
        case .hockey: return "hockey"; case .hunting: return "hunting"; case .lacrosse: return "lacrosse"; case .martialArts: return "martialArts"
        case .mindAndBody: return "mindAndBody"; case .paddleSports: return "paddleSports"; case .play: return "play"
        case .preparationAndRecovery: return "preparationAndRecovery"; case .racquetball: return "racquetball"; case .rowing: return "rowing"
        case .rugby: return "rugby"; case .running: return "running"; case .sailing: return "sailing"; case .skatingSports: return "skatingSports"
        case .snowSports: return "snowSports"; case .soccer: return "soccer"; case .softball: return "softball"; case .squash: return "squash"
        case .stairClimbing: return "stairClimbing"; case .surfingSports: return "surfingSports"; case .swimming: return "swimming"
        case .tableTennis: return "tableTennis"; case .tennis: return "tennis"; case .trackAndField: return "trackAndField"
        case .traditionalStrengthTraining: return "traditionalStrengthTraining"; case .volleyball: return "volleyball"; case .walking: return "walking"
        case .waterFitness: return "waterFitness"; case .waterPolo: return "waterPolo"; case .waterSports: return "waterSports"
        case .wrestling: return "wrestling"; case .yoga: return "yoga"; case .barre: return "barre"; case .coreTraining: return "coreTraining"
        case .crossCountrySkiing: return "crossCountrySkiing"; case .downhillSkiing: return "downhillSkiing"; case .flexibility: return "flexibility"
        case .highIntensityIntervalTraining: return "highIntensityIntervalTraining"; case .jumpRope: return "jumpRope"; case .kickboxing: return "kickboxing"
        case .pilates: return "pilates"; case .snowboarding: return "snowboarding"; case .stairs: return "stairs"; case .stepTraining: return "stepTraining"
        case .wheelchairWalkPace: return "wheelchairWalkPace"; case .wheelchairRunPace: return "wheelchairRunPace"; case .taiChi: return "taiChi"
        case .mixedCardio: return "mixedCardio"; case .handCycling: return "handCycling"; case .discSports: return "discSports"
        case .fitnessGaming: return "fitnessGaming"; case .cardioDance: return "cardioDance"; case .socialDance: return "socialDance"
        case .pickleball: return "pickleball"; case .cooldown: return "cooldown"; case .swimBikeRun: return "swimBikeRun"; case .transition: return "transition"
        case .underwaterDiving: return "underwaterDiving"; case .other: return "other"
        default: return "activity_\(t.rawValue)"
        }
    }

    static func event(_ t: HKWorkoutEventType) -> String {
        switch t {
        case .pause: return "pause"; case .resume: return "resume"; case .lap: return "lap"; case .marker: return "marker"
        case .motionPaused: return "motionPaused"; case .motionResumed: return "motionResumed"; case .segment: return "segment"
        case .pauseOrResumeRequest: return "pauseOrResumeRequest"
        @unknown default: return "event_\(t.rawValue)"
        }
    }
}

enum CategoryValueNames {
    static func name(for type: String, value: Int) -> String? {
        switch type {
        case "HKCategoryTypeIdentifierSleepAnalysis":
            switch HKCategoryValueSleepAnalysis(rawValue: value) {
            case .inBed: return "inBed"; case .asleepUnspecified: return "asleep"; case .awake: return "awake"
            case .asleepCore: return "core"; case .asleepDeep: return "deep"; case .asleepREM: return "rem"
            default: return nil
            }
        case "HKCategoryTypeIdentifierAppleStandHour":
            return value == 0 ? "stood" : "idle"
        case "HKCategoryTypeIdentifierMenstrualFlow":
            return ["unspecified", "light", "medium", "heavy", "none"][safe: value - 1]
        case "HKCategoryTypeIdentifierOvulationTestResult":
            return ["negative", "luteinizingHormoneSurge", "indeterminate", "estrogenSurge"][safe: value - 1]
        case "HKCategoryTypeIdentifierCervicalMucusQuality":
            return ["dry", "sticky", "creamy", "watery", "eggWhite"][safe: value - 1]
        case "HKCategoryTypeIdentifierAudioExposureEvent", "HKCategoryTypeIdentifierEnvironmentalAudioExposureEvent":
            return "loudEnvironment"
        case "HKCategoryTypeIdentifierHeadphoneAudioExposureEvent":
            return "sevenDayLimit"
        case "HKCategoryTypeIdentifierLowCardioFitnessEvent":
            return "lowFitness"
        case "HKCategoryTypeIdentifierAppleWalkingSteadinessEvent":
            return ["initialLow", "initialVeryLow", "repeatLow", "repeatVeryLow"][safe: value - 1]
        case "HKCategoryTypeIdentifierPregnancyTestResult", "HKCategoryTypeIdentifierProgesteroneTestResult":
            return ["negative", "positive", "indeterminate"][safe: value - 1]
        case "HKCategoryTypeIdentifierContraceptive":
            return ["unspecified", "implant", "injection", "intrauterineDevice", "intravaginalRing", "oral", "patch"][safe: value - 1]
        default:
            // Symptoms and most other categories use the severity scale.
            if type.hasPrefix("HKCategoryTypeIdentifier"), let s = HKCategoryValueSeverity(rawValue: value) {
                switch s {
                case .unspecified: return "unspecified"; case .notPresent: return "notPresent"; case .mild: return "mild"
                case .moderate: return "moderate"; case .severe: return "severe"
                @unknown default: return nil
                }
            }
            return nil
        }
    }
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
