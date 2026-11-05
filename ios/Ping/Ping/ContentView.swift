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
			push.onToken = { token in
				Task { await store.register(tokenHex: token) }
			}
			await push.refreshAuthorization()
			if store.client != nil {
				await store.refresh()
			}
		}
	}
}
