import SwiftUI

struct ContentView: View {
	@EnvironmentObject private var store: AppStore
	@EnvironmentObject private var push: PushController

	var body: some View {
		TabView {
			InboxView()
				.tabItem { Label("Inbox", systemImage: "tray") }
			SettingsView()
				.tabItem { Label("Settings", systemImage: "gear") }
		}
		.task {
			await push.start { token in
				Task { await store.register(tokenHex: token) }
			}
			if store.client != nil {
				await store.refresh()
			}
		}
	}
}
