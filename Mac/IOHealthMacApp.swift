import SwiftUI

@main
struct IOHealthMacApp: App {
    @StateObject private var model = ReceiverModel()

    var body: some Scene {
        WindowGroup("ioHealth Receiver") {
            ContentView()
                .environmentObject(model)
                .frame(minWidth: 620, minHeight: 440)
        }
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
