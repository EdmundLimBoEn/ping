import Foundation

@MainActor
final class AppStore: ObservableObject {
	@Published var baseURLString: String {
		didSet { UserDefaults.standard.set(baseURLString, forKey: "ping.baseURL") }
	}

	@Published var ownerSecret: String {
		didSet { Keychain.write(Keychain.ownerSecretKey, value: ownerSecret) }
	}

	@Published var inbox: [InboxGroup] = []
	@Published var prefs = Prefs(muted: false, timezone: TimeZone.current.identifier, quiet: nil, muted_tags: [])
	@Published var status: String = "Not registered"
	@Published var errorMessage: String?

	init() {
		baseURLString = UserDefaults.standard.string(forKey: "ping.baseURL") ?? ""
		ownerSecret = Keychain.read(Keychain.ownerSecretKey) ?? ""
	}

	var client: APIClient? {
		guard let url = URL(string: baseURLString), url.scheme == "https" || url.scheme == "http" else {
			return nil
		}
		guard !ownerSecret.isEmpty else { return nil }
		return APIClient(baseURL: url, ownerSecret: ownerSecret)
	}

	func refresh() async {
		errorMessage = nil
		guard let client else {
			errorMessage = PingError.notConfigured.localizedDescription
			return
		}
		do {
			async let inboxCall = client.inbox()
			async let prefsCall = client.prefs()
			inbox = try await inboxCall.groups
			prefs = try await prefsCall
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func savePrefs() async {
		errorMessage = nil
		guard let client else {
			errorMessage = PingError.notConfigured.localizedDescription
			return
		}
		prefs.timezone = TimeZone.current.identifier
		do {
			prefs = try await client.savePrefs(prefs)
		} catch {
			errorMessage = error.localizedDescription
		}
	}

	func register(tokenHex: String) async {
		errorMessage = nil
		guard let client else {
			errorMessage = PingError.notConfigured.localizedDescription
			return
		}
		do {
			#if DEBUG
			let environment = "sandbox"
			#else
			let environment = "production"
			#endif
			let result = try await client.registerDevice(token: tokenHex, environment: environment)
			status = "Registered \(result.environment)"
			UserDefaults.standard.set(tokenHex, forKey: "ping.lastToken")
		} catch {
			status = "Registration failed"
			errorMessage = error.localizedDescription
		}
	}
}
