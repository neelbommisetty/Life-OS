# Frontend UX Review: Project OS

A comprehensive review of the Next.js 16 frontend focusing on UX improvements, code simplification, library optimizations, and future optimization strategies.

---

## 1. UX Improvements by Page

### Home Page (`src/app/page.tsx`)

**Current Issues:**
- Static welcome message ("Good morning, maker") lacks personalization
- Stats grid shows raw numbers without context (no trends, percentages, or comparisons)
- "Recent Activity" section is just a grid of cards with no temporal context or action prompts
- No quick actions for the user's most common workflows (e.g., "Continue where you left off")

**Suggested Improvements:**

| Issue | Recommendation | Impact |
|-------|----------------|--------|
| **Empty state is boring** | Replace generic text with personalized onboarding tips or AI-generated project suggestions | High |
| **Stats lack meaning** | Add sparklines or trend indicators (+2 this week), show % complete for "In Progress" | Medium |
| **No actionable insights** | Add "Continue working on..." card showing last edited project with last activity time | High |
| **Missing quick actions** | Add command palette (Cmd+K) for quick project creation/navigation | Medium |
| **No search on home** | Add global search bar for projects, tasks, artifacts | Medium |

**Mockup Concept:**
```
┌─────────────────────────────────────────────────────┐
│ 👋 Welcome back! You have 3 tasks due this week    │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │
│ │ Project A   │ │ In Progress │ │ Due Soon    │    │
│ │ Continue    │ │ 5 projects  │ │ 3 tasks     │    │
│ └─────────────┘ └─────────────┘ └─────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

### Projects List (`src/app/projects/projects-client.tsx`)

**Current Issues:**
- No sorting options (by date, status, priority)
- Fixed "6 recent" limit is arbitrary
- Status filter exists but is not prominently placed
- No grid/list view toggle

**Suggested Improvements:**
- Add sort dropdown (Last Updated, Name, Priority, Due Date)
- Add view toggle (Grid/List/Compact)
- Make filter persist in URL for shareable links
- Add "pinned projects" feature for favorites

---

### Project Detail (`src/app/projects/[id]/project-detail.tsx`)

**Current Issues:**
- Overview tab feels sparse with just description + status history
- System context card is disconnected from main content
- No visual progress indicator
- Tabs don't remember position on refresh (they do via URL but transition feels jarring)
- The brainstorm drawer is a floating action—users might not discover it

**Suggested Improvements:**

| Issue | Recommendation | Impact |
|-------|----------------|--------|
| **Sparse overview** | Add progress ring showing task completion %, key milestones, or timeline | High |
| **Hidden AI feature** | Make AI chat a first-class tab instead of hidden drawer | Critical |
| **No quick stats** | Show task breakdown (X todo, Y done) in overview | Medium |
| **System context buried** | Integrate into AI chat tab or make collapsible inline | Medium |

> [!IMPORTANT]
> Since AI chat is your primary feature, consider making it the **default tab** or showing it in a persistent sidebar rather than a drawer.

---

### AI Chat (`src/components/projects/project-chat.tsx`)

**Current Issues:**
- 656 lines—hard to maintain and test
- Empty state is bland ("Start a conversation")
- Thread selector is not prominent
- Model selector is small and bottom-positioned
- No typing indicators for long responses
- No message search/filter
- Task creation flow is good but could show inline preview before confirming

**UX Improvements:**

| Issue | Recommendation | Impact |
|-------|----------------|--------|
| **Empty state** | Add prompt suggestions: "Generate tasks for this project", "Summarize project status", "What should I work on next?" | Critical |
| **Messages feel static** | Add subtle entrance animations (already using framer-motion) | Low |
| **No context awareness** | Show current project context in chat header | Medium |
| **Thread management** | Add thread search for projects with many threads | Medium |
| **Task preview** | Show task cards as collapsible previews before approval | High |

---

### Task Board (`src/components/projects/project-tasks-board.tsx`)

**Current Issues:**
- Loading state is just text ("Loading tasks...")
- No keyboard shortcuts for power users
- Drag overlay lacks visual polish (no shadow/scale)
- Quick status change requires opening panel

**Suggested Improvements:**
- Add skeleton loaders matching column layout
- Add keyboard shortcuts (N = new task, E = edit, Arrows to navigate)
- Enhance drag overlay with scale and shadow
- Add right-click context menu for quick actions
- Add bulk selection for archiving/status changes

---

### Artifacts (`src/components/projects/project-artifacts.tsx`)

**Current Issues:**
- 1016+ lines—needs decomposition urgently
- Preview modal is separate from edit panel (inconsistent)
- No drag-and-drop file upload
- Search/filter is good but type filter could be chips instead of dropdown

**Suggested Improvements:**
- Decompose into `ArtifactList`, `ArtifactPanel`, `ArtifactPreview`, `ArtifactCard`
- Add drag-and-drop upload area
- Show inline preview for links (unfurl URLs)
- Add "generated by AI" badge for artifacts saved from chat

---

## 2. Unnecessary Abstractions to Simplify

### State Management Overhead

**Issue:** Heavy use of URL state (`useUrlState`, `pushUrl`, `replaceUrl`) for transient UI state.

**Files affected:**
- `project-chat.tsx` (thread selection)
- `project-tabs.tsx` (tab selection)
- `project-tasks-board.tsx` (view mode)

**Recommendation:**
- Keep URL state for **shareable** state (current tab, current thread)
- Use local state for **ephemeral** state (search input, filter dropdowns before apply)
- Consider creating a lightweight `useSearchParamState` hook that auto-syncs

```typescript
// Simplified hook
const [threadId, setThreadId] = useSearchParamState('threadId');
```

---

### Over-Abstracted Theming

**Issue:** `getProjectTheme()` returns a CSSProperties object and `hasAccentColor` is computed separately. This pattern is repeated across 10+ components.

**Files affected:** Most project-related components

**Current pattern:**
```typescript
const themeStyle = getProjectTheme(accentColor);
const hasAccentColor = !!accentColor && Object.keys(themeStyle).length > 0;
```

**Simplified approach:**
```typescript
// New hook
function useProjectTheme(accentColor: string | null | undefined) {
  return useMemo(() => {
    const style = getProjectTheme(accentColor);
    return {
      style,
      hasColor: !!accentColor && Object.keys(style).length > 0,
      accentClass: accentColor ? 'text-[rgb(var(--project-accent))]' : 'text-primary',
    };
  }, [accentColor]);
}
```

---

### Redundant Mutation Boilerplate

**Issue:** Every component manually calls `utils.*.invalidate()` or `utils.*.setData()` after mutations.

**Example pattern repeated everywhere:**
```typescript
const updateTask = api.task.update.useMutation({
  onSuccess: (updated) => {
    const next = tasks.map((task) => (task.id === updated.id ? updated : task));
    syncTasks(next);
  },
});
```

**Recommendation:** Consider tRPC's `onSettled` with automatic cache invalidation at the router level, or create a `useManagedMutation` wrapper.

---

### Date Formatting Duplication

**Issue:** `formatDate()` from `project-utils.ts` and `Intl.DateTimeFormat` are used inconsistently.

**Recommendation:** Standardize on one approach—create `formatDateTime()`, `formatRelativeTime()`, and use consistently.

---

## 3. Library-Based Improvements

### Headless UI → Native Dialog/Transitions

**Current:** Heavy use of `@headlessui/react` for dialogs, transitions, tabs.

**Opportunity:**
- React 18+ has native `<dialog>` support
- Consider Radix UI for more composable primitives (especially for dropdowns, popovers)
- Tailwind's new `peer` and `group` modifiers can replace some transition logic

**Keep Headless UI for:** Tabs, Disclosure (accordion), Listbox (select)
**Consider replacing for:** Dialog (native `<dialog>` + simple animation)

---

### Framer Motion Optimization

**Current usage:** `motion.div` for simple fade/slide animations

**Recommendations:**
1. Use CSS transitions for simple opacity/transform (no JS needed)
2. Keep Framer Motion for:
   - `layoutId` animations (tab indicator)
   - Complex gesture-based interactions
   - Staggered list animations

**Quick win:** Replace simple fade-in cards with CSS:
```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in { animation: fadeIn 0.3s ease-out; }
```

---

### dnd-kit Simplification

**Current:** Using `@dnd-kit/core` + `@dnd-kit/sortable`

**Observation:** Implementation in `project-tasks-board.tsx` is solid. Keep as-is.

**Minor improvement:** Add touch device detection to adjust activation constraints:
```typescript
const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: { distance: isTouchDevice ? 8 : 4 },
  })
);
```

---

### React Markdown Alternatives

**Current:** `react-markdown` + 4 rehype/remark plugins

**Consider:** For AI chat where you control the output format, a lighter solution:
- `marked` + `DOMPurify` for simpler cases
- Keep `react-markdown` but lazy-load the plugins

---

### React Query / tRPC Patterns

**Current patterns are solid.** A few improvements:

1. **Use `staleTime` for static-ish data:**
```typescript
const modelsQuery = api.chat.listModels.useQuery(undefined, {
  staleTime: 1000 * 60 * 5, // Models don't change often
});
```

2. **Use `placeholderData` for instant perceived performance:**
```typescript
const projectQuery = api.project.getById.useQuery({ id }, {
  placeholderData: (prev) => prev, // Keep showing old data while refetching
});
```

---

## 4. Future Optimization Options with Graceful Fallbacks

### A. Optimistic Updates (Priority: High)

**Where to apply:**
- Task status changes (drag & drop already does this ✓)
- Message sending (show optimistic message immediately)
- Artifact creation (show skeleton card)

**Pattern:**
```typescript
const sendMessage = useMutation({
  onMutate: (variables) => {
    // Add optimistic message
    utils.chat.listMessages.setData({ threadId }, (old) => [
      ...old,
      { id: 'temp', content: variables.content, role: 'USER', pending: true }
    ]);
  },
  onError: (_, __, context) => {
    // Rollback on error, show "retry" button
  },
  onSettled: () => {
    // Refetch to get real data
    utils.chat.listMessages.invalidate();
  },
});
```

**Graceful fallback:** Show "Sending..." indicator and "Retry" on failure

---

### B. Streaming Improvements (Priority: High)

**Current:** Already using SSE streaming for AI responses ✓

**Enhancements:**
- Add connection status indicator (connected/reconnecting)
- Implement exponential backoff for reconnection
- Cache partial responses for network interruptions

**Graceful fallback:** Show "Connection lost. Reconnecting..." banner with manual retry button

---

### C. Suspense Boundaries (Priority: Medium)

**Pattern:**
```tsx
<Suspense fallback={<ProjectHeaderSkeleton />}>
  <ProjectHeader project={project} />
</Suspense>
<Suspense fallback={<TabsSkeleton />}>
  <ProjectTabs ... />
</Suspense>
```

**Benefit:** Each section loads independently, reduces blocking

**Graceful fallback:** Use the existing skeleton components you already have (`loading.tsx`)

---

### D. Service Worker for Offline (Priority: Low, Future)

**Features:**
- Cache project list for offline viewing
- Queue task updates while offline
- Show "offline mode" indicator

**Graceful fallback:**
```tsx
{isOffline && (
  <Banner variant="warning">
    You're offline. Changes will sync when reconnected.
  </Banner>
)}
```

---

### E. Code Splitting (Priority: Medium)

**Current:** All components load with the page

**Opportunities:**
```tsx
// Lazy load modals
const CreateProjectDialog = dynamic(
  () => import('@/components/projects/create-project-dialog'),
  { loading: () => <DialogSkeleton /> }
);

// Lazy load tab content
const ProjectArtifacts = dynamic(
  () => import('@/components/projects/project-artifacts'),
  { ssr: false }
);
```

**Benefit:** Faster initial page load (artifacts tab rarely viewed first)

---

### F. Image Optimization (Priority: Low)

**Current:** Using UploadThing URLs directly

**Improvement:**
- Add `next/image` for artifact images
- Use blur placeholders
- Implement lazy loading for artifact thumbnails

---

## 5. Component Decomposition Recommendations

### High Priority Decomposition

| File | Lines | Suggested Split |
|------|-------|-----------------|
| `project-artifacts.tsx` | 1016 | `ArtifactList`, `ArtifactForm`, `ArtifactPreview`, `ArtifactCard`, `useArtifacts` hook |
| `project-chat.tsx` | 656 | `ChatInput`, `ChatMessages`, `ChatHeader`, `StreamingMessage` |
| `edit-project-dialog.tsx` | 500+ | `ProjectForm`, `ProjectFormFields`, reuse with create dialog |
| `create-project-dialog.tsx` | 422 | Share form with edit dialog |
| `message-bubble.tsx` | 389 | `TaskProposalCard`, `MessageContent`, `MessageMeta` |
| `project-tasks-board.tsx` | 482 | Already well-decomposed with `task-board/` folder ✓ |

---

## Summary: Priority Matrix

| Category | Quick Wins (1-2 days) | Medium Effort (1 week) | Larger Refactors |
|----------|----------------------|------------------------|------------------|
| **UX** | Add prompt suggestions to empty chat state | Make AI chat a first-class tab | Home page redesign with insights |
| **Simplify** | Create `useProjectTheme` hook | Merge create/edit project dialogs | Decompose artifacts component |
| **Libraries** | Add `staleTime` to static queries | Replace simple animations with CSS | Lazy load tab content |
| **Optimization** | Add optimistic updates to tasks | Add Suspense boundaries | Service worker for offline |

---

## Next Steps

1. **Which areas would you like me to prioritize?**
2. **Should I create detailed implementation plans for specific items?**
3. **Are there any specific pain points you've experienced that I should focus on?**
