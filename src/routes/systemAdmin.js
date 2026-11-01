import { Router } from 'express';
import { ALLOCATION_MODES, ROLES, ROLE_LABELS } from '../lib/constants.js';
import { notFound } from '../lib/errors.js';
import { Form, parseId } from '../lib/validation.js';
import { requireRole } from '../middleware/auth.js';
import * as complaints from '../repositories/complaints.js';
import * as notifications from '../repositories/notifications.js';
import * as settings from '../repositories/settings.js';
import * as students from '../repositories/students.js';
import * as users from '../repositories/users.js';
import {
  createStaffAccount,
  resetPassword,
  setAccountActive,
  updateAccount,
} from '../services/accountService.js';
import { runEscalationCheck } from '../services/escalationService.js';

const router = Router();
router.use(requireRole(ROLES.SYSTEM_ADMIN));

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
const STAFF_ROLE_OPTIONS = ROLE_OPTIONS.filter((role) => role.value !== ROLES.STUDENT);

router.get('/', (req, res) => {
  const counts = Object.fromEntries(users.countsByRole().map((row) => [row.role, row.count]));
  res.render('system/overview', {
    title: 'System overview',
    counts,
    complaintCounts: complaints.countsByStatus(),
    settings: settings.getAll(),
    recentEmails: notifications.listEmails(5),
  });
});

// ---------------------------------------------------------------- users

router.get('/users', (req, res) => {
  const filter = {
    role: ROLE_OPTIONS.some((r) => r.value === req.query.role) ? req.query.role : '',
    search: typeof req.query.search === 'string' ? req.query.search.trim() : '',
  };
  res.render('system/users', { title: 'User accounts', users: users.list(filter), roles: ROLE_OPTIONS, filter });
});

function renderNewUser(res, { values = {}, errors = {}, status = 200 } = {}) {
  res.status(status).render('system/user-new', { title: 'New staff account', roles: STAFF_ROLE_OPTIONS, values, errors });
}

router.get('/users/new', (req, res) => renderNewUser(res));

router.post('/users', async (req, res) => {
  const form = new Form(req.body)
    .text('name', { label: 'Full name', min: 3, max: 100 })
    .email('email')
    .oneOf('role', STAFF_ROLE_OPTIONS, { label: 'Role' })
    .password('password', { confirmField: 'confirmPassword' });
  const { password: _password, ...safeValues } = form.values;
  if (!form.valid) return renderNewUser(res, { values: safeValues, errors: form.errors, status: 422 });

  await createStaffAccount(form.values);
  req.flash('success', `${ROLE_LABELS[form.values.role]} account created for ${form.values.name}.`);
  res.redirect('/system/users');
});

function findUserOr404(id) {
  const user = users.findById(parseId(id));
  if (!user) throw notFound('That user could not be found.');
  return user;
}

function renderUser(res, user, { values, errors = {}, status = 200 }) {
  res.status(status).render('system/user-edit', {
    title: user.name,
    user,
    student: user.role === ROLES.STUDENT ? students.findByUserId(user.id) : null,
    values,
    errors,
  });
}

router.get('/users/:id', (req, res) => {
  const user = findUserOr404(req.params.id);
  renderUser(res, user, { values: { name: user.name, email: user.email } });
});

router.post('/users/:id', (req, res) => {
  const user = findUserOr404(req.params.id);
  const form = new Form(req.body).text('name', { label: 'Full name', min: 3, max: 100 }).email('email');
  if (!form.valid) return renderUser(res, user, { values: form.values, errors: form.errors, status: 422 });

  updateAccount(user.id, form.values);
  req.flash('success', 'Account details updated.');
  res.redirect(`/system/users/${user.id}`);
});

router.post('/users/:id/status', (req, res) => {
  const user = findUserOr404(req.params.id);
  const activate = req.body.active === '1';
  setAccountActive(req.user.id, user.id, activate);
  req.flash('success', `${user.name}'s account has been ${activate ? 'activated' : 'deactivated'}.`);
  res.redirect(`/system/users/${user.id}`);
});

router.post('/users/:id/reset-password', async (req, res) => {
  const user = findUserOr404(req.params.id);
  const password = await resetPassword(user.id);
  req.flash('success', `Temporary password for ${user.name}: ${password} — share it securely; it is shown only once.`);
  res.redirect(`/system/users/${user.id}`);
});

// ---------------------------------------------------------------- settings

function settingsValues(current) {
  return { ...current, courses: current.courses.join('\n') };
}

function renderSettings(res, { values, errors = {}, status = 200 }) {
  res.status(status).render('system/settings', { title: 'System settings', modes: ALLOCATION_MODES, values, errors });
}

router.get('/settings', (req, res) => {
  renderSettings(res, { values: settingsValues(settings.getAll()) });
});

router.post('/settings', (req, res) => {
  const form = new Form(req.body)
    .integer('escalationDays', { label: 'Escalation time limit', min: 1, max: 60 })
    .text('deanName', { label: 'Dean name', min: 3, max: 100 })
    .email('deanEmail', { label: 'Dean email address' })
    .integer('hostelFee', { label: 'Hostel fee', min: 0, max: 100_000_000 })
    .text('currency', { label: 'Currency code', min: 3, max: 3 })
    .text('academicSession', { label: 'Academic session', max: 20 })
    .oneOf('allocationMode', ALLOCATION_MODES, { label: 'Allocation mode' })
    .text('courses', { label: 'Courses', max: 5000 });

  const currency = form.values.currency.toUpperCase();
  if (form.values.currency && !/^[A-Z]{3}$/.test(currency)) form.fail('currency', 'Use a three-letter currency code such as NGN.');
  const courses = [...new Set(form.values.courses.split(/\r?\n/).map((c) => c.trim()).filter(Boolean))];
  if (form.values.courses && courses.length === 0) form.fail('courses', 'List at least one course.');
  if (courses.some((course) => course.length > 100)) form.fail('courses', 'Each course name must be at most 100 characters.');
  if (!form.valid) return renderSettings(res, { values: form.values, errors: form.errors, status: 422 });

  settings.update({ ...form.values, currency, courses });
  req.flash('success', 'Settings saved.');
  res.redirect('/system/settings');
});

// ---------------------------------------------------------------- escalation

router.get('/outbox', (req, res) => {
  res.render('system/outbox', { title: 'Escalation emails', emails: notifications.listEmails() });
});

router.post('/escalation/run', async (req, res) => {
  const { escalatedIds } = await runEscalationCheck();
  req.flash(
    escalatedIds.length ? 'success' : 'info',
    escalatedIds.length
      ? `Escalated ${escalatedIds.length} complaint(s) to the Dean of Student Affairs.`
      : 'No complaints are past the escalation time limit.',
  );
  res.redirect('/system/outbox');
});

export default router;
