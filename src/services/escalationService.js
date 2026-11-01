import { transaction } from '../db/connection.js';
import { COMPLAINT_CATEGORIES, ROLES, labelFor } from '../lib/constants.js';
import { DAY_MS, nowIso } from '../lib/time.js';
import * as complaints from '../repositories/complaints.js';
import * as settingsRepo from '../repositories/settings.js';
import { deliverEmails, notifyRole, notifyUser, queueEmail } from './notificationService.js';

function deanEmail(complaint, settings, now) {
  const location = complaint.hostel_name ? `${complaint.hostel_name}, Room ${complaint.room_number}` : 'Not recorded';
  return {
    to: settings.deanEmail,
    subject: `[Escalated] Hostel complaint #${complaint.id}: ${complaint.title}`,
    body: [
      `Dear ${settings.deanName},`,
      '',
      `The following hostel complaint has not been resolved within ${settings.escalationDays} day(s) and has been escalated to you automatically.`,
      '',
      `Complaint ID: #${complaint.id}`,
      `Title: ${complaint.title}`,
      `Category: ${labelFor(COMPLAINT_CATEGORIES, complaint.category)}`,
      `Submitted: ${complaint.submitted_at}`,
      `Escalated: ${nowIso(now)}`,
      `Student: ${complaint.student_name} (${complaint.matric_number})`,
      `Location: ${location}`,
      '',
      'Description:',
      complaint.description,
      '',
      complaint.admin_response ? `Latest hostel administrator response: ${complaint.admin_response}` : 'No response has been recorded by the hostel administrator.',
      '',
      'Please follow this up with the Hostel Administrator.',
      '',
      'Smart Hostel Allocation Management System',
    ].join('\n'),
  };
}

/**
 * Escalates every unresolved complaint that has been open longer than the configured
 * time limit (section 3.3.1): the complaint moves to the Dean of Student Affairs, who is
 * emailed its details, and the hostel administrators and the student are notified.
 */
export async function runEscalationCheck({ now = new Date() } = {}) {
  const settings = settingsRepo.getAll();
  const cutoff = new Date(now.getTime() - settings.escalationDays * DAY_MS).toISOString();
  const emailIds = [];

  const escalated = transaction(() =>
    complaints.listDueForEscalation(cutoff).filter((complaint) => {
      if (!complaints.markEscalated(complaint.id, nowIso(now))) return false;
      emailIds.push(queueEmail(deanEmail(complaint, settings, now)));
      notifyRole(ROLES.HOSTEL_ADMIN, {
        subject: `Complaint #${complaint.id} escalated to the Dean`,
        body: `"${complaint.title}" was unresolved after ${settings.escalationDays} day(s) and has been escalated to ${settings.deanName}.`,
        link: `/admin/complaints/${complaint.id}`,
      });
      notifyUser(complaint.student_user_id, {
        subject: 'Your complaint has been escalated',
        body: `Your complaint "${complaint.title}" was not resolved within ${settings.escalationDays} day(s), so it has been escalated to ${settings.deanName}.`,
        link: `/student/complaints/${complaint.id}`,
      });
      return true;
    }),
  );

  await deliverEmails(emailIds);
  return { checkedAt: nowIso(now), cutoff, escalatedIds: escalated.map((complaint) => complaint.id) };
}

/** Starts the periodic escalation check; returns a function that stops it. */
export function startEscalationScheduler(intervalMinutes) {
  const run = () =>
    runEscalationCheck()
      .then(({ escalatedIds }) => {
        if (escalatedIds.length) console.log(`[escalation] Escalated complaint(s): ${escalatedIds.join(', ')}`);
      })
      .catch((error) => console.error('[escalation] Check failed:', error));
  run();
  const timer = setInterval(run, intervalMinutes * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
