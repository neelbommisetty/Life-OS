# Tasks: Server-Side Archive Search

**App:** Tasks

**Problem**
Archived Tasks search is client-side only, so large archives require loading everything before filtering, which is slow and feels unresponsive.

**Idea**
Move Archived Tasks search to the server action with a query parameter and return filtered results, keeping payloads small and results fast even as archives grow.

**Proposed UX**
Typing in the search field shows a lightweight loading state and updates the results list from the server. Empty search returns the default archive list. No-results states remain clear and immediate.

**Implementation Sketch**
Update `listArchivedTasks` to accept an optional `search` string and apply a `contains` filter on task title (case-insensitive). In `archive-client.tsx`, debounce search input and call the server action with the query, replacing client-side filtering. Optionally cap results to a reasonable limit (e.g., 50) to keep payloads small.

**Effort**
Small.

**Success Criteria**
Searching archived tasks completes in under 1 second for large archives and returns at most a small capped set of results without noticeable UI jank.

**Edge Cases**
Empty search, special characters in search input, no results, and archived tasks that are deleted vs. completed should all behave consistently.
