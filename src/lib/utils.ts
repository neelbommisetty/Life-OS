import { clsx, type ClassValue } from "clsx"
import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  format,
} from "date-fns"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a date as a relative time string using date-fns
 * - Under 1 min: "Now"
 * - Under 1 hour: "Xm"
 * - Under 24 hours: "Xh"
 * - Under 7 days: "Xd"
 * - Older: "Jan 15" (date format)
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date()
  const minutes = differenceInMinutes(now, date)
  const hours = differenceInHours(now, date)
  const days = differenceInDays(now, date)

  if (minutes < 1) return "Now"
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return format(date, "MMM d")
}
