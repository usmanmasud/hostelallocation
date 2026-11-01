import { ROLES } from '../src/lib/constants.js';
import * as payments from '../src/repositories/payments.js';
import * as preferences from '../src/repositories/preferences.js';
import * as rooms from '../src/repositories/rooms.js';
import * as students from '../src/repositories/students.js';
import * as users from '../src/repositories/users.js';

let sequence = 0;

export const QUIET = { sleepSchedule: 'early', cleanliness: 'very_tidy', noiseTolerance: 'quiet', studyHabits: 'in_room', socialStyle: 'reserved' };
export const LIVELY = { sleepSchedule: 'late', cleanliness: 'relaxed', noiseTolerance: 'lively', studyHabits: 'outside', socialStyle: 'outgoing' };

/** Creates a student (with preferences unless `answers` is null) and returns its profile id and user id. */
export function createStudent({ gender = 'male', course = 'Computer Science', answers = QUIET, name } = {}) {
  sequence += 1;
  const userId = users.create({
    name: name ?? `Student ${sequence}`,
    email: `student${sequence}@test.local`,
    passwordHash: 'unused',
    role: ROLES.STUDENT,
  });
  const studentId = students.create({ userId, matricNumber: `T/${sequence}`, gender, course, level: 100 });
  payments.createForStudent(studentId, 1000);
  if (answers) preferences.upsert(studentId, answers);
  return { studentId, userId };
}

export function createRoom({ hostelName = 'Test Hall', gender = 'male', capacity = 2, roomNumber } = {}) {
  sequence += 1;
  return rooms.create({ hostelName, roomNumber: roomNumber ?? `R${sequence}`, gender, capacity });
}

export function createStaff(role = ROLES.HOSTEL_ADMIN) {
  sequence += 1;
  return users.create({ name: `Staff ${sequence}`, email: `staff${sequence}@test.local`, passwordHash: 'unused', role });
}
