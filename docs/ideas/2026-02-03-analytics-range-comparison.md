# Analytics: Range Selector + Period Comparison

**App:** Analytics

**Problem**
Analytics is locked to the last 30 days, so users cannot quickly inspect short-term spikes or compare performance across different time windows.

**Idea**
Add a date-range selector with presets (7/30/90 days) and show a comparison against the previous period for key summary metrics. This keeps the existing layout but makes analytics actionable for weekly and monthly reviews.

**Proposed UX**
Add a compact range dropdown in the page header. Summary cards show the selected range plus a small delta (percent change) versus the previous period. Tables and recent activity are filtered to the selected range. Default remains 30 days.

**Implementation Sketch**
Add a `rangeDays` query param and surface it in the analytics page. Update `getUsageSummary` and `getRecentAiCalls` to accept the selected range and fetch the prior period totals for deltas. Extend the summary payload with `previousTotals` and compute deltas in the UI. Guard invalid ranges by falling back to 30 days.

**Effort**
Medium.

**Success Criteria**
Users can switch to 7/30/90-day views and see clear deltas on totals; support questions about “last week vs last month” drop.

**Edge Cases**
No data in range; previous period totals are zero; invalid range query values; very large ranges default to 90 days.
