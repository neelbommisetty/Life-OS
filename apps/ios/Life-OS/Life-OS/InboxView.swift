import SwiftData
import SwiftUI

struct InboxView: View {
    @Query(sort: \InboxItem.createdAt, order: .reverse) private var items: [InboxItem]

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
            }
        }
        .navigationTitle("Inbox")
    }
}

private struct InboxRow: View {
    let item: InboxItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(item.text)
                .font(.body)
                .lineLimit(2)

            Text(item.createdAt, style: .date)
                .font(.caption)
                .foregroundStyle(.secondary)
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

                Text(item.text)
                    .font(.body)
                    .textSelection(.enabled)

                Spacer(minLength: 0)
            }
            .padding()
        }
        .navigationTitle("Item")
        .navigationBarTitleDisplayMode(.inline)
    }
}

