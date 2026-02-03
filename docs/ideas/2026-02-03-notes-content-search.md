# Notes: Content-Aware Search

**App:** Notes

**Problem**
The Notes sidebar search only matches note titles, which makes it hard to find notes based on remembered phrases or content. This is a frequent “I know it’s in there” failure case and adds friction when notes scale.

**Idea**
Upgrade search to match both title and content, and show a short content snippet in results when the match is from body text. Keep the UI lightweight and fast, but make the search immediately more useful without adding new concepts.

**Proposed UX**
- Search input stays in the Notes list.
- Results match title or content.
- Each result shows a 1-line snippet with the matched phrase when the match is from content.
- Optional: show a subtle “content match” badge (e.g., `Content`) so users understand why a note surfaced.

**Implementation Sketch**
- Add a `search` parameter to `listNotes` to allow server-side filtering on `title` OR `content`.
- Use a simple `contains`/`ilike` (case-insensitive) for MVP. Consider Postgres full-text later if needed.
- Return a lightweight `snippet` field for each result (server-side substring around the match) to avoid client-side parsing.
- Update `NoteSelector` to display snippet beneath the title when present.

**Effort**
Small-to-medium. Requires changes in notes actions, query logic, and the list UI. No schema change needed for MVP.

**Success Criteria**
- Users can find notes by content phrases.
- Reduced “no results” cases when the content matches.
- Search remains fast for typical note counts.

**Edge Cases**
- Very long notes should still return a short, safe snippet.
- No snippet if the title matched and content did not.
- If content is empty, title-only behavior remains unchanged.
