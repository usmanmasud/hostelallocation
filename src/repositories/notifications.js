import { nullable, statement } from '../db/connection.js';
import { nowIso } from '../lib/time.js';

export function createInApp({ userId, subject, body, link }) {
  statement(
    `INSERT INTO notifications (user_id, channel, subject, body, link, created_at)
     VALUES (?, 'in_app', ?, ?, ?, ?)`,
  ).run(userId, subject, body, nullable(link), nowIso());
}

/** Adds an email to the outbox and returns its id; delivery is attempted separately. */
export function createEmail({ recipient, subject, body }) {
  const result = statement(
    `INSERT INTO notifications (channel, recipient, subject, body, delivery_status, created_at)
     VALUES ('email', ?, ?, ?, 'queued', ?)`,
  ).run(recipient, subject, body, nowIso());
  return Number(result.lastInsertRowid);
}

export function findEmail(id) {
  return statement(`SELECT * FROM notifications WHERE id = ? AND channel = 'email'`).get(id);
}

export function setDeliveryStatus(id, status, error = null) {
  statement('UPDATE notifications SET delivery_status = ?, delivery_error = ? WHERE id = ?').run(status, error, id);
}

export function listForUser(userId, limit = 50) {
  return statement(
    `SELECT * FROM notifications WHERE user_id = ? AND channel = 'in_app'
      ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(userId, limit);
}

export function unreadCount(userId) {
  return statement(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND channel = 'in_app' AND is_read = 0`,
  ).get(userId).count;
}

/** Marks one notification read and returns it, or undefined when it is not the user's. */
export function markRead(id, userId) {
  statement('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, userId);
  return statement('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(id, userId);
}

export function markAllRead(userId) {
  statement('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
}

export function listEmails(limit = 100) {
  return statement(
    `SELECT * FROM notifications WHERE channel = 'email' ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(limit);
}
