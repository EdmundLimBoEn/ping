import Foundation
import UserNotifications
import UIKit

@MainActor
final class PushController: ObservableObject {
	@Published var authorization: UNAuthorizationStatus = .notDetermined
	@Published var lastError: String?
	var onToken: ((String) -> Void)?
	private let authorizationStatus: @MainActor () async -> UNAuthorizationStatus
	private let registerForRemoteNotifications: @MainActor () -> Void

	init(
		authorizationStatus: @escaping @MainActor () async -> UNAuthorizationStatus = {
			await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
		},
		registerForRemoteNotifications: @escaping @MainActor () -> Void = {
			UIApplication.shared.registerForRemoteNotifications()
		}
	) {
		self.authorizationStatus = authorizationStatus
		self.registerForRemoteNotifications = registerForRemoteNotifications
	}

	func start(onToken: @escaping (String) -> Void) async {
		self.onToken = onToken
		await refreshAuthorization()
		switch authorization {
		case .authorized, .provisional, .ephemeral:
			registerForRemoteNotifications()
		default:
			break
		}
	}

	func refreshAuthorization() async {
		authorization = await authorizationStatus()
	}

	func requestAndRegister() async {
		lastError = nil
		do {
			let granted = try await UNUserNotificationCenter.current()
				.requestAuthorization(options: [.alert, .sound, .badge])
			await refreshAuthorization()
			if granted {
				registerForRemoteNotifications()
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
