import HealthKit

/// Every HealthKit type we know how to read. Identifiers are strings so a type that doesn't exist on the
/// running iOS version is simply skipped instead of failing to compile.
enum HealthTypes {
    static let quantityIdentifiers: [String] = [
        // Body
        "HKQuantityTypeIdentifierBodyMassIndex", "HKQuantityTypeIdentifierBodyFatPercentage", "HKQuantityTypeIdentifierHeight",
        "HKQuantityTypeIdentifierBodyMass", "HKQuantityTypeIdentifierLeanBodyMass", "HKQuantityTypeIdentifierWaistCircumference",
        "HKQuantityTypeIdentifierAppleSleepingWristTemperature", "HKQuantityTypeIdentifierBodyTemperature", "HKQuantityTypeIdentifierBasalBodyTemperature",
        // Fitness
        "HKQuantityTypeIdentifierStepCount", "HKQuantityTypeIdentifierDistanceWalkingRunning", "HKQuantityTypeIdentifierRunningGroundContactTime",
        "HKQuantityTypeIdentifierRunningPower", "HKQuantityTypeIdentifierRunningSpeed", "HKQuantityTypeIdentifierRunningStrideLength",
        "HKQuantityTypeIdentifierRunningVerticalOscillation", "HKQuantityTypeIdentifierDistanceCycling", "HKQuantityTypeIdentifierPushCount",
        "HKQuantityTypeIdentifierDistanceWheelchair", "HKQuantityTypeIdentifierSwimmingStrokeCount", "HKQuantityTypeIdentifierDistanceSwimming",
        "HKQuantityTypeIdentifierDistanceDownhillSnowSports", "HKQuantityTypeIdentifierBasalEnergyBurned", "HKQuantityTypeIdentifierActiveEnergyBurned",
        "HKQuantityTypeIdentifierFlightsClimbed", "HKQuantityTypeIdentifierNikeFuel", "HKQuantityTypeIdentifierAppleExerciseTime",
        "HKQuantityTypeIdentifierAppleMoveTime", "HKQuantityTypeIdentifierAppleStandTime", "HKQuantityTypeIdentifierVO2Max",
        "HKQuantityTypeIdentifierCyclingCadence", "HKQuantityTypeIdentifierCyclingFunctionalThresholdPower", "HKQuantityTypeIdentifierCyclingPower",
        "HKQuantityTypeIdentifierCyclingSpeed", "HKQuantityTypeIdentifierPhysicalEffort", "HKQuantityTypeIdentifierTimeInDaylight",
        "HKQuantityTypeIdentifierUnderwaterDepth", "HKQuantityTypeIdentifierWaterTemperature", "HKQuantityTypeIdentifierDistanceRowing",
        "HKQuantityTypeIdentifierDistancePaddleSports", "HKQuantityTypeIdentifierDistanceSkatingSports", "HKQuantityTypeIdentifierDistanceCrossCountrySkiing",
        "HKQuantityTypeIdentifierRowingSpeed", "HKQuantityTypeIdentifierPaddleSportsSpeed", "HKQuantityTypeIdentifierCrossCountrySkiingSpeed",
        "HKQuantityTypeIdentifierEstimatedWorkoutEffortScore", "HKQuantityTypeIdentifierWorkoutEffortScore",
        // Vitals
        "HKQuantityTypeIdentifierHeartRate", "HKQuantityTypeIdentifierBloodPressureSystolic",
        "HKQuantityTypeIdentifierBloodPressureDiastolic", "HKQuantityTypeIdentifierRespiratoryRate", "HKQuantityTypeIdentifierRestingHeartRate",
        "HKQuantityTypeIdentifierWalkingHeartRateAverage", "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", "HKQuantityTypeIdentifierHeartRateRecoveryOneMinute",
        "HKQuantityTypeIdentifierAtrialFibrillationBurden", "HKQuantityTypeIdentifierOxygenSaturation", "HKQuantityTypeIdentifierPeripheralPerfusionIndex",
        "HKQuantityTypeIdentifierBloodGlucose", "HKQuantityTypeIdentifierNumberOfTimesFallen", "HKQuantityTypeIdentifierElectrodermalActivity",
        "HKQuantityTypeIdentifierInhalerUsage", "HKQuantityTypeIdentifierInsulinDelivery", "HKQuantityTypeIdentifierBloodAlcoholContent",
        "HKQuantityTypeIdentifierForcedVitalCapacity", "HKQuantityTypeIdentifierForcedExpiratoryVolume1", "HKQuantityTypeIdentifierPeakExpiratoryFlowRate",
        "HKQuantityTypeIdentifierEnvironmentalAudioExposure", "HKQuantityTypeIdentifierHeadphoneAudioExposure", "HKQuantityTypeIdentifierEnvironmentalSoundReduction",
        "HKQuantityTypeIdentifierAppleWalkingSteadiness", "HKQuantityTypeIdentifierSixMinuteWalkTestDistance", "HKQuantityTypeIdentifierWalkingSpeed",
        "HKQuantityTypeIdentifierWalkingStepLength", "HKQuantityTypeIdentifierWalkingAsymmetryPercentage", "HKQuantityTypeIdentifierWalkingDoubleSupportPercentage",
        "HKQuantityTypeIdentifierStairAscentSpeed", "HKQuantityTypeIdentifierStairDescentSpeed", "HKQuantityTypeIdentifierUVExposure",
        "HKQuantityTypeIdentifierNumberOfAlcoholicBeverages", "HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances",
        // Nutrition
        "HKQuantityTypeIdentifierDietaryFatTotal", "HKQuantityTypeIdentifierDietaryFatPolyunsaturated", "HKQuantityTypeIdentifierDietaryFatMonounsaturated",
        "HKQuantityTypeIdentifierDietaryFatSaturated", "HKQuantityTypeIdentifierDietaryCholesterol", "HKQuantityTypeIdentifierDietarySodium",
        "HKQuantityTypeIdentifierDietaryCarbohydrates", "HKQuantityTypeIdentifierDietaryFiber", "HKQuantityTypeIdentifierDietarySugar",
        "HKQuantityTypeIdentifierDietaryEnergyConsumed", "HKQuantityTypeIdentifierDietaryProtein", "HKQuantityTypeIdentifierDietaryVitaminA",
        "HKQuantityTypeIdentifierDietaryVitaminB6", "HKQuantityTypeIdentifierDietaryVitaminB12", "HKQuantityTypeIdentifierDietaryVitaminC",
        "HKQuantityTypeIdentifierDietaryVitaminD", "HKQuantityTypeIdentifierDietaryVitaminE", "HKQuantityTypeIdentifierDietaryVitaminK",
        "HKQuantityTypeIdentifierDietaryCalcium", "HKQuantityTypeIdentifierDietaryIron", "HKQuantityTypeIdentifierDietaryThiamin",
        "HKQuantityTypeIdentifierDietaryRiboflavin", "HKQuantityTypeIdentifierDietaryNiacin", "HKQuantityTypeIdentifierDietaryFolate",
        "HKQuantityTypeIdentifierDietaryBiotin", "HKQuantityTypeIdentifierDietaryPantothenicAcid", "HKQuantityTypeIdentifierDietaryPhosphorus",
        "HKQuantityTypeIdentifierDietaryIodine", "HKQuantityTypeIdentifierDietaryMagnesium", "HKQuantityTypeIdentifierDietaryZinc",
        "HKQuantityTypeIdentifierDietarySelenium", "HKQuantityTypeIdentifierDietaryCopper", "HKQuantityTypeIdentifierDietaryManganese",
        "HKQuantityTypeIdentifierDietaryChromium", "HKQuantityTypeIdentifierDietaryMolybdenum", "HKQuantityTypeIdentifierDietaryChloride",
        "HKQuantityTypeIdentifierDietaryPotassium", "HKQuantityTypeIdentifierDietaryCaffeine", "HKQuantityTypeIdentifierDietaryWater",
    ]

    static let categoryIdentifiers: [String] = [
        "HKCategoryTypeIdentifierSleepAnalysis", "HKCategoryTypeIdentifierAppleStandHour", "HKCategoryTypeIdentifierCervicalMucusQuality",
        "HKCategoryTypeIdentifierOvulationTestResult", "HKCategoryTypeIdentifierMenstrualFlow", "HKCategoryTypeIdentifierIntermenstrualBleeding",
        "HKCategoryTypeIdentifierSexualActivity", "HKCategoryTypeIdentifierMindfulSession", "HKCategoryTypeIdentifierHighHeartRateEvent",
        "HKCategoryTypeIdentifierLowHeartRateEvent", "HKCategoryTypeIdentifierIrregularHeartRhythmEvent", "HKCategoryTypeIdentifierAudioExposureEvent",
        "HKCategoryTypeIdentifierToothbrushingEvent", "HKCategoryTypeIdentifierPregnancy", "HKCategoryTypeIdentifierLactation",
        "HKCategoryTypeIdentifierContraceptive", "HKCategoryTypeIdentifierEnvironmentalAudioExposureEvent", "HKCategoryTypeIdentifierHeadphoneAudioExposureEvent",
        "HKCategoryTypeIdentifierHandwashingEvent", "HKCategoryTypeIdentifierLowCardioFitnessEvent", "HKCategoryTypeIdentifierAppleWalkingSteadinessEvent",
        "HKCategoryTypeIdentifierPregnancyTestResult", "HKCategoryTypeIdentifierProgesteroneTestResult", "HKCategoryTypeIdentifierPersistentIntermenstrualBleeding",
        "HKCategoryTypeIdentifierProlongedMenstrualPeriods", "HKCategoryTypeIdentifierIrregularMenstrualCycles", "HKCategoryTypeIdentifierInfrequentMenstrualCycles",
        "HKCategoryTypeIdentifierBleedingDuringPregnancy", "HKCategoryTypeIdentifierBleedingAfterPregnancy", "HKCategoryTypeIdentifierSleepApneaEvent",
        // Symptoms
        "HKCategoryTypeIdentifierAbdominalCramps", "HKCategoryTypeIdentifierAcne", "HKCategoryTypeIdentifierAppetiteChanges", "HKCategoryTypeIdentifierBladderIncontinence",
        "HKCategoryTypeIdentifierBloating", "HKCategoryTypeIdentifierBreastPain", "HKCategoryTypeIdentifierChestTightnessOrPain", "HKCategoryTypeIdentifierChills",
        "HKCategoryTypeIdentifierConstipation", "HKCategoryTypeIdentifierCoughing", "HKCategoryTypeIdentifierDiarrhea", "HKCategoryTypeIdentifierDizziness",
        "HKCategoryTypeIdentifierDrySkin", "HKCategoryTypeIdentifierFainting", "HKCategoryTypeIdentifierFatigue", "HKCategoryTypeIdentifierFever",
        "HKCategoryTypeIdentifierGeneralizedBodyAche", "HKCategoryTypeIdentifierHairLoss", "HKCategoryTypeIdentifierHeadache", "HKCategoryTypeIdentifierHeartburn",
        "HKCategoryTypeIdentifierHotFlashes", "HKCategoryTypeIdentifierLossOfSmell", "HKCategoryTypeIdentifierLossOfTaste", "HKCategoryTypeIdentifierLowerBackPain",
        "HKCategoryTypeIdentifierMemoryLapse", "HKCategoryTypeIdentifierMoodChanges", "HKCategoryTypeIdentifierNausea", "HKCategoryTypeIdentifierNightSweats",
        "HKCategoryTypeIdentifierPelvicPain", "HKCategoryTypeIdentifierRapidPoundingOrFlutteringHeartbeat", "HKCategoryTypeIdentifierRunnyNose",
        "HKCategoryTypeIdentifierShortnessOfBreath", "HKCategoryTypeIdentifierSinusCongestion", "HKCategoryTypeIdentifierSkippedHeartbeat",
        "HKCategoryTypeIdentifierSleepChanges", "HKCategoryTypeIdentifierSoreThroat", "HKCategoryTypeIdentifierVaginalDryness", "HKCategoryTypeIdentifierVomiting",
        "HKCategoryTypeIdentifierWheezing",
    ]

    /// The name a type is stored under on the server: the HealthKit identifier without its prefix, in snake_case
    /// ("HKQuantityTypeIdentifierHeartRate" -> "heart_rate", "...VO2Max" -> "vo2_max", "...HeartRateVariabilitySDNN" ->
    /// "heart_rate_variability_sdnn"). Anchors and settings keep using the HealthKit identifier.
    /// server/app/db.py (storage_name) implements the same rule for rows stored before this existed.
    static func storageName(_ identifier: String) -> String {
        var name = identifier
        for prefix in ["HKQuantityTypeIdentifier", "HKCategoryTypeIdentifier", "HKCharacteristicTypeIdentifier",
                       "HKDataTypeIdentifier"] where name.hasPrefix(prefix) {
            name.removeFirst(prefix.count)
            break
        }
        // "HKWorkoutTypeIdentifier" -> "Workout", "HKActivitySummaryTypeIdentifier" -> "ActivitySummary".
        if name.hasPrefix("HK") {
            name.removeFirst(2)
            if name.hasSuffix("TypeIdentifier"), name.count > "TypeIdentifier".count { name.removeLast("TypeIdentifier".count) }
        }
        return name.replacingOccurrences(of: "(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", with: "_", options: .regularExpression)
            .lowercased()
    }

    static var quantityTypes: [HKQuantityType] {
        quantityIdentifiers.compactMap { HKObjectType.quantityType(forIdentifier: HKQuantityTypeIdentifier(rawValue: $0)) }
    }

    static var categoryTypes: [HKCategoryType] {
        categoryIdentifiers.compactMap { HKObjectType.categoryType(forIdentifier: HKCategoryTypeIdentifier(rawValue: $0)) }
    }

    static var characteristicTypes: [HKCharacteristicType] {
        let ids: [HKCharacteristicTypeIdentifier] = [.biologicalSex, .bloodType, .dateOfBirth, .fitzpatrickSkinType, .wheelchairUse, .activityMoveMode]
        return ids.compactMap { HKObjectType.characteristicType(forIdentifier: $0) }
    }

    /// Everything we ask permission to read. Clinical (FHIR) records need a separate entitlement; see README.
    static var readTypes: Set<HKObjectType> {
        var s = Set<HKObjectType>()
        quantityTypes.forEach { s.insert($0) }
        categoryTypes.forEach { s.insert($0) }
        characteristicTypes.forEach { s.insert($0) }
        s.insert(HKObjectType.workoutType())
        s.insert(HKSeriesType.workoutRoute())
        s.insert(HKSeriesType.heartbeat())
        // ECGs are deliberately not synced; Alex has no use for them and the voltage traces are the bulk of the data.
        s.insert(HKObjectType.audiogramSampleType())
        s.insert(HKObjectType.activitySummaryType())
        // Vision prescriptions can't be requested here (HealthKit throws); they need per-object authorization.
        return s
    }

    /// Fallback units when HealthKit's preferredUnits doesn't return one. Anything missing falls back to
    /// the first unit the sample itself is compatible with.
    static let defaultUnits: [String: HKUnit] = [
        "HKQuantityTypeIdentifierHeartRate": .count().unitDivided(by: .minute()),
        "HKQuantityTypeIdentifierRestingHeartRate": .count().unitDivided(by: .minute()),
        "HKQuantityTypeIdentifierWalkingHeartRateAverage": .count().unitDivided(by: .minute()),
        "HKQuantityTypeIdentifierRespiratoryRate": .count().unitDivided(by: .minute()),
        "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": .secondUnit(with: .milli),
        "HKQuantityTypeIdentifierHeartRateRecoveryOneMinute": .count().unitDivided(by: .minute()),
        "HKQuantityTypeIdentifierOxygenSaturation": .percent(),
        "HKQuantityTypeIdentifierBodyFatPercentage": .percent(),
        "HKQuantityTypeIdentifierAtrialFibrillationBurden": .percent(),
        "HKQuantityTypeIdentifierWalkingAsymmetryPercentage": .percent(),
        "HKQuantityTypeIdentifierWalkingDoubleSupportPercentage": .percent(),
        "HKQuantityTypeIdentifierAppleWalkingSteadiness": .percent(),
        "HKQuantityTypeIdentifierBodyMass": .gramUnit(with: .kilo),
        "HKQuantityTypeIdentifierLeanBodyMass": .gramUnit(with: .kilo),
        "HKQuantityTypeIdentifierHeight": .meterUnit(with: .centi),
        "HKQuantityTypeIdentifierWaistCircumference": .meterUnit(with: .centi),
        "HKQuantityTypeIdentifierBodyTemperature": .degreeCelsius(),
        "HKQuantityTypeIdentifierBasalBodyTemperature": .degreeCelsius(),
        "HKQuantityTypeIdentifierAppleSleepingWristTemperature": .degreeCelsius(),
        "HKQuantityTypeIdentifierWaterTemperature": .degreeCelsius(),
        "HKQuantityTypeIdentifierBloodPressureSystolic": .millimeterOfMercury(),
        "HKQuantityTypeIdentifierBloodPressureDiastolic": .millimeterOfMercury(),
        "HKQuantityTypeIdentifierBloodGlucose": .gramUnit(with: .milli).unitDivided(by: .literUnit(with: .deci)),
        "HKQuantityTypeIdentifierActiveEnergyBurned": .kilocalorie(),
        "HKQuantityTypeIdentifierBasalEnergyBurned": .kilocalorie(),
        "HKQuantityTypeIdentifierDietaryEnergyConsumed": .kilocalorie(),
        "HKQuantityTypeIdentifierDistanceWalkingRunning": .meter(),
        "HKQuantityTypeIdentifierDistanceCycling": .meter(),
        "HKQuantityTypeIdentifierDistanceSwimming": .meter(),
        "HKQuantityTypeIdentifierDistanceWheelchair": .meter(),
        "HKQuantityTypeIdentifierDistanceDownhillSnowSports": .meter(),
        "HKQuantityTypeIdentifierSixMinuteWalkTestDistance": .meter(),
        "HKQuantityTypeIdentifierWalkingStepLength": .meterUnit(with: .centi),
        "HKQuantityTypeIdentifierRunningStrideLength": .meter(),
        "HKQuantityTypeIdentifierRunningVerticalOscillation": .meterUnit(with: .centi),
        "HKQuantityTypeIdentifierRunningGroundContactTime": .secondUnit(with: .milli),
        "HKQuantityTypeIdentifierUnderwaterDepth": .meter(),
        "HKQuantityTypeIdentifierWalkingSpeed": .meter().unitDivided(by: .second()),
        "HKQuantityTypeIdentifierRunningSpeed": .meter().unitDivided(by: .second()),
        "HKQuantityTypeIdentifierCyclingSpeed": .meter().unitDivided(by: .second()),
        "HKQuantityTypeIdentifierStairAscentSpeed": .meter().unitDivided(by: .second()),
        "HKQuantityTypeIdentifierStairDescentSpeed": .meter().unitDivided(by: .second()),
        "HKQuantityTypeIdentifierRunningPower": .watt(),
        "HKQuantityTypeIdentifierCyclingPower": .watt(),
        "HKQuantityTypeIdentifierCyclingFunctionalThresholdPower": .watt(),
        "HKQuantityTypeIdentifierCyclingCadence": .count().unitDivided(by: .minute()),
        "HKQuantityTypeIdentifierVO2Max": .literUnit(with: .milli).unitDivided(by: .gramUnit(with: .kilo).unitMultiplied(by: .minute())),
        "HKQuantityTypeIdentifierAppleExerciseTime": .minute(),
        "HKQuantityTypeIdentifierAppleMoveTime": .minute(),
        "HKQuantityTypeIdentifierAppleStandTime": .minute(),
        "HKQuantityTypeIdentifierTimeInDaylight": .minute(),
        "HKQuantityTypeIdentifierEnvironmentalAudioExposure": .decibelAWeightedSoundPressureLevel(),
        "HKQuantityTypeIdentifierHeadphoneAudioExposure": .decibelAWeightedSoundPressureLevel(),
        "HKQuantityTypeIdentifierEnvironmentalSoundReduction": .decibelAWeightedSoundPressureLevel(),
        "HKQuantityTypeIdentifierForcedVitalCapacity": .liter(),
        "HKQuantityTypeIdentifierForcedExpiratoryVolume1": .liter(),
        "HKQuantityTypeIdentifierPeakExpiratoryFlowRate": .liter().unitDivided(by: .minute()),
        "HKQuantityTypeIdentifierInsulinDelivery": .internationalUnit(),
        "HKQuantityTypeIdentifierBloodAlcoholContent": .percent(),
        "HKQuantityTypeIdentifierElectrodermalActivity": .siemenUnit(with: .micro),
        "HKQuantityTypeIdentifierPeripheralPerfusionIndex": .percent(),
        "HKQuantityTypeIdentifierDietaryWater": .literUnit(with: .milli),
        "HKQuantityTypeIdentifierPhysicalEffort": .kilocalorie().unitDivided(by: .gramUnit(with: .kilo).unitMultiplied(by: .hour())),
        "HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances": .count(),
    ]

    /// Picks a unit for a quantity type: preferred (user's own) unit if HealthKit gave us one, then our default,
    /// then whatever the sample is compatible with (grams, counts, etc.).
    static func unit(for type: HKQuantityType, preferred: [HKQuantityType: HKUnit], sample: HKQuantitySample) -> HKUnit {
        if let u = preferred[type] { return u }
        if let u = defaultUnits[type.identifier] { return u }
        for candidate in [HKUnit.count(), .gram(), .gramUnit(with: .milli), .gramUnit(with: .micro), .kilocalorie(), .meter(), .minute(), .percent(), .liter()]
        where sample.quantity.is(compatibleWith: candidate) {
            return candidate
        }
        return .count()
    }
}
