import XCTest
@testable import Life_OS

final class BrandCopyTests: XCTestCase {
    func testBrandDescriptionMatchesSharedProductFraming() {
        XCTAssertEqual(
            Brand.Descriptions.app,
            "Life-OS organizes tasks, notes, and conversations into a clear plan you can review and act on."
        )
    }

    func testBrandTermStatusKeepsLibraryUnderReview() {
        XCTAssertEqual(Brand.TermStatus.assistant.rawValue, "approved")
        XCTAssertEqual(Brand.TermStatus.inbox.rawValue, "approved")
        XCTAssertEqual(Brand.TermStatus.library.rawValue, "under_review")
        XCTAssertEqual(Brand.TermStatus.plan.rawValue, "approved")
    }

    func testCouldntUsesDefaultFallbackCopy() {
        XCTAssertEqual(Brand.couldnt("save that change"), "Couldn't save that change. Please try again.")
    }

    func testCouldntIncludesSafeStateAndNextStep() {
        XCTAssertEqual(
            Brand.couldnt(
                "read the server response",
                safeState: "Your data is unchanged",
                nextStep: "Please try again in a moment"
            ),
            "Couldn't read the server response. Your data is unchanged. Please try again in a moment."
        )
    }

    func testNetworkErrorDescriptionsUseAlignedFallbackCopy() {
        XCTAssertEqual(AppNetworkError.invalidURL.errorDescription, "Couldn't connect. Check the app connection settings.")
        XCTAssertEqual(
            AppNetworkError.invalidResponse.errorDescription,
            "Couldn't read the server response. Your data is unchanged. Please try again in a moment."
        )
        XCTAssertEqual(
            AppNetworkError.invalidBody.errorDescription,
            "Couldn't send that request. Your data is unchanged. Please try again."
        )
    }
}
