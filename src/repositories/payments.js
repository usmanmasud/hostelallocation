import { nullable, statement } from '../db/connection.js';
import { nowIso } from '../lib/time.js';

export function createForStudent(studentId, amount) {
  statement(
    `INSERT INTO payments (student_id, amount, status, updated_at) VALUES (?, ?, 'unpaid', ?)
     ON CONFLICT (student_id) DO NOTHING`,
  ).run(studentId, amount, nowIso());
}

export function findByStudent(studentId) {
  return statement(
    `SELECT p.*, u.name AS updated_by_name
       FROM payments p
       LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.student_id = ?`,
  ).get(studentId);
}

export function list({ status, search } = {}) {
  const pattern = search ? `%${search}%` : null;
  return statement(
    `SELECT p.*, s.matric_number, s.course, s.level, su.name AS student_name, uu.name AS updated_by_name,
            r.hostel_name, r.room_number
       FROM payments p
       JOIN student_profiles s ON s.id = p.student_id
       JOIN users su ON su.id = s.user_id
       LEFT JOIN users uu ON uu.id = p.updated_by
       LEFT JOIN allocations a ON a.student_id = s.id AND a.vacated_at IS NULL
       LEFT JOIN rooms r ON r.id = a.room_id
      WHERE (:status IS NULL OR p.status = :status)
        AND (:pattern IS NULL OR su.name LIKE :pattern OR s.matric_number LIKE :pattern)
      ORDER BY su.name`,
  ).all({ status: nullable(status), pattern });
}

export function update(studentId, { amount, status, reference, note, updatedBy }) {
  statement(
    `UPDATE payments SET amount = ?, status = ?, reference = ?, note = ?, updated_by = ?, updated_at = ?
      WHERE student_id = ?`,
  ).run(amount, status, nullable(reference), nullable(note), updatedBy, nowIso(), studentId);
}

export function summary() {
  const rows = statement(
    'SELECT status, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM payments GROUP BY status',
  ).all();
  const result = {
    paid: { count: 0, amount: 0 },
    pending: { count: 0, amount: 0 },
    unpaid: { count: 0, amount: 0 },
  };
  for (const row of rows) result[row.status] = { count: row.count, amount: row.amount };
  return result;
}
