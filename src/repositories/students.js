import { nullable, statement } from '../db/connection.js';

const STUDENT_SELECT = `
  SELECT s.id, s.user_id, s.matric_number, s.gender, s.course, s.level, s.phone,
         u.name, u.email, u.is_active, u.created_at
    FROM student_profiles s
    JOIN users u ON u.id = s.user_id`;

export function create({ userId, matricNumber, gender, course, level, phone }) {
  const result = statement(
    `INSERT INTO student_profiles (user_id, matric_number, gender, course, level, phone)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(userId, matricNumber, gender, course, level, nullable(phone));
  return Number(result.lastInsertRowid);
}

export function findById(id) {
  return statement(`${STUDENT_SELECT} WHERE s.id = ?`).get(id);
}

export function findByUserId(userId) {
  return statement(`${STUDENT_SELECT} WHERE s.user_id = ?`).get(userId);
}

export function matricExists(matricNumber) {
  return Boolean(statement('SELECT 1 FROM student_profiles WHERE matric_number = ?').get(matricNumber));
}

/**
 * Lists students with their preference, allocation and payment state for the admin views.
 * `allocation` filters by 'allocated' | 'waiting' (preferences in, no room) | 'no_preferences'.
 */
export function listWithStatus({ search, gender, allocation } = {}) {
  const pattern = search ? `%${search}%` : null;
  return statement(
    `SELECT s.id, s.matric_number, s.gender, s.course, s.level, u.name, u.email, u.is_active,
            p.id IS NOT NULL AS has_preferences,
            a.id AS allocation_id, a.compatibility_score, r.hostel_name, r.room_number,
            pay.status AS payment_status
       FROM student_profiles s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN preferences p ON p.student_id = s.id
       LEFT JOIN allocations a ON a.student_id = s.id AND a.vacated_at IS NULL
       LEFT JOIN rooms r ON r.id = a.room_id
       LEFT JOIN payments pay ON pay.student_id = s.id
      WHERE (:pattern IS NULL OR u.name LIKE :pattern OR s.matric_number LIKE :pattern OR s.course LIKE :pattern)
        AND (:gender IS NULL OR s.gender = :gender)
        AND (:allocation IS NULL
             OR (:allocation = 'allocated' AND a.id IS NOT NULL)
             OR (:allocation = 'waiting' AND a.id IS NULL AND p.id IS NOT NULL)
             OR (:allocation = 'no_preferences' AND p.id IS NULL))
      ORDER BY u.name`,
  ).all({ pattern, gender: nullable(gender), allocation: nullable(allocation) });
}

/**
 * Students who are ready to be matched: active account, preferences submitted and no
 * active allocation. Returned with their preference answers, oldest submission first.
 */
export function listAwaitingAllocation(gender) {
  return statement(
    `SELECT s.id, s.gender, s.course, s.level, u.name,
            p.sleep_schedule, p.cleanliness, p.noise_tolerance, p.study_habits, p.social_style,
            p.submitted_at
       FROM student_profiles s
       JOIN users u ON u.id = s.user_id AND u.is_active = 1
       JOIN preferences p ON p.student_id = s.id
      WHERE s.gender = ?
        AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.student_id = s.id AND a.vacated_at IS NULL)
      ORDER BY p.submitted_at, s.id`,
  ).all(gender);
}

export function countAwaitingAllocation() {
  return statement(
    `SELECT COUNT(*) AS count
       FROM student_profiles s
       JOIN users u ON u.id = s.user_id AND u.is_active = 1
       JOIN preferences p ON p.student_id = s.id
      WHERE NOT EXISTS (SELECT 1 FROM allocations a WHERE a.student_id = s.id AND a.vacated_at IS NULL)`,
  ).get().count;
}
