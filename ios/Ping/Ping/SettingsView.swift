import SwiftUI

struct SettingsView: View {
	@EnvironmentObject private var store: AppStore
	@EnvironmentObject private var push: PushController
	@State private var newTag = ""
	@State private var quietEnabled = false
	@State private var quietStart = Calendar.current.date(from: DateComponents(hour: 22, minute: 0)) ?? Date()
	@State private var quietEnd = Calendar.current.date(from: DateComponents(hour: 8, minute: 0)) ?? Date()

	var body: some View {
		NavigationStack {
			Form {
				Section("Worker") {
					TextField("https://api-ping.sillyapps.co", text: $store.baseURLString)
						.keyboardType(.URL)
						.textInputAutocapitalization(.never)
						.autocorrectionDisabled()
					SecureField("[PLACEHOLDER: owner secret]", text: $store.ownerSecret)
						.textInputAutocapitalization(.never)
						.autocorrectionDisabled()
				}

				Section("Push") {
					Button("Enable notifications") {
						Task { await push.requestAndRegister() }
					}
					LabeledContent("Status", value: store.status)
					if let lastError = push.lastError {
						Text(lastError)
							.foregroundStyle(.red)
					}
					Text("[PLACEHOLDER: permission explanation]")
						.font(.footnote)
						.foregroundStyle(.secondary)
				}

				Section("Mute") {
					Toggle("Mute all pushes", isOn: $store.prefs.muted)
					Toggle("Quiet hours", isOn: $quietEnabled)
					if quietEnabled {
						DatePicker("Start", selection: $quietStart, displayedComponents: .hourAndMinute)
						DatePicker("End", selection: $quietEnd, displayedComponents: .hourAndMinute)
					}
					LabeledContent("Time zone", value: TimeZone.current.identifier)
				}

				Section("Muted tags") {
					ForEach(store.prefs.muted_tags, id: \.self) { tag in
						Text(tag)
					}
					.onDelete { offsets in
						store.prefs.muted_tags.remove(atOffsets: offsets)
					}
					HStack {
						TextField("ci", text: $newTag)
							.textInputAutocapitalization(.never)
							.autocorrectionDisabled()
						Button("Add") {
							let tag = newTag.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
							if !tag.isEmpty, !store.prefs.muted_tags.contains(tag) {
								store.prefs.muted_tags.append(tag)
							}
							newTag = ""
						}
					}
				}

				Section {
					Button("Save preferences") {
						applyQuietToPrefs()
						Task { await store.savePrefs() }
					}
				}

				if let errorMessage = store.errorMessage {
					Section {
						Text(errorMessage)
							.foregroundStyle(.red)
					}
				}
			}
			.navigationTitle("Settings")
			.onAppear(perform: loadQuietFromPrefs)
			.onChange(of: store.prefs) { _, _ in
				loadQuietFromPrefs()
			}
		}
	}

	private func loadQuietFromPrefs() {
		if let quiet = store.prefs.quiet {
			quietEnabled = true
			quietStart = date(from: quiet.start) ?? quietStart
			quietEnd = date(from: quiet.end) ?? quietEnd
		} else {
			quietEnabled = false
		}
	}

	private func applyQuietToPrefs() {
		if quietEnabled {
			store.prefs.quiet = QuietHours(start: clock(quietStart), end: clock(quietEnd))
		} else {
			store.prefs.quiet = nil
		}
	}

	private func clock(_ date: Date) -> String {
		let comps = Calendar.current.dateComponents([.hour, .minute], from: date)
		return String(format: "%02d:%02d", comps.hour ?? 0, comps.minute ?? 0)
	}

	private func date(from clock: String) -> Date? {
		let parts = clock.split(separator: ":")
		guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else {
			return nil
		}
		return Calendar.current.date(from: DateComponents(hour: hour, minute: minute))
	}
}
