# Life OS Design System Guidelines

This document outlines the design patterns and usage guidelines for the Life OS platform.

## 1. Color System

### Usage
- **Primary**: Use for main actions, active states, and branding elements.
- **Secondary**: Use for complementary actions, badge backgrounds, and secondary information.
- **Accent**: Use sparingly for highlights, special call-outs, and focus areas.
- **Semantic Colors**:
  - `success`: Confirmations, positive status.
  - `warning`: Cautions, pending status.
  - `info`: Helpful information, neutral status.
  - `destructive`: Irreversible actions, errors.

### Light & Dark Mode
Life OS supports both modes. Use semantic tokens (e.g., `--background`, `--foreground`) instead of hardcoded hex/hsl values to ensure consistency.

## 2. Typography

### Scale
Use the CSS variables for consistent font sizes:
- `h1` to `h6` are automatically styled.
- Use `var(--text-base)` for standard body text.
- Use `var(--text-sm)` for secondary content/captions.

### Weights
- **Normal (400)**: Default body text.
- **Medium (500)**: Secondary headings, buttons.
- **Semi-Bold (600)**: Card titles, small headings.
- **Bold (700)**: Main headings.

## 3. Spacing

Always use the base-4 system for margins, padding, and gaps:
- `p-4` (16px) is the default internal padding for containers.
- `gap-4` (16px) is the default gap between flex/grid items.
- `m-8` (32px) is the default gap between major sections.

Semantic tokens available in CSS:
- `--spacing-component-gap`: 8px (between related elements)
- `--spacing-section-gap`: 32px (between sections)
- `--spacing-page-padding`: 24px (page edge padding)

## 4. Components

### Buttons
- Use `variant="default"` for primary actions.
- Use `variant="outline"` or `variant="ghost"` for secondary/tertiary actions.
- Buttons should have a `rounded-4xl` (pill) shape as per our branding.

### Cards
- Use `rounded-2xl` for cards.
- Default internal padding: `px-6 py-6`.

### Inputs
- Use `rounded-4xl` for form inputs to match button styling.
- Ensure labels are always present for accessibility.

## 5. Accessibility

- **Focus**: Never disable focus rings. Our default ring is `3px hsla(252, 55%, 58%, 0.5)`.
- **Contrast**: Maintain a minimum contrast ratio of 4.5:1 for body text.
- **Touch**: Keep touch targets (buttons, links) at least 44px in height where possible.
