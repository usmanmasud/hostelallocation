import { Router } from 'express';
import { COMPLAINT_CATEGORIES, PREFERENCE_QUESTIONS, ROLES } from '../lib/constants.js';
import { forbidden, notFound } from '../lib/errors.js';
import { Form, parseId } from '../lib/validation.js';
import { requireRole } from '../middleware/auth.js';
import * as allocations from '../repositories/allocations.js';
import * as complaints from '../repositories/complaints.js';
import * as payments from '../repositories/payments.js';
import * as preferences from '../repositories/preferences.js';
import * as settings from '../repositories/settings.js';
import { allocationDetails } from '../services/allocationService.js';
import { savePreferences, submitComplaint } from '../services/hostelService.js';

const router = Router();
router.use(requireRole(ROLES.STUDENT), (req, res, next) =>
  next(req.student ? undefined : forbidden('This account has no student profile. Please contact the hostel office.')),
);

router.get('/', (req, res) => {
  const studentComplaints = complaints.listByStudent(req.student.id);
  res.render('student/dashboard', {
    title: 'Student dashboard',
    student: req.student,
    preference: preferences.findByStudentId(req.student.id),
    allocation: allocations.findActiveByStudent(req.student.id),
    payment: payments.findByStudent(req.student.id),
    openComplaints: studentComplaints.filter((c) => c.status !== 'resolved').length,
    recentComplaints: studentComplaints.slice(0, 3),
    settings: settings.getAll(),
  });
});

// ---------------------------------------------------------------- preferences

function preferenceValues(row) {
  if (!row) return {};
  const values = { otherNotes: row.other_notes ?? '' };
  for (const { key, column } of PREFERENCE_QUESTIONS) values[key] = row[column];
  return values;
}

function renderPreferences(req, res, { values, errors = {}, status = 200 }) {
  res.status(status).render('student/preferences', {
    title: 'Room preferences',
    student: req.student,
    questions: PREFERENCE_QUESTIONS,
    values,
    errors,
    locked: Boolean(allocations.findActiveByStudent(req.student.id)),
    submitted: Boolean(preferences.findByStudentId(req.student.id)),
  });
}

router.get('/preferences', (req, res) => {
  renderPreferences(req, res, { values: preferenceValues(preferences.findByStudentId(req.student.id)) });
});

router.post('/preferences', (req, res) => {
  const form = new Form(req.body);
  for (const { key, label, options } of PREFERENCE_QUESTIONS) form.oneOf(key, options, { label });
  form.text('otherNotes', { label: 'Other notes', required: false, max: 500 });
  if (!form.valid) return renderPreferences(req, res, { values: form.values, errors: form.errors, status: 422 });

  const run = savePreferences(req.student, form.values);
  if (run && allocations.findActiveByStudent(req.student.id)) {
    req.flash('success', 'Your preferences were saved and you have been matched to a room.');
    return res.redirect('/student/allocation');
  }
  req.flash(
    'success',
    run
      ? 'Your preferences were saved. No bed is free right now, so you will be matched as soon as one is available.'
      : 'Your preferences were saved. You will be matched when the hostel administrator runs the allocation.',
  );
  res.redirect('/student');
});

// ---------------------------------------------------------------- allocation

router.get('/allocation', (req, res) => {
  res.render('student/allocation', {
    title: 'My allocation',
    details: allocationDetails(req.student.id),
    hasPreferences: Boolean(preferences.findByStudentId(req.student.id)),
  });
});

// ---------------------------------------------------------------- complaints

router.get('/complaints', (req, res) => {
  res.render('student/complaints', {
    title: 'My complaints',
    complaints: complaints.listByStudent(req.student.id),
    canSubmit: Boolean(allocations.findActiveByStudent(req.student.id)),
  });
});

function renderComplaintForm(res, { values = {}, errors = {}, status = 200 } = {}) {
  res.status(status).render('student/complaint-new', {
    title: 'Report a complaint',
    categories: COMPLAINT_CATEGORIES,
    values,
    errors,
    escalationDays: settings.get('escalationDays'),
  });
}

router.get('/complaints/new', (req, res) => {
  if (!allocations.findActiveByStudent(req.student.id)) {
    req.flash('info', 'You can report hostel complaints once you have been allocated a room.');
    return res.redirect('/student/complaints');
  }
  renderComplaintForm(res);
});

router.post('/complaints', (req, res) => {
  const form = new Form(req.body)
    .oneOf('category', COMPLAINT_CATEGORIES, { label: 'Category' })
    .text('title', { label: 'Title', min: 5, max: 120 })
    .text('description', { label: 'Description', min: 15, max: 2000 });
  if (!form.valid) return renderComplaintForm(res, { values: form.values, errors: form.errors, status: 422 });

  const id = submitComplaint(req.student, form.values);
  req.flash('success', 'Your complaint has been submitted to the hostel administrator.');
  res.redirect(`/student/complaints/${id}`);
});

router.get('/complaints/:id', (req, res) => {
  const complaint = complaints.findById(parseId(req.params.id));
  if (!complaint || complaint.student_id !== req.student.id) throw notFound('That complaint could not be found.');
  res.render('student/complaint-detail', {
    title: `Complaint #${complaint.id}`,
    complaint,
    settings: settings.getAll(),
  });
});

// ---------------------------------------------------------------- payment

router.get('/payment', (req, res) => {
  res.render('student/payment', {
    title: 'Payment status',
    payment: payments.findByStudent(req.student.id),
    settings: settings.getAll(),
  });
});

export default router;
