import Foundation
import UserNotifications
import UIKit

@MainActor
final class PushController: ObservableObject {
	@Published var authorization: UNAuthorizationStatus = .notDetermined
	@Published var lastError: String?
	var onToken: ((String) -> Void)?

	func refreshAuthorization() async {
		let settings = await UNUserNotificationCenter.current().notificationSettings()
		authorization = settings.authorizationStatus
	}

	func requestAndRegister() async {
		lastError = nil
		do {
			let granted = try await UNUserNotificationCenter.current()
				.requestAuthorization(options: [.alert, .sound, .badge])
			await refreshAuthorization()
			if granted {
				UIApplication.shared.registerForRemoteNotifications()
			} else {
				lastError = "[PLACEHOLDER: notifications were denied]"
			}
		} catch {
			lastError = error.localizedDescription
		}
	}

	func didReceiveDeviceToken(_ data: Data) {
		let hex = data.map { String(format: "%02x", $0) }.joined()
		onToken?(hex)
	}

	func didFailToRegister(_ error: Error) {
		lastError = error.localizedDescription
	}
}
