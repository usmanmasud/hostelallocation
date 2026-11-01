export const ROLES = Object.freeze({
  STUDENT: 'student',
  HOSTEL_ADMIN: 'hostel_admin',
  SYSTEM_ADMIN: 'system_admin',
});

export const ROLE_LABELS = Object.freeze({
  student: 'Student',
  hostel_admin: 'Hostel Administrator',
  system_admin: 'System Administrator',
});

export const GENDERS = Object.freeze([
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
]);

export const LEVELS = Object.freeze([100, 200, 300, 400, 500]);

/**
 * Lifestyle questions asked of every student (section 3.3.1). Each question is a
 * compatibility criterion; course of study is the remaining criterion and comes
 * from the student profile.
 */
export const PREFERENCE_QUESTIONS = Object.freeze([
  {
    key: 'sleepSchedule',
    column: 'sleep_schedule',
    label: 'Sleep schedule',
    question: 'When do you usually go to sleep?',
    options: [
      { value: 'early', label: 'Early sleeper (before 10 pm)' },
      { value: 'moderate', label: 'Moderate (10 pm – midnight)' },
      { value: 'late', label: 'Late sleeper (after midnight)' },
    ],
  },
  {
    key: 'cleanliness',
    column: 'cleanliness',
    label: 'Cleanliness level',
    question: 'How tidy do you keep your living space?',
    options: [
      { value: 'very_tidy', label: 'Very tidy' },
      { value: 'moderately_tidy', label: 'Moderately tidy' },
      { value: 'relaxed', label: 'Relaxed about tidiness' },
    ],
  },
  {
    key: 'noiseTolerance',
    column: 'noise_tolerance',
    label: 'Noise tolerance',
    question: 'What kind of room environment do you prefer?',
    options: [
      { value: 'quiet', label: 'Quiet environment' },
      { value: 'moderate', label: 'Some noise is fine' },
      { value: 'lively', label: 'Lively environment' },
    ],
  },
  {
    key: 'studyHabits',
    column: 'study_habits',
    label: 'Study habits',
    question: 'Where do you do most of your studying?',
    options: [
      { value: 'in_room', label: 'Studies in room' },
      { value: 'outside', label: 'Library or elsewhere' },
      { value: 'mixed', label: 'A mix of both' },
    ],
  },
  {
    key: 'socialStyle',
    column: 'social_style',
    label: 'Social style',
    question: 'How would you describe yourself socially?',
    options: [
      { value: 'reserved', label: 'Reserved — prefer few visitors' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'outgoing', label: 'Outgoing — enjoy having visitors' },
    ],
  },
]);

export const COMPLAINT_CATEGORIES = Object.freeze([
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'cleaning', label: 'Cleaning & sanitation' },
  { value: 'security', label: 'Security' },
  { value: 'other', label: 'Other' },
]);

export const COMPLAINT_STATUSES = Object.freeze([
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
]);

/** Statuses that count as "unresolved" for the escalation rule. */
export const OPEN_COMPLAINT_STATUSES = Object.freeze(['pending', 'in_progress', 'escalated']);

export const PAYMENT_STATUSES = Object.freeze([
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'unpaid', label: 'Unpaid' },
]);

export const ALLOCATION_MODES = Object.freeze([
  { value: 'batch', label: 'Batch — hostel administrator runs matching for all waiting students' },
  { value: 'instant', label: 'Instant — match each student as soon as preferences are submitted' },
]);

export function labelFor(list, value) {
  return list.find((item) => item.value === value)?.label ?? value;
}
