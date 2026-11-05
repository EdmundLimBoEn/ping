import Foundation
import Security

enum Keychain {
	static let ownerSecretKey = "owner-secret"

	static func read(_ key: String) -> String? {
		let query: [String: Any] = [
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: "co.sillyapps.ping",
			kSecAttrAccount as String: key,
			kSecReturnData as String: true,
			kSecMatchLimit as String: kSecMatchLimitOne,
		]
		var item: CFTypeRef?
		let status = SecItemCopyMatching(query as CFDictionary, &item)
		guard status == errSecSuccess, let data = item as? Data else { return nil }
		return String(data: data, encoding: .utf8)
	}

	@discardableResult
	static func write(_ key: String, value: String) -> Bool {
		delete(key)
		let payload: [String: Any] = [
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: "co.sillyapps.ping",
			kSecAttrAccount as String: key,
			kSecValueData as String: Data(value.utf8),
			kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
		]
		return SecItemAdd(payload as CFDictionary, nil) == errSecSuccess
	}

	static func delete(_ key: String) {
		let query: [String: Any] = [
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: "co.sillyapps.ping",
			kSecAttrAccount as String: key,
		]
		SecItemDelete(query as CFDictionary)
	}
}
