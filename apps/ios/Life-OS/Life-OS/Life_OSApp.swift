//
//  Life_OSApp.swift
//  Life-OS
//
//  Created by Neel Bommisetty on 2/2/26.
//

import SwiftUI
import Sentry

import SwiftData

@main
struct Life_OSApp: App {
    init() {
        SentrySDK.start { options in
            options.dsn = "https://4a6fd1bb38eaecf44fb5752d9e028157@o4510879407734784.ingest.us.sentry.io/4510879460425728"

            // Adds IP for users.
            // For more information, visit: https://docs.sentry.io/platforms/apple/data-management/data-collected/
            options.sendDefaultPii = false

            // Set tracesSampleRate to 1.0 to capture 100% of transactions for performance monitoring.
            // We recommend adjusting this value in production.
            options.tracesSampleRate = 1.0

            // Configure profiling. Visit https://docs.sentry.io/platforms/apple/profiling/ to learn more.
            options.configureProfiling = {
                $0.sessionSampleRate = 1.0 // We recommend adjusting this value in production.
                $0.lifecycle = .trace
            }

            // Uncomment the following lines to add more data to your events
            // options.attachScreenshot = true // This adds a screenshot to the error events
            // options.attachViewHierarchy = true // This adds the view hierarchy to the error events
            
            // Enable experimental logging features
            options.experimental.enableLogs = true
        }
        // Remove the next line after confirming that your Sentry integration is working.
        SentrySDK.capture(message: "This app uses Sentry! :)")
    }
    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            InboxItem.self,
            Item.self,
        ])
        let modelConfiguration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)

        do {
            return try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(sharedModelContainer)
    }
}
