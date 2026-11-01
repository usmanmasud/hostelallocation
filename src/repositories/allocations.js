import { statement } from '../db/connection.js';
import { nowIso } from '../lib/time.js';

export function create({ studentId, roomId, batchId, allocatedAt = nowIso() }) {
  const result = statement(
    `INSERT INTO allocations (student_id, room_id, batch_id, allocated_at) VALUES (?, ?, ?, ?)`,
  ).run(studentId, roomId, batchId, allocatedAt);
  return Number(result.lastInsertRowid);
}

export function findById(id) {
  return statement('SELECT * FROM allocations WHERE id = ?').get(id);
}

/** The student's current allocation joined with its room, or undefined. */
export function findActiveByStudent(studentId) {
  return statement(
    `SELECT a.*, r.hostel_name, r.room_number, r.capacity, r.current_occupancy
       FROM allocations a
       JOIN rooms r ON r.id = a.room_id
      WHERE a.student_id = ? AND a.vacated_at IS NULL`,
  ).get(studentId);
}

/** Current occupants of a room with their profile and preference answers. */
export function listOccupants(roomId) {
  return statement(
    `SELECT a.id AS allocation_id, a.compatibility_score, a.allocated_at,
            s.id, s.matric_number, s.gender, s.course, s.level, u.name,
            p.sleep_schedule, p.cleanliness, p.noise_tolerance, p.study_habits, p.social_style
       FROM allocations a
       JOIN student_profiles s ON s.id = a.student_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN preferences p ON p.student_id = s.id
      WHERE a.room_id = ? AND a.vacated_at IS NULL
      ORDER BY a.allocated_at, s.id`,
  ).all(roomId);
}

export function listActive({ hostel, search } = {}) {
  const pattern = search ? `%${search}%` : null;
  return statement(
    `SELECT a.id, a.compatibility_score, a.allocated_at, a.batch_id,
            s.id AS student_id, s.matric_number, s.course, s.level, s.gender, u.name,
            r.id AS room_id, r.hostel_name, r.room_number, r.capacity, r.current_occupancy
       FROM allocations a
       JOIN student_profiles s ON s.id = a.student_id
       JOIN users u ON u.id = s.user_id
       JOIN rooms r ON r.id = a.room_id
      WHERE a.vacated_at IS NULL
        AND (:hostel IS NULL OR r.hostel_name = :hostel)
        AND (:pattern IS NULL OR u.name LIKE :pattern OR s.matric_number LIKE :pattern)
      ORDER BY r.hostel_name, r.room_number, u.name`,
  ).all({ hostel: hostel || null, pattern });
}

export function listRecent(limit = 8) {
  return statement(
    `SELECT a.id, a.compatibility_score, a.allocated_at, u.name, s.matric_number, r.hostel_name, r.room_number
       FROM allocations a
       JOIN student_profiles s ON s.id = a.student_id
       JOIN users u ON u.id = s.user_id
       JOIN rooms r ON r.id = a.room_id
      WHERE a.vacated_at IS NULL
      ORDER BY a.allocated_at DESC, a.id DESC
      LIMIT ?`,
  ).all(limit);
}

export function setScore(id, score) {
  statement('UPDATE allocations SET compatibility_score = ? WHERE id = ?').run(score, id);
}

export function markVacated(id) {
  statement('UPDATE allocations SET vacated_at = ? WHERE id = ? AND vacated_at IS NULL').run(nowIso(), id);
}

export function averageScore() {
  return statement(
    `SELECT AVG(compatibility_score) AS average FROM allocations
      WHERE vacated_at IS NULL AND compatibility_score IS NOT NULL`,
  ).get().average;
}
