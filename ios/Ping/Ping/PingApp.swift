import SwiftUI

@main
struct PingApp: App {
	@UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
	@StateObject private var store = AppStore()

	var body: some Scene {
		WindowGroup {
			ContentView()
				.environmentObject(store)
				.environmentObject(appDelegate.push)
		}
	}
}
