/**
 * Formats a duration in minutes for display, e.g. 30 -> "30 min", 90 -> "1 h 30 min".
 */
export function formatDuration(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new RangeError(`Invalid duration: ${minutes}`);
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}
