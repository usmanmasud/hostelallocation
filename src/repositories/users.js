import { nullable, statement } from '../db/connection.js';
import { nowIso } from '../lib/time.js';

const PUBLIC_COLUMNS = 'id, name, email, role, is_active, created_at, last_login_at';

export function findById(id) {
  return statement(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(id);
}

/** Includes the password hash; use only for authentication. */
export function findByEmailWithHash(email) {
  return statement(`SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = ?`).get(email);
}

export function findHashById(id) {
  return statement('SELECT password_hash FROM users WHERE id = ?').get(id)?.password_hash;
}

export function emailExists(email) {
  return Boolean(statement('SELECT 1 FROM users WHERE email = ?').get(email));
}

export function create({ name, email, passwordHash, role }) {
  const result = statement(
    `INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(name, email, passwordHash, role, nowIso());
  return Number(result.lastInsertRowid);
}

export function list({ role, search } = {}) {
  const pattern = search ? `%${search}%` : null;
  return statement(
    `SELECT ${PUBLIC_COLUMNS} FROM users
      WHERE (:role IS NULL OR role = :role)
        AND (:pattern IS NULL OR name LIKE :pattern OR email LIKE :pattern)
      ORDER BY role, name`,
  ).all({ role: nullable(role), pattern });
}

export function listActiveByRole(role) {
  return statement(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE role = ? AND is_active = 1`).all(role);
}

export function countActiveByRole(role) {
  return statement('SELECT COUNT(*) AS count FROM users WHERE role = ? AND is_active = 1').get(role).count;
}

export function countsByRole() {
  return statement('SELECT role, COUNT(*) AS count FROM users GROUP BY role').all();
}

export function update(id, { name, email }) {
  statement('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name, email, id);
}

export function setActive(id, isActive) {
  statement('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
}

export function setPasswordHash(id, passwordHash) {
  statement('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

export function recordLogin(id) {
  statement('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), id);
}
