import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: ReceiverModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("ioHealth Receiver").font(.title.bold())

            GroupBox("Database") {
                HStack {
                    if let url = model.databaseURL {
                        Text(url.path).lineLimit(1).truncationMode(.middle)
                        Button("Show in Finder") { model.revealDatabase() }
                    } else {
                        Text("No database yet.").foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("New…") { model.chooseDatabase() }
                    Button("Open…") { model.openExistingDatabase() }
                }
                .padding(4)
            }

            GroupBox("Sync") {
                VStack(alignment: .leading, spacing: 10) {
                    statusLine
                    if !model.addresses.isEmpty {
                        LabeledContent("Address for the iPhone app") {
                            Text(model.addresses.joined(separator: "  or  ")).textSelection(.enabled)
                        }
                    }
                    LabeledContent("Last sync", value: model.lastSync.isEmpty ? "Never" : model.lastSync)
                    Toggle("Open ioHealth Receiver at login, so background syncs from the phone always find it", isOn: $model.launchAtLogin)
                    Toggle("Write CSV files after each sync", isOn: $model.writeCSVAfterSync)
                    HStack {
                        Button("Export CSV now") { model.exportCSV() }
                            .disabled(model.databaseURL == nil || isReceiving)
                    }
                }
                .padding(4)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            GroupBox("What's in the database") {
                ScrollView {
                    Text(model.summary.isEmpty ? "Nothing yet." : model.summary)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 120)
            }
        }
        .padding(24)
    }

    private var isReceiving: Bool {
        if case .receiving = model.status { return true }
        return false
    }

    @ViewBuilder private var statusLine: some View {
        switch model.status {
        case .needsDatabase:
            Label("Click New… to create a database, then open ioHealth on your iPhone.", systemImage: "1.circle")
        case .waiting(let port):
            Label("Waiting for your iPhone (port \(port)). Open ioHealth on the phone and tap this Mac, or type the address below into it.", systemImage: "wifi")
        case .receiving(let peer):
            VStack(alignment: .leading) {
                HStack { ProgressView().controlSize(.small); Text("Receiving from \(peer)…") }
                Text("\(model.received.formatted()) items  ·  \(model.currentType)").font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            }
        case .finished:
            Label("Sync finished. \(model.received.formatted()) items received this time. Waiting for the next sync.", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
        }
    }
}
