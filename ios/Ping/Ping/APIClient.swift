import Foundation

struct APIClient {
	var baseURL: URL
	var ownerSecret: String

	func registerDevice(token: String, environment: String) async throws -> DeviceRegistration {
		try await request(
			"/devices",
			method: "POST",
			body: ["token": token, "environment": environment],
			as: DeviceRegistration.self
		)
	}

	func inbox() async throws -> InboxResponse {
		try await request("/inbox", method: "GET", body: nil, as: InboxResponse.self)
	}

	func prefs() async throws -> Prefs {
		try await request("/prefs", method: "GET", body: nil, as: Prefs.self)
	}

	func savePrefs(_ prefs: Prefs) async throws -> Prefs {
		try await request("/prefs", method: "PUT", body: prefs, as: Prefs.self)
	}

	private func request<T: Decodable>(
		_ path: String,
		method: String,
		body: Encodable?,
		as type: T.Type
	) async throws -> T {
		guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
			throw PingError.notConfigured
		}
		var request = URLRequest(url: url)
		request.httpMethod = method
		request.setValue("Bearer \(ownerSecret)", forHTTPHeaderField: "Authorization")
		if let body {
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
			request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
		}
		let (data, response) = try await URLSession.shared.data(for: request)
		guard let http = response as? HTTPURLResponse else { throw PingError.decode }
		if http.statusCode == 401 { throw PingError.http(401, "unauthorized") }
		guard (200 ..< 300).contains(http.statusCode) else {
			let code = (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.error ?? "http"
			throw PingError.http(http.statusCode, code)
		}
		do {
			return try JSONDecoder().decode(T.self, from: data)
		} catch {
			throw PingError.decode
		}
	}
}

private struct AnyEncodable: Encodable {
	private let encodeFunc: (Encoder) throws -> Void

	init(_ value: Encodable) {
		encodeFunc = { encoder in
			try value.encode(to: encoder)
		}
	}

	func encode(to encoder: Encoder) throws {
		try encodeFunc(encoder)
	}
}
