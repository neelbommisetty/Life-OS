/**
 * Converts a hex color string (e.g. "#3b82f6" or "3b82f6") into
 * CSS variable compatible RGB values ("59 130 246").
 */
export function hexToRgb(hex: string): string | null {
  const cleanHex = hex.replace("#", "");

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
 * Calculates the relative luminance of an RGB color (0-1 scale).
 * Uses the WCAG formula for relative luminance.
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((val) => {
    const v = val / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Determines if a color is light or dark based on its luminance.
 * Returns "255 255 255" (white) for dark colors, "0 0 0" (black) for light colors.
 */
function getForegroundRgb(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "255 255 255"; // Default to white

  const [r, g, b] = rgb.split(" ").map(Number);
  const luminance = getLuminance(r, g, b);

  // Use white text on dark backgrounds (luminance < 0.5), black on light backgrounds
  return luminance < 0.5 ? "255 255 255" : "0 0 0";
}

/**
 * Returns a style object containing CSS variables for the project accent color
 * and its computed foreground color (for AA contrast).
 * Use this on the root element of the component you want to theme.
 *
 * Usage:
 * <div style={getProjectTheme(project.color)}>...</div>
 *
 * Then in Tailwind:
 * border-[rgb(var(--project-accent)/0.2)]
 * text-[rgb(var(--project-accent))]
 * text-[rgb(var(--project-accent-foreground))] (for text on accent backgrounds)
 */
export function getProjectTheme(color?: string | null) {
  if (!color) return {};

  const rgb = hexToRgb(color);
  if (!rgb) return {};

  const foregroundRgb = getForegroundRgb(color);

  return {
    "--project-accent": rgb,
    "--project-accent-foreground": foregroundRgb,
  } as React.CSSProperties;
}
