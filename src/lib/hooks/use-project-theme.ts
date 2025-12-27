import { useMemo } from 'react';
import { getProjectTheme } from '@/lib/project-theme';

export function useProjectTheme(accentColor?: string | null) {
  return useMemo(() => {
    const style = getProjectTheme(accentColor);
    const hasColor = !!accentColor && Object.keys(style).length > 0;

    return {
      style,
      hasColor,
      // Helper for classes that need the accent color reference
      accentTextColor: hasColor ? 'text-[rgb(var(--project-accent))]' : 'text-primary',
      accentBgColor: hasColor ? 'bg-[rgb(var(--project-accent))]' : 'bg-primary',
    };
  }, [accentColor]);
}
