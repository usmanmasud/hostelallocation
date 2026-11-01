export const DAY_MS = 24 * 60 * 60 * 1000;

export function nowIso(now = new Date()) {
  return now.toISOString();
}

export function daysBetween(fromIso, to = new Date()) {
  return (to.getTime() - new Date(fromIso).getTime()) / DAY_MS;
}
