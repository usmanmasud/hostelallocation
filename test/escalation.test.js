import { resetDatabase } from './setup.js';
import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { ROLES } from '../src/lib/constants.js';
import { DAY_MS } from '../src/lib/time.js';
import * as complaints from '../src/repositories/complaints.js';
import * as notifications from '../src/repositories/notifications.js';
import * as settings from '../src/repositories/settings.js';
import { runEscalationCheck } from '../src/services/escalationService.js';
import { createStaff, createStudent } from './fixtures.js';

beforeEach(resetDatabase);

const NOW = new Date('2026-11-10T12:00:00Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

function fileComplaint(studentId, submittedDaysAgo, title = 'Leaking tap') {
  return complaints.create({
    studentId,
    category: 'plumbing',
    title,
    description: 'The tap in the bathroom keeps leaking.',
    submittedAt: daysAgo(submittedDaysAgo),
  });
}

describe('complaint escalation', () => {
  test('escalates only unresolved complaints older than the time limit', async () => {
    settings.update({ escalationDays: 3, deanEmail: 'dean@school.edu', deanName: 'Prof. Dean' });
    const { studentId } = createStudent();
    const overdue = fileComplaint(studentId, 4);
    const inProgressOverdue = fileComplaint(studentId, 3.5);
    complaints.updateByAdmin(inProgressOverdue, { status: 'in_progress', adminResponse: 'Plumber called.' });
    const recent = fileComplaint(studentId, 2);
    const resolved = fileComplaint(studentId, 10);
    complaints.updateByAdmin(resolved, { status: 'resolved', adminResponse: 'Fixed.' });

    const { escalatedIds } = await runEscalationCheck({ now: NOW });

    assert.deepEqual(escalatedIds.sort(), [overdue, inProgressOverdue].sort());
    const escalated = complaints.findById(overdue);
    assert.equal(escalated.status, 'escalated');
    assert.equal(escalated.escalation_level, 1);
    assert.equal(escalated.escalated_at, NOW.toISOString());
    assert.equal(complaints.findById(recent).status, 'pending');
    assert.equal(complaints.findById(resolved).status, 'resolved');
  });

  test('treats a complaint exactly at the limit as due', async () => {
    settings.update({ escalationDays: 3 });
    const { studentId } = createStudent();
    const id = fileComplaint(studentId, 3);
    assert.deepEqual((await runEscalationCheck({ now: NOW })).escalatedIds, [id]);
  });

  test('emails the Dean with the complaint details and records it in the outbox', async () => {
    settings.update({ escalationDays: 1, deanEmail: 'dean@school.edu', deanName: 'Prof. Dean' });
    const { studentId } = createStudent({ name: 'Ada Obi' });
    const id = fileComplaint(studentId, 2, 'Broken window');

    await runEscalationCheck({ now: NOW });

    const [email] = notifications.listEmails();
    assert.equal(email.recipient, 'dean@school.edu');
    assert.equal(email.delivery_status, 'logged', 'without SMTP the email is logged, not sent');
    assert.match(email.subject, new RegExp(`#${id}: Broken window`));
    assert.match(email.body, /Dear Prof\. Dean/);
    assert.match(email.body, /Ada Obi/);
    assert.match(email.body, /The tap in the bathroom keeps leaking\./);
  });

  test('notifies the hostel administrators and the student', async () => {
    settings.update({ escalationDays: 1 });
    const adminId = createStaff(ROLES.HOSTEL_ADMIN);
    const { studentId, userId } = createStudent();
    fileComplaint(studentId, 2);

    await runEscalationCheck({ now: NOW });

    assert.match(notifications.listForUser(adminId)[0].subject, /escalated to the Dean/);
    assert.match(notifications.listForUser(userId)[0].subject, /escalated/);
  });

  test('escalates each complaint only once', async () => {
    settings.update({ escalationDays: 1 });
    const { studentId } = createStudent();
    fileComplaint(studentId, 5);

    await runEscalationCheck({ now: NOW });
    const second = await runEscalationCheck({ now: new Date(NOW.getTime() + 10 * DAY_MS) });

    assert.deepEqual(second.escalatedIds, []);
    assert.equal(notifications.listEmails().length, 1);
  });

  test('an escalated complaint can still be resolved by the hostel administrator', async () => {
    settings.update({ escalationDays: 1 });
    const { studentId } = createStudent();
    const id = fileComplaint(studentId, 2);
    await runEscalationCheck({ now: NOW });

    complaints.updateByAdmin(id, { status: 'resolved', adminResponse: 'Replaced the tap.' });

    const complaint = complaints.findById(id);
    assert.equal(complaint.status, 'resolved');
    assert.equal(complaint.escalation_level, 1, 'the escalation history is kept');
    assert.ok(complaint.resolved_at);
  });
});
