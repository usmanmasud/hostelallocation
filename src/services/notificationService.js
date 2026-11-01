import nodemailer from 'nodemailer';
import { config } from '../config.js';
import * as notifications from '../repositories/notifications.js';
import * as users from '../repositories/users.js';

let transport;

function mailTransport() {
  if (transport === undefined) {
    transport = config.mail.host
      ? nodemailer.createTransport({
          host: config.mail.host,
          port: config.mail.port,
          secure: config.mail.secure,
          auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
        })
      : null;
  }
  return transport;
}

export function notifyUser(userId, { subject, body, link }) {
  notifications.createInApp({ userId, subject, body, link });
}

/** Sends an in-app notification to every active user with the given role. */
export function notifyRole(role, message) {
  for (const user of users.listActiveByRole(role)) notifyUser(user.id, message);
}

/**
 * Adds an email to the outbox and returns its id. Call `deliverEmails` with the ids once
 * the surrounding transaction has committed, so a rollback never leaves a sent email behind.
 */
export function queueEmail({ to, subject, body }) {
  return notifications.createEmail({ recipient: to, subject, body });
}

/**
 * Delivers queued emails. Without SMTP configuration, emails stay in the outbox marked
 * "logged" so administrators can still see exactly what would have been sent.
 */
export async function deliverEmails(ids) {
  const mailer = mailTransport();
  for (const id of ids) {
    const email = notifications.findEmail(id);
    if (!email) continue;
    if (!email.recipient) {
      notifications.setDeliveryStatus(id, 'failed', 'No recipient address configured.');
      continue;
    }
    if (!mailer) {
      notifications.setDeliveryStatus(id, 'logged');
      continue;
    }
    try {
      await mailer.sendMail({ from: config.mail.from, to: email.recipient, subject: email.subject, text: email.body });
      notifications.setDeliveryStatus(id, 'sent');
    } catch (error) {
      notifications.setDeliveryStatus(id, 'failed', error.message);
      console.error(`[mail] Failed to deliver notification ${id}:`, error.message);
    }
  }
}
