import SwiftUI
import UniformTypeIdentifiers

// Fallback tool: turns the Health app's export.zip into the same kind of SQLite/CSV output, for data from
// before the companion app existed, or for a phone you can't install the companion on.

@main
struct ImporterApp: App {
    var body: some Scene {
        WindowGroup("ioHealth Importer") {
            ImporterView()
                .frame(minWidth: 560, minHeight: 380)
        }
        .windowResizability(.contentSize)
    }
}

@MainActor
final class ImportModel: ObservableObject {
    enum Phase: Equatable {
        case idle
        case running(String)
        case done(String)
        case failed(String)
    }

    @Published var phase: Phase = .idle
    @Published var elementCount = 0
    @Published var alsoWriteCSV = true
    @Published var outputDB: URL?

    func run(input: URL, output: URL) {
        phase = .running("Preparing…")
        elementCount = 0
        let writeCSV = alsoWriteCSV
        Task.detached(priority: .userInitiated) {
            do {
                let exportXML = try await self.locateExportXML(input)
                await self.setPhase(.running("Reading \(exportXML.lastPathComponent)…"))

                try? FileManager.default.removeItem(at: output)
                let db = try SQLiteDatabase(url: output)
                let importer = HealthImporter(db: db, exportDirectory: exportXML.deletingLastPathComponent())
                try importer.importFile(exportXML) { count in
                    Task { @MainActor in self.elementCount = count }
                }
                try importer.importECGs()

                if writeCSV {
                    await self.setPhase(.running("Writing CSV files…"))
                    let csvDir = output.deletingPathExtension().appendingPathExtension("csv")
                    try CSVExporter(db: db).export(to: csvDir)
                }
                let summary = try db.summary()
                await MainActor.run {
                    self.outputDB = output
                    self.phase = .done(summary)
                }
            } catch {
                await self.setPhase(.failed(error.localizedDescription))
            }
        }
    }

    private func setPhase(_ p: Phase) { phase = p }

    /// Accepts export.zip, the unzipped "apple_health_export" folder, or export.xml itself.
    nonisolated private func locateExportXML(_ input: URL) async throws -> URL {
        let fm = FileManager.default
        var dir = input
        if input.pathExtension.lowercased() == "xml" { return input }
        if input.pathExtension.lowercased() == "zip" {
            await setPhase(.running("Unzipping \(input.lastPathComponent)…"))
            dir = fm.temporaryDirectory.appendingPathComponent("health-export-\(UUID().uuidString)")
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            p.arguments = ["-x", "-k", input.path, dir.path]
            try p.run()
            p.waitUntilExit()
            guard p.terminationStatus == 0 else { throw ImportError.unzipFailed }
        }
        // export.xml sits in apple_health_export/ (or a localized folder name), so search a couple of levels down.
        if let e = fm.enumerator(at: dir, includingPropertiesForKeys: nil) {
            while let url = e.nextObject() as? URL {
                if url.lastPathComponent == "export.xml" { return url }
            }
        }
        throw ImportError.exportXMLNotFound
    }
}

enum ImportError: LocalizedError {
    case unzipFailed, exportXMLNotFound
    var errorDescription: String? {
        switch self {
        case .unzipFailed: return "Couldn't unzip the export."
        case .exportXMLNotFound: return "No export.xml found. Pick the export.zip from the Health app, or its unzipped folder."
        }
    }
}

struct ImporterView: View {
    @StateObject private var model = ImportModel()
    @State private var pickingInput = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Import an Apple Health export").font(.title2.bold())
            Text("On your iPhone open Health, tap your profile picture, then **Export All Health Data**. AirDrop the export.zip to this Mac and choose it below (or drop it on this window).")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Toggle("Also write one CSV file per data type", isOn: $model.alsoWriteCSV)

            HStack {
                Button("Choose export.zip…") { pickingInput = true }
                    .keyboardShortcut("o")
                    .disabled(isRunning)
                if isRunning { ProgressView().controlSize(.small) }
            }

            status
            Spacer()
        }
        .padding(24)
        .fileImporter(isPresented: $pickingInput,
                      allowedContentTypes: [.zip, .xml, .folder]) { result in
            if case .success(let url) = result { start(with: url) }
        }
        .onDrop(of: [.fileURL], isTargeted: nil) { providers in
            guard let provider = providers.first else { return false }
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                if let url { Task { @MainActor in start(with: url) } }
            }
            return true
        }
    }

    private var isRunning: Bool {
        if case .running = model.phase { return true }
        return false
    }

    @ViewBuilder private var status: some View {
        switch model.phase {
        case .idle:
            EmptyView()
        case .running(let message):
            VStack(alignment: .leading) {
                Text(message)
                Text("\(model.elementCount.formatted()) items read").monospacedDigit().foregroundStyle(.secondary)
            }
        case .done(let summary):
            VStack(alignment: .leading, spacing: 8) {
                Text("Done").font(.headline)
                ScrollView { Text(summary).font(.system(.body, design: .monospaced)).textSelection(.enabled) }
                    .frame(maxHeight: 180)
                if let db = model.outputDB {
                    Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([db]) }
                }
            }
        case .failed(let message):
            Text(message).foregroundStyle(.red)
        }
    }

    private func start(with input: URL) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "sqlite") ?? .data]
        panel.nameFieldStringValue = "health-export.sqlite"
        panel.message = "Where should the SQLite database go? CSV files go in a folder next to it."
        guard panel.runModal() == .OK, let output = panel.url else { return }
        model.run(input: input, output: output)
    }
}
