# Life-OS

Life-OS is a personal productivity platform designed to help you organize and manage your work, ideas, and tasks in one unified system.

## Overview

The Life-OS home page provides access to four core modules, each serving a distinct purpose in your workflow:

### 1. AI Chat

AI Chat allows users to chat with different AI models for brainstorming, knowledge gathering, learning, or just having fun. Interact with various AI assistants to explore ideas, get answers to questions, and enhance your creative process.

### 2. Projects

Projects is meant to manage projects that you are trying to work on currently or in the future. Keep track of your active work, plan upcoming initiatives, and organize your professional and personal endeavors.

### 3. Tasks

Tasks are just tasks. A straightforward task management system to help you stay organized and track what needs to be done.

### 4. Notes

Notes are just notes. A simple note-taking system for capturing thoughts, ideas, and information as you work.

## Features

### AI Chat

#### Thread Management

- Multi-thread conversations with thread list and selection
- Create new thread and archive current thread
- Thread search appears when there are more than 5 threads
- Active thread is persisted in the URL (`threadId`) and corrected if invalid
- Streaming indicator per thread in the list

#### Streaming AI Responses

- SSE streaming via `/api/chat/stream`
- Stop generation button while streaming
- Streaming content stays visible until DB-backed message arrives
- Fallback to blocking mutation on stream failure, with error banner

#### Chat Input and Keyboard UX

- Auto-resizing textarea (up to 200px)
- Enter to send, Shift+Enter for newline, Cmd/Ctrl+Enter supported
- Disabled when no active thread or pending request
- Draft can be injected via `chatDraft` URL param

#### Model Selection

- Model picker with auto-routing option
- Models grouped by cost tier and provider (OpenAI, Anthropic, Google, xAI)
- Shows model/provider in header and message footer

#### Message List UX

- Infinite scroll for older messages (fetch on top)
- Auto-scroll to bottom unless user scrolls up
- Keyboard navigation with up/down arrows focuses messages
- Optimistic user message while streaming; message status indicators

#### Task Integration

- Assistant messages parse task JSON blocks into "Proposed Tasks"
- Expandable review panel
- Approve single task or approve all
- Success/error feedback and retry
- Task creation invalidates task and message lists

#### Note Integration

- "Save to Notes" button on assistant messages
- Removes JSON blocks and derives title from first line
- Status states: saving/saved/error

### Projects

#### Header Overview

- Project icon, name, last-updated timestamp
- Status + priority badges, due date
- Tags (first 3 + overflow count) and color chip
- Edit button opens the full edit dialog

#### Edit Project Dialog

- Edit name, description, status, tags, due date, priority, emoji, and color
- Primary statuses + "More" statuses dropdown
- Tag chips with remove
- Validation, error feedback, and save/cancel actions

#### Tabbed Layout + Routing

- Tabs: Overview, Tasks, (Chat), Artifacts
- URL-synced tab state and analytics event tracking
- Smooth panel transitions

#### Overview Tab Content

- Task progress summary (percent ring + counts by status)
- Project description with created/updated dates
- System context card (read + inline edit)
- Status history timeline

#### System Context Card

- Dedicated "system context" text (used elsewhere in app)
- Inline edit with save/cancel and error handling
- Locked indicator

#### Status Timeline

- Ordered list of status changes with timestamps
- Empty state if no history

#### Tasks Tab

- Kanban board with drag-and-drop (status + ordering)
- Backlog list view + Archived list view
- Search + priority filter
- Create/edit/delete tasks via panel
- Bulk select + bulk status change bar
- Quick status changes
- "Brainstorm" hook to open/create a task-specific thread

#### Notes Tab

- Create/edit/delete Notes
- Search + type filter
- Notes preview modal
- Upload handling + error state
- Dedicated "System context" Note block (create/edit, locked)

## Future Expansion

The interactions between these modules and their expanded functionality will be documented and implemented as the project evolves. Each module is designed to work independently while also integrating seamlessly with the others to create a cohesive productivity experience.

## Commit Standard

This repo enforces commit messages in the format:

`<type>(<scope>[,<scope>...]): <one-line description>`

with a required body section for execution details.

Setup once per clone:

```bash
bun run commit:setup
```

See `/docs/commit-standard.md` for allowed types/scopes and examples.
