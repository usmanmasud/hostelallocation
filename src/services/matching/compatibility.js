import { PREFERENCE_QUESTIONS } from '../../lib/constants.js';

/**
 * The criteria two students are compared on: course of study (from the student profile)
 * followed by every lifestyle question on the preference form.
 */
export const CRITERIA = Object.freeze([
  { key: 'course', label: 'Course of study' },
  ...PREFERENCE_QUESTIONS.map(({ key, label }) => ({ key, label })),
]);

function normalise(value) {
  return value == null ? null : String(value).trim().toLowerCase();
}

/**
 * Compares two profiles criterion by criterion (section 3.3.5, Table 3.2).
 * A criterion matches when both students gave the same answer; a missing answer never matches.
 * The score is the percentage of criteria that match.
 */
export function compareProfiles(a, b, criteria = CRITERIA) {
  const breakdown = criteria.map(({ key, label }) => {
    const left = normalise(a[key]);
    const right = normalise(b[key]);
    return { key, label, a: a[key] ?? null, b: b[key] ?? null, match: left !== null && left === right };
  });
  const matched = breakdown.filter((item) => item.match).length;
  const total = criteria.length;
  return { matched, total, score: total === 0 ? 0 : (matched / total) * 100, breakdown };
}

export function compatibilityScore(a, b, criteria = CRITERIA) {
  return compareProfiles(a, b, criteria).score;
}

/** Builds a comparable profile from a database row holding profile and preference columns. */
export function profileFromRow(row) {
  const profile = { course: row.course };
  for (const { key, column } of PREFERENCE_QUESTIONS) profile[key] = row[column] ?? null;
  return profile;
}

/** A student's own score: the mean of their compatibility with each roommate, or null if alone. */
export function personalScore(profile, roommates, criteria = CRITERIA) {
  if (roommates.length === 0) return null;
  const sum = roommates.reduce((total, other) => total + compatibilityScore(profile, other, criteria), 0);
  return Math.round((sum / roommates.length) * 10) / 10;
}
