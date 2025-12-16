/**
 * Converts a hex color string (e.g. "#3b82f6" or "3b82f6") into
 * CSS variable compatible RGB values ("59 130 246").
 */
export function hexToRgb(hex: string): string | null {
  const cleanHex = hex.replace('#', '');

  // Handle short hex: #abc -> #aabbcc
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16);
    const g = parseInt(cleanHex[1] + cleanHex[1], 16);
    const b = parseInt(cleanHex[2] + cleanHex[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return `${r} ${g} ${b}`;
  }

  // Handle full hex: #aabbcc
  if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return `${r} ${g} ${b}`;
  }

  return null;
}

/**
 * Returns a style object containing the CSS variable for the project accent color.
 * Use this on the root element of the component you want to theme.
 *
 * Usage:
 * <div style={getProjectTheme(project.color)}>...</div>
 *
 * Then in Tailwind:
 * border-[rgb(var(--project-accent)/0.2)]
 * text-[rgb(var(--project-accent))]
 */
export function getProjectTheme(color?: string | null) {
  if (!color) return {};

  const rgb = hexToRgb(color);
  if (!rgb) return {};

  return {
    '--project-accent': rgb,
  } as React.CSSProperties;
}

