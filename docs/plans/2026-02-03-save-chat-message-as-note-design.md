# Save Chat Message As Note Design

Date: 2026-02-03

## Summary
Add a "Save as note" action to assistant message bubbles that creates a note from the message content. The note is associated with the chat thread's project when present; otherwise it is unassigned. If a message was already saved, the UI shows "Saved as note" instead of the CTA.

## Goals
- Save assistant messages as notes with consistent project linkage.
- Persist bidirectional metadata: `ChatMessage.savedNoteId` and `Note.sourceMessageId`.
- Show saved state per message without extra client-side lookups.
- Keep UI small and consistent with existing bubble metadata actions.

## Non-goals
- Editing the saved note from the chat UI.
- Saving user or system messages.

## Data Model Changes
- `ChatMessage.savedNoteId?: String` (nullable, indexed).
- `Note.sourceMessageId?: String` (nullable, indexed).

No unique constraint is added to avoid conflicts with soft deletes.

## Server Actions
### `saveMessageAsNote({ messageId })`
- Validate auth and message ownership via the message's thread.
- Require `message.role === ASSISTANT`.
- Check for an existing, non-deleted note with `sourceMessageId = messageId`.
  - If found, ensure `ChatMessage.savedNoteId` points to it and return `{ note, alreadySaved: true }`.
- If not found, create a note:
  - `title`: first non-empty line of message content (clamped to 500 chars).
  - `content`: full message content.
  - `projectId`: from `thread.projectId` if present.
  - `sourceMessageId`: message ID.
  - Update `ChatMessage.savedNoteId` with the new note ID.
  - Return `{ note, alreadySaved: false }`.

### `deleteNote`
- If the note has `sourceMessageId`, clear `ChatMessage.savedNoteId` when it matches the deleted note ID.

## Chat Messages API
- `listMessages` will return `ChatMessage.savedNoteId` directly, no extra query needed.

## UI/UX
- Add a "Save as note" button to assistant message metadata.
- When `savedNoteId` is present, show a non-clickable "Saved as note" label instead of the CTA.
- On success: toast "Note saved"; on error: toast "Failed to save note".

## Error Handling
- Reject when message not found, not owned, or not assistant role.
- Idempotent if already saved.

## Testing
- Unit test `saveMessageAsNote` for:
  - Creates note and sets both metadata fields.
  - Returns alreadySaved for existing note.
  - Rejects non-assistant or unauthorized messages.
- Unit test `deleteNote` clears `ChatMessage.savedNoteId`.
- Verify `listMessages` includes `savedNoteId`.

## Rollout
- No migration backfill required. Existing messages will have `savedNoteId` null until saved.
