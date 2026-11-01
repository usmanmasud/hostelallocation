import { config } from '../config.js';
import * as constants from './constants.js';

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: config.timezone });
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: config.timezone,
});
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const RELATIVE_UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const BADGE_TONES = {
  pending: 'warning',
  in_progress: 'info',
  escalated: 'danger',
  resolved: 'success',
  paid: 'success',
  unpaid: 'danger',
  sent: 'success',
  logged: 'info',
  queued: 'warning',
  failed: 'danger',
};

/** Helpers and constants available in every template. */
export const viewHelpers = {
  ...constants,

  formatDate(iso) {
    return iso ? dateFormat.format(new Date(iso)) : '—';
  },

  formatDateTime(iso) {
    return iso ? dateTimeFormat.format(new Date(iso)) : '—';
  },

  timeAgo(iso) {
    if (!iso) return '—';
    const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
    for (const [unit, size] of RELATIVE_UNITS) {
      if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
    }
    return 'just now';
  },

  /** How long ago `iso` was, as a plain duration such as "3 days, 4 hours". */
  durationSince(iso) {
    const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
    if (hours < 1) return 'less than an hour';
    const days = Math.floor(hours / 24);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    if (days === 0) return plural(hours, 'hour');
    return hours % 24 ? `${plural(days, 'day')}, ${plural(hours % 24, 'hour')}` : plural(days, 'day');
  },

  money(amount, currency = 'NGN') {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount ?? 0);
  },

  score(value) {
    return value == null ? '—' : `${Math.round(value)}%`;
  },

  scoreTone(value) {
    if (value == null) return 'neutral';
    if (value >= 70) return 'success';
    if (value >= 40) return 'warning';
    return 'danger';
  },

  badgeTone(status) {
    return BADGE_TONES[status] ?? 'neutral';
  },

  roleLabel(role) {
    return constants.ROLE_LABELS[role] ?? role;
  },

  optionLabel(questionKey, value) {
    const question = constants.PREFERENCE_QUESTIONS.find((q) => q.key === questionKey);
    return question ? constants.labelFor(question.options, value) : (value ?? '—');
  },
};
