import { nullable, statement } from '../db/connection.js';
import { nowIso } from '../lib/time.js';

const COMPLAINT_SELECT = `
  SELECT c.*, s.user_id AS student_user_id, u.name AS student_name, u.email AS student_email, s.matric_number,
         r.hostel_name, r.room_number
    FROM complaints c
    JOIN student_profiles s ON s.id = c.student_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN rooms r ON r.id = c.room_id`;

export function create({ studentId, roomId, category, title, description, submittedAt = nowIso() }) {
  const result = statement(
    `INSERT INTO complaints (student_id, room_id, category, title, description, submitted_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(studentId, nullable(roomId), category, title, description, submittedAt, submittedAt);
  return Number(result.lastInsertRowid);
}

export function findById(id) {
  return statement(`${COMPLAINT_SELECT} WHERE c.id = ?`).get(id);
}

export function listByStudent(studentId) {
  return statement(`${COMPLAINT_SELECT} WHERE c.student_id = ? ORDER BY c.submitted_at DESC`).all(studentId);
}

/** Open complaints first (escalated at the top), oldest first within each group. */
export function list({ status, category } = {}) {
  return statement(
    `${COMPLAINT_SELECT}
      WHERE (:status IS NULL OR c.status = :status)
        AND (:category IS NULL OR c.category = :category)
      ORDER BY c.status = 'resolved', c.escalation_level DESC, c.submitted_at`,
  ).all({ status: nullable(status), category: nullable(category) });
}

export function updateByAdmin(id, { status, adminResponse }) {
  const now = nowIso();
  statement(
    `UPDATE complaints
        SET status = :status, admin_response = :response, updated_at = :now,
            resolved_at = CASE WHEN :status = 'resolved' THEN COALESCE(resolved_at, :now) ELSE NULL END
      WHERE id = :id`,
  ).run({ id, status, response: nullable(adminResponse), now });
}

/** Unresolved, not-yet-escalated complaints submitted on or before `cutoffIso`. */
export function listDueForEscalation(cutoffIso) {
  return statement(
    `${COMPLAINT_SELECT}
      WHERE c.status IN ('pending', 'in_progress') AND c.escalation_level = 0 AND c.submitted_at <= ?
      ORDER BY c.submitted_at`,
  ).all(cutoffIso);
}

/**
 * Escalates a complaint one level. The WHERE clause re-checks its state, so a complaint
 * resolved or escalated in the meantime is left alone. Returns true when this call escalated it.
 */
export function markEscalated(id, now = nowIso()) {
  const result = statement(
    `UPDATE complaints
        SET status = 'escalated', escalation_level = escalation_level + 1, escalated_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'in_progress') AND escalation_level = 0`,
  ).run(now, now, id);
  return result.changes === 1;
}

export function countsByStatus() {
  const rows = statement('SELECT status, COUNT(*) AS count FROM complaints GROUP BY status').all();
  const counts = { pending: 0, in_progress: 0, escalated: 0, resolved: 0 };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}
