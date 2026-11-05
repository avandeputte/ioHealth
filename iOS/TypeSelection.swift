import SwiftUI
import HealthKit

/// Which data types get synced. Stored as the set of switched-off identifiers, so everything is on by default and
/// types added in later versions start out on. Permission is still requested for every type, so switching one back
/// on later needs no new prompt; its anchor resumes where it left off (or sends its whole history if it never synced).
enum TypeSelection {
    private static let key = "disabledTypes"

    // Pseudo-identifiers for things that aren't a single HKSampleType.
    static let characteristics = "characteristics"
    static let workouts = HKObjectType.workoutType().identifier
    static let workoutRoutes = HKSeriesType.workoutRoute().identifier
    static let heartbeatSeries = HKSeriesType.heartbeat().identifier
    static let audiograms = HKObjectType.audiogramSampleType().identifier
    static let activityRings = HKObjectType.activitySummaryType().identifier

    static var disabled: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: key) ?? []) }
        set { UserDefaults.standard.set(newValue.sorted(), forKey: key) }
    }

    static func isEnabled(_ id: String) -> Bool { !disabled.contains(id) }

    struct Group: Identifiable {
        let name: String
        let ids: [String]
        var id: String { name }
    }

    /// Every selectable type, grouped for the settings screen. Types not placed in a named group land in "Other".
    static let groups: [Group] = {
        func q(_ names: String...) -> [String] { names.map { "HKQuantityTypeIdentifier" + $0 } }
        func c(_ names: String...) -> [String] { names.map { "HKCategoryTypeIdentifier" + $0 } }
        var named: [Group] = [
            Group(name: "Vitals", ids: q("HeartRate", "RestingHeartRate", "WalkingHeartRateAverage", "HeartRateVariabilitySDNN",
                                         "HeartRateRecoveryOneMinute", "BloodPressureSystolic", "BloodPressureDiastolic", "RespiratoryRate",
                                         "OxygenSaturation", "BloodGlucose", "PeripheralPerfusionIndex", "ElectrodermalActivity",
                                         "InhalerUsage", "InsulinDelivery", "BloodAlcoholContent", "ForcedVitalCapacity",
                                         "ForcedExpiratoryVolume1", "PeakExpiratoryFlowRate")),
            Group(name: "Activity & fitness", ids: q("StepCount", "DistanceWalkingRunning", "ActiveEnergyBurned", "BasalEnergyBurned",
                                                     "FlightsClimbed", "AppleExerciseTime", "AppleMoveTime", "AppleStandTime", "VO2Max",
                                                     "PhysicalEffort", "EstimatedWorkoutEffortScore", "WorkoutEffortScore",
                                                     "RunningGroundContactTime", "RunningPower", "RunningSpeed", "RunningStrideLength",
                                                     "RunningVerticalOscillation", "DistanceCycling", "CyclingCadence",
                                                     "CyclingFunctionalThresholdPower", "CyclingPower", "CyclingSpeed", "PushCount",
                                                     "DistanceWheelchair", "SwimmingStrokeCount", "DistanceSwimming", "UnderwaterDepth",
                                                     "DistanceDownhillSnowSports", "DistanceRowing", "RowingSpeed", "DistancePaddleSports",
                                                     "PaddleSportsSpeed", "DistanceSkatingSports", "DistanceCrossCountrySkiing",
                                                     "CrossCountrySkiingSpeed", "NikeFuel", "AppleWalkingSteadiness", "SixMinuteWalkTestDistance",
                                                     "WalkingSpeed", "WalkingStepLength", "WalkingAsymmetryPercentage",
                                                     "WalkingDoubleSupportPercentage", "StairAscentSpeed", "StairDescentSpeed")
                                                   + c("AppleStandHour")),
            Group(name: "Body", ids: q("BodyMass", "BodyMassIndex", "BodyFatPercentage", "LeanBodyMass", "Height", "WaistCircumference",
                                       "BodyTemperature")),
            Group(name: "Nutrition", ids: q("DietaryEnergyConsumed", "DietaryProtein", "DietaryCarbohydrates", "DietaryFiber", "DietarySugar",
                                            "DietaryFatTotal", "DietaryFatSaturated", "DietaryFatMonounsaturated", "DietaryFatPolyunsaturated",
                                            "DietaryCholesterol", "DietarySodium", "DietaryPotassium", "DietaryCalcium", "DietaryIron",
                                            "DietaryMagnesium", "DietaryPhosphorus", "DietaryZinc", "DietaryVitaminA", "DietaryVitaminB6",
                                            "DietaryVitaminB12", "DietaryVitaminC", "DietaryVitaminD", "DietaryVitaminE", "DietaryVitaminK",
                                            "DietaryThiamin", "DietaryRiboflavin", "DietaryNiacin", "DietaryFolate", "DietaryBiotin",
                                            "DietaryPantothenicAcid", "DietaryIodine", "DietarySelenium", "DietaryCopper", "DietaryManganese",
                                            "DietaryChromium", "DietaryMolybdenum", "DietaryChloride", "DietaryCaffeine", "DietaryWater",
                                            "NumberOfAlcoholicBeverages")),
            Group(name: "Sleep & mindfulness", ids: c("SleepAnalysis", "MindfulSession", "SleepApneaEvent")
                                                  + q("AppleSleepingWristTemperature", "AppleSleepingBreathingDisturbances")),
            Group(name: "Cycle tracking", ids: c("MenstrualFlow", "IntermenstrualBleeding", "CervicalMucusQuality", "OvulationTestResult",
                                                 "PregnancyTestResult", "ProgesteroneTestResult", "SexualActivity", "Contraceptive",
                                                 "Pregnancy", "Lactation", "PersistentIntermenstrualBleeding", "ProlongedMenstrualPeriods",
                                                 "IrregularMenstrualCycles", "InfrequentMenstrualCycles", "BleedingDuringPregnancy",
                                                 "BleedingAfterPregnancy")
                                             + q("BasalBodyTemperature")),
            Group(name: "Symptoms", ids: c("AbdominalCramps", "Acne", "AppetiteChanges", "BladderIncontinence", "Bloating", "BreastPain",
                                           "ChestTightnessOrPain", "Chills", "Constipation", "Coughing", "Diarrhea", "Dizziness", "DrySkin",
                                           "Fainting", "Fatigue", "Fever", "GeneralizedBodyAche", "HairLoss", "Headache", "Heartburn",
                                           "HotFlashes", "LossOfSmell", "LossOfTaste", "LowerBackPain", "MemoryLapse", "MoodChanges", "Nausea",
                                           "NightSweats", "PelvicPain", "RapidPoundingOrFlutteringHeartbeat", "RunnyNose", "ShortnessOfBreath",
                                           "SinusCongestion", "SkippedHeartbeat", "SleepChanges", "SoreThroat", "VaginalDryness", "Vomiting",
                                           "Wheezing")),
            Group(name: "Heart & safety events", ids: c("HighHeartRateEvent", "LowHeartRateEvent", "IrregularHeartRhythmEvent",
                                                        "LowCardioFitnessEvent", "AppleWalkingSteadinessEvent")
                                                    + q("AtrialFibrillationBurden", "NumberOfTimesFallen")),
            Group(name: "Hearing & environment", ids: q("EnvironmentalAudioExposure", "HeadphoneAudioExposure", "EnvironmentalSoundReduction",
                                                        "UVExposure", "TimeInDaylight", "WaterTemperature")
                                                    + c("AudioExposureEvent", "EnvironmentalAudioExposureEvent", "HeadphoneAudioExposureEvent")
                                                    + [audiograms]),
            Group(name: "Hygiene", ids: c("ToothbrushingEvent", "HandwashingEvent")),
        ]
        // Keep only types this iOS version knows, and catch anything in HealthTypes that isn't placed above.
        let known = Set(HealthTypes.quantityTypes.map(\.identifier) + HealthTypes.categoryTypes.map(\.identifier) + [audiograms])
        named = named.map { Group(name: $0.name, ids: $0.ids.filter(known.contains)) }
        let placed = Set(named.flatMap(\.ids))
        let other = (HealthTypes.quantityTypes.map(\.identifier) + HealthTypes.categoryTypes.map(\.identifier)).filter { !placed.contains($0) }
        if !other.isEmpty { named.append(Group(name: "Other", ids: other)) }
        named.append(Group(name: "Workouts & more", ids: [workouts, workoutRoutes, heartbeatSeries, activityRings, characteristics]))
        return named
    }()

    static var allIDs: [String] { groups.flatMap(\.ids) }

    static func name(_ id: String) -> String {
        switch id {
        case workouts: return "Workouts"
        case workoutRoutes: return "Workout routes (GPS)"
        case heartbeatSeries: return "Heartbeat series (beat-to-beat)"
        case activityRings: return "Activity rings"
        case characteristics: return "Characteristics (birth date, sex, blood type…)"
        case audiograms: return "Audiograms"
        case "HKQuantityTypeIdentifierVO2Max": return "VO₂ Max"
        case "HKQuantityTypeIdentifierForcedExpiratoryVolume1": return "Forced Expiratory Volume (1 s)"
        case "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": return "Heart Rate Variability (SDNN)"
        default:
            let short = id.replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "")
                .replacingOccurrences(of: "HKCategoryTypeIdentifier", with: "")
            // "HeartRate" -> "Heart Rate", "UVExposure" -> "UV Exposure", "SDNN" stays together.
            return short.replacingOccurrences(of: "(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", with: " ", options: .regularExpression)
        }
    }
}

/// Settings screen: one switch per type, grouped, searchable.
struct DataTypesView: View {
    @State private var disabled = TypeSelection.disabled
    @State private var search = ""
    /// Sample types that have at least one sample on this phone; nil until checked.
    @State private var withData: Set<String>?
    let store: HKHealthStore
    var onChange: () -> Void

    var body: some View {
        List {
            ForEach(TypeSelection.groups) { group in
                let ids = group.ids.filter(matches)
                if !ids.isEmpty {
                    Section {
                        ForEach(ids, id: \.self) { id in row(id) }
                    } header: {
                        HStack {
                            Text(group.name)
                            Spacer()
                            let allOn = ids.allSatisfy { !disabled.contains($0) }
                            Button(allOn ? "All off" : "All on") { set(ids, on: !allOn) }
                                .font(.caption).textCase(nil)
                        }
                    }
                }
            }
        }
        .navigationTitle("Data types")
        .searchable(text: $search)
        .toolbar {
            Menu {
                Button("Turn all on") { set(TypeSelection.allIDs, on: true) }
                Button("Turn all off") { set(TypeSelection.allIDs, on: false) }
                if let withData {
                    Button("Only types with data") {
                        let sampleTypes = TypeSelection.allIDs.filter { $0 != TypeSelection.characteristics && $0 != TypeSelection.activityRings }
                        set(sampleTypes.filter { !withData.contains($0) }, on: false)
                    }
                }
            } label: { Image(systemName: "ellipsis.circle") }
        }
        .task {
            // Without read permission HealthKit just returns nothing, so an all-empty answer means "unknown".
            let found = await probe()
            withData = found.isEmpty ? nil : found
        }
    }

    private func row(_ id: String) -> some View {
        let empty = withData.map { !$0.contains(id) && id != TypeSelection.characteristics && id != TypeSelection.activityRings } ?? false
        let needsWorkouts = id == TypeSelection.workoutRoutes && disabled.contains(TypeSelection.workouts)
        return Toggle(isOn: Binding(get: { !disabled.contains(id) }, set: { set([id], on: $0) })) {
            VStack(alignment: .leading) {
                Text(TypeSelection.name(id))
                if needsWorkouts {
                    Text("Only synced together with Workouts").font(.caption).foregroundStyle(.secondary)
                } else if empty {
                    Text("No data on this iPhone").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .disabled(needsWorkouts)
    }

    private func matches(_ id: String) -> Bool {
        search.isEmpty || TypeSelection.name(id).localizedCaseInsensitiveContains(search)
    }

    private func set(_ ids: [String], on: Bool) {
        if on { disabled.subtract(ids) } else { disabled.formUnion(ids) }
        TypeSelection.disabled = disabled
        onChange()
    }

    /// Asks HealthKit for one sample of each type, to show which ones are empty.
    private func probe() async -> Set<String> {
        let types: [HKSampleType] = HealthTypes.quantityTypes + HealthTypes.categoryTypes
            + [HKObjectType.workoutType(), HKSeriesType.workoutRoute(), HKSeriesType.heartbeat(), HKObjectType.audiogramSampleType()]
        return await withTaskGroup(of: String?.self) { group in
            for type in types {
                group.addTask {
                    let d = HKSampleQueryDescriptor(predicates: [.sample(type: type)], sortDescriptors: [], limit: 1)
                    let found = (try? await d.result(for: store))?.isEmpty == false
                    return found ? type.identifier : nil
                }
            }
            var out = Set<String>()
            for await id in group { if let id { out.insert(id) } }
            return out
        }
    }
}
