//
//  InboxItem.swift
//  Life-OS
//
//  Created by Neel Bommisetty on 2/2/26.
//

import Foundation
import SwiftData

@Model
final class InboxItem: Identifiable {
    @Attribute(.unique) var id: UUID
    @Attribute(.unique) var serverId: String?
    var content: String = ""
    var state: String = InboxItemState.saved.rawValue
    var createdAt: Date
    var updatedAt: Date?
    var syncStatus: String = InboxItemSyncStatus.synced.rawValue
    var lastSyncError: String?

    var localId: UUID { id }

    init(
        localId: UUID = UUID(),
        serverId: String? = nil,
        content: String,
        state: String = InboxItemState.saved.rawValue,
        createdAt: Date = Date(),
        updatedAt: Date? = nil,
        syncStatus: String = InboxItemSyncStatus.synced.rawValue,
        lastSyncError: String? = nil
    ) {
        id = localId
        self.serverId = serverId
        self.content = content
        self.state = state
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.syncStatus = syncStatus
        self.lastSyncError = lastSyncError
    }
}
