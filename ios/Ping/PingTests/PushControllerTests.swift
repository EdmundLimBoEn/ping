import XCTest
import UserNotifications
@testable import Ping

@MainActor
final class PushControllerTests: XCTestCase {
	func testAuthorizedLaunchRegistersAfterInstallingTokenCallback() async {
		for status in [UNAuthorizationStatus.authorized, .provisional, .ephemeral] {
			var registrations = 0
			var tokens: [String] = []
			var push: PushController!
			push = PushController(
				authorizationStatus: { status },
				registerForRemoteNotifications: {
					registrations += 1
					// An immediate callback must not be lost during startup.
					push.didReceiveDeviceToken(Data([0x00, 0xab, 0xff]))
				}
			)
			await push.start { tokens.append($0) }
			XCTAssertEqual(push.authorization, status)
			XCTAssertEqual(registrations, 1)
			XCTAssertEqual(tokens, ["00abff"])
			push = nil
		}
	}

	func testDeniedAndUndeterminedLaunchesDoNotRegister() async {
		for status in [UNAuthorizationStatus.denied, .notDetermined] {
			var registrations = 0
			let push = PushController(
				authorizationStatus: { status },
				registerForRemoteNotifications: { registrations += 1 }
			)
			await push.start { _ in XCTFail("Unexpected device token") }
			XCTAssertEqual(push.authorization, status)
			XCTAssertEqual(registrations, 0)
		}
	}

	func testRelaunchUploadsChangedTokenAndRetriesUnchangedToken() async throws {
		XCTAssertTrue(URLProtocol.registerClass(DeviceRegistrationProtocol.self))
		defer { URLProtocol.unregisterClass(DeviceRegistrationProtocol.self) }
		let client = APIClient(baseURL: URL(string: "https://registration.ping.test")!, ownerSecret: "test-owner")

		// Each launch uses a fresh controller. Repeating the token also exercises
		// retrying a registration that did not reach the server on an earlier launch.
		for byte: UInt8 in [0xab, 0xcd, 0xcd] {
			let uploaded = expectation(description: "Token uploaded on launch")
			var push: PushController!
			push = PushController(
				authorizationStatus: { .authorized },
				registerForRemoteNotifications: {
					push.didReceiveDeviceToken(Data(repeating: byte, count: 32))
				}
			)
			await push.start { token in
				Task { @MainActor in
					do {
						let result = try await client.registerDevice(token: token, environment: "sandbox")
						XCTAssertEqual(result.token, String(repeating: String(format: "%02x", byte), count: 32))
					} catch {
						XCTFail("Device registration failed: \(error)")
					}
					uploaded.fulfill()
				}
			}
			await fulfillment(of: [uploaded], timeout: 2)
			push = nil
		}
	}
}

private final class DeviceRegistrationProtocol: URLProtocol {
	override class func canInit(with request: URLRequest) -> Bool {
		request.url?.host == "registration.ping.test"
	}

	override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

	override func startLoading() {
		XCTAssertEqual(request.url?.path, "/devices")
		XCTAssertEqual(request.httpMethod, "POST")
		XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-owner")
		do {
			var body = request.httpBody ?? Data()
			if let stream = request.httpBodyStream {
				stream.open()
				defer { stream.close() }
				var buffer = [UInt8](repeating: 0, count: 1024)
				while stream.hasBytesAvailable {
					let count = stream.read(&buffer, maxLength: buffer.count)
					guard count > 0 else { break }
					body.append(contentsOf: buffer.prefix(count))
				}
			}
			let payload = try JSONDecoder().decode([String: String].self, from: body)
			XCTAssertEqual(payload["environment"], "sandbox")
			let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
			let data = try JSONEncoder().encode(DeviceRegistration(ok: true, token: payload["token"]!, environment: "sandbox"))
			client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
			client?.urlProtocol(self, didLoad: data)
			client?.urlProtocolDidFinishLoading(self)
		} catch {
			client?.urlProtocol(self, didFailWithError: error)
		}
	}

	override func stopLoading() {}
}
