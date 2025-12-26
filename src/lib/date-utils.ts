/**
 * Coerces a string or null value into a Date object, undefined, or null.
 * Useful for handling date inputs from forms or API requests.
 */
export const coerceDate = (value?: string | null) => {
  if (value === null) return null;
  return value ? new Date(value) : undefined;
};
