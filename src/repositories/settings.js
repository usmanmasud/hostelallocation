import { statement, transaction } from '../db/connection.js';
import { nowIso } from '../lib/time.js';

const DEFAULT_COURSES = [
  'Computer Science',
  'Information Technology',
  'Software Engineering',
  'Electrical Engineering',
  'Mechanical Engineering',
  'Civil Engineering',
  'Accounting',
  'Business Administration',
  'Economics',
  'Mass Communication',
  'Medicine and Surgery',
  'Nursing Science',
  'Law',
  'Biochemistry',
  'Microbiology',
];

/** Every configurable setting, its default and how its stored text is turned into a value. */
const DEFINITIONS = {
  escalationDays: { key: 'escalation_days', default: '3', parse: Number },
  deanName: { key: 'dean_name', default: 'Dean of Student Affairs', parse: String },
  deanEmail: { key: 'dean_email', default: 'dean.studentaffairs@school.edu', parse: String },
  hostelFee: { key: 'hostel_fee', default: '45000', parse: Number },
  currency: { key: 'currency', default: 'NGN', parse: String },
  academicSession: { key: 'academic_session', default: '2026/2027', parse: String },
  allocationMode: { key: 'allocation_mode', default: 'batch', parse: String },
  courses: {
    key: 'courses',
    default: DEFAULT_COURSES.join('\n'),
    parse: (text) => text.split('\n').map((line) => line.trim()).filter(Boolean),
  },
};

/** Returns all settings as typed values, falling back to defaults for unset keys. */
export function getAll() {
  const stored = new Map(statement('SELECT key, value FROM settings').all().map((row) => [row.key, row.value]));
  const settings = {};
  for (const [name, definition] of Object.entries(DEFINITIONS)) {
    settings[name] = definition.parse(stored.get(definition.key) ?? definition.default);
  }
  return settings;
}

export function get(name) {
  return getAll()[name];
}

/** Persists the given settings. Values are stored as text; arrays as one item per line. */
export function update(values) {
  const now = nowIso();
  transaction(() => {
    for (const [name, value] of Object.entries(values)) {
      const definition = DEFINITIONS[name];
      if (!definition) throw new Error(`Unknown setting: ${name}`);
      const text = Array.isArray(value) ? value.join('\n') : String(value);
      statement(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(definition.key, text, now);
    }
  });
}
