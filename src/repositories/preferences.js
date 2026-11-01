import { nullable, statement } from '../db/connection.js';
import { nowIso } from '../lib/time.js';

export function findByStudentId(studentId) {
  return statement('SELECT * FROM preferences WHERE student_id = ?').get(studentId);
}

export function upsert(studentId, answers) {
  const now = nowIso();
  statement(
    `INSERT INTO preferences (student_id, sleep_schedule, cleanliness, noise_tolerance, study_habits,
                              social_style, other_notes, submitted_at, updated_at)
     VALUES (:studentId, :sleepSchedule, :cleanliness, :noiseTolerance, :studyHabits,
             :socialStyle, :otherNotes, :now, :now)
     ON CONFLICT (student_id) DO UPDATE SET
       sleep_schedule = excluded.sleep_schedule,
       cleanliness = excluded.cleanliness,
       noise_tolerance = excluded.noise_tolerance,
       study_habits = excluded.study_habits,
       social_style = excluded.social_style,
       other_notes = excluded.other_notes,
       updated_at = excluded.updated_at`,
  ).run({
    studentId,
    sleepSchedule: answers.sleepSchedule,
    cleanliness: answers.cleanliness,
    noiseTolerance: answers.noiseTolerance,
    studyHabits: answers.studyHabits,
    socialStyle: answers.socialStyle,
    otherNotes: nullable(answers.otherNotes),
    now,
  });
}
