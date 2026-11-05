import SwiftUI

struct InboxView: View {
	@EnvironmentObject private var store: AppStore

	var body: some View {
		NavigationStack {
			Group {
				if store.inbox.isEmpty {
					ContentUnavailableView(
						"[PLACEHOLDER: empty inbox title]",
						systemImage: "tray",
						description: Text("[PLACEHOLDER: empty inbox body]")
					)
				} else {
					List {
						ForEach(store.inbox) { group in
							Section(group.bot) {
								ForEach(group.items) { item in
									VStack(alignment: .leading, spacing: 4) {
										Text(item.title)
											.font(.headline)
										Text(item.body)
											.font(.body)
											.foregroundStyle(.secondary)
										HStack(spacing: 8) {
											if let tag = item.tag {
												Text(tag)
													.font(.caption)
													.padding(.horizontal, 8)
													.padding(.vertical, 2)
													.background(.fill.tertiary, in: Capsule())
											}
											Text(item.push)
												.font(.caption)
												.foregroundStyle(.secondary)
											Text(formatted(item.created_at))
												.font(.caption)
												.foregroundStyle(.secondary)
										}
									}
									.padding(.vertical, 2)
								}
							}
						}
					}
					.listStyle(.insetGrouped)
				}
			}
			.navigationTitle("Inbox")
			.toolbar {
				ToolbarItem(placement: .topBarTrailing) {
					Button("Refresh") {
						Task { await store.refresh() }
					}
				}
			}
			.overlay(alignment: .bottom) {
				if let errorMessage = store.errorMessage {
					Text(errorMessage)
						.font(.footnote)
						.padding(8)
						.frame(maxWidth: .infinity)
						.background(.ultraThinMaterial)
				}
			}
		}
	}

	private func formatted(_ millis: Int) -> String {
		let date = Date(timeIntervalSince1970: TimeInterval(millis) / 1000)
		return date.formatted(date: .abbreviated, time: .shortened)
	}
}
