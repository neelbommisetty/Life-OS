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
    var createdAt: Date
    var text: String

    init(id: UUID = UUID(), createdAt: Date = Date(), text: String) {
        self.id = id
        self.createdAt = createdAt
        self.text = text
    }
}
