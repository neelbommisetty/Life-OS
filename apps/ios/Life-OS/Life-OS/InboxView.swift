import SwiftData
import SwiftUI

struct InboxView: View {
    @ObservedObject var appState: AppState
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \InboxItem.createdAt, order: .reverse) private var items: [InboxItem]
    @State private var didTriggerInitialRefresh = false

    var body: some View {
        Group {
            if items.isEmpty {
                ContentUnavailableView(
                    "No inbox items yet",
                    systemImage: "tray",
                    description: Text("Save a capture to see it here.")
                )
            } else {
                List {
                    ForEach(items) { item in
                        NavigationLink {
                            InboxItemDetailView(item: item)
                        } label: {
                            InboxRow(item: item)
                        }
                    }
                }
                .listStyle(.plain)
                .refreshable {
                    await appState.refreshInbox(modelContext: modelContext)
                }
            }
        }
        .navigationTitle("Inbox")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if appState.isRefreshingInbox || appState.isRetryingPendingInboxCreates {
                    ProgressView()
                } else if hasPendingCreates {
                    Button("Retry all") {
                        Task {
                            await appState.retryPendingInboxCreates(modelContext: modelContext)
                        }
                    }
                    .accessibilityIdentifier("inbox.retryAll")
                }
            }
        }
        .onAppear {
            guard !didTriggerInitialRefresh else { return }
            didTriggerInitialRefresh = true
            Task {
                await appState.refreshInbox(modelContext: modelContext)
            }
        }
    }

    private var hasPendingCreates: Bool {
        items.contains {
            $0.syncStatus == InboxItemSyncStatus.pendingCreate.rawValue
                || $0.syncStatus == InboxItemSyncStatus.failedCreate.rawValue
        }
    }
}

private struct InboxRow: View {
    let item: InboxItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(item.content)
                .font(.body)
                .lineLimit(2)

            HStack(spacing: 8) {
                Text(item.createdAt, style: .date)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if item.syncStatus != InboxItemSyncStatus.synced.rawValue {
                    Text("Not synced")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.orange.opacity(0.18), in: Capsule())
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("inbox.row.unsynced")
                }
            }
        }
        .padding(.vertical, 6)
    }
}

private struct InboxItemDetailView: View {
    let item: InboxItem

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(item.createdAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)

                Text(item.content)
                    .font(.body)
                    .textSelection(.enabled)

                if let syncError = item.lastSyncError,
                   item.syncStatus == InboxItemSyncStatus.failedCreate.rawValue {
                    Text(syncError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Spacer(minLength: 0)
            }
            .padding()
        }
        .navigationTitle("Item")
        .navigationBarTitleDisplayMode(.inline)
    }
}
