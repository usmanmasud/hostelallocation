import { Router } from 'express';
import { COMPLAINT_CATEGORIES, COMPLAINT_STATUSES, GENDERS, PAYMENT_STATUSES, ROLES } from '../lib/constants.js';
import { notFound } from '../lib/errors.js';
import { Form, parseId } from '../lib/validation.js';
import { requireRole } from '../middleware/auth.js';
import * as allocations from '../repositories/allocations.js';
import * as complaints from '../repositories/complaints.js';
import * as payments from '../repositories/payments.js';
import * as rooms from '../repositories/rooms.js';
import * as settings from '../repositories/settings.js';
import * as students from '../repositories/students.js';
import { runAllocation, vacateAllocation } from '../services/allocationService.js';
import { dashboard, occupancySnapshot } from '../services/dashboardService.js';
import {
  createRoom,
  deleteRoom,
  updateComplaint,
  updatePayment,
  updateRoomCapacity,
} from '../services/hostelService.js';

const router = Router();
router.use(requireRole(ROLES.HOSTEL_ADMIN));

/** Keeps only the query filters a list page understands, ignoring empty values. */
function filters(query, keys) {
  return Object.fromEntries(keys.map((key) => [key, typeof query[key] === 'string' ? query[key].trim() : '']));
}

// ---------------------------------------------------------------- dashboard

router.get('/', (req, res) => {
  res.render('admin/dashboard', { title: 'Hostel dashboard', ...dashboard(), settings: settings.getAll() });
});

/** Polled by the dashboard so occupancy figures stay current without reloading. */
router.get('/occupancy.json', (req, res) => {
  res.set('Cache-Control', 'no-store').json(occupancySnapshot());
});

// ---------------------------------------------------------------- rooms

function renderRooms(req, res, { values = {}, errors = {}, status = 200 } = {}) {
  const filter = filters(req.query, ['hostel', 'gender']);
  res.status(status).render('admin/rooms', {
    title: 'Rooms',
    rooms: rooms.list(filter),
    hostels: rooms.hostelNames(),
    genders: GENDERS,
    filter,
    values,
    errors,
  });
}

router.get('/rooms', (req, res) => renderRooms(req, res));

router.post('/rooms', (req, res) => {
  const form = new Form(req.body)
    .text('hostelName', { label: 'Hostel name', min: 2, max: 60 })
    .text('roomNumber', { label: 'Room number', max: 20 })
    .oneOf('gender', GENDERS, { label: 'Gender' })
    .integer('capacity', { label: 'Capacity', min: 1, max: 12 });
  if (!form.valid) return renderRooms(req, res, { values: form.values, errors: form.errors, status: 422 });

  createRoom(form.values);
  req.flash('success', `Room ${form.values.roomNumber} was added to ${form.values.hostelName}.`);
  res.redirect('/admin/rooms');
});

router.get('/rooms/:id', (req, res) => {
  const room = rooms.findById(parseId(req.params.id));
  if (!room) throw notFound('That room could not be found.');
  res.render('admin/room-detail', { title: `${room.hostel_name} — Room ${room.room_number}`, room, occupants: allocations.listOccupants(room.id) });
});

router.post('/rooms/:id/capacity', (req, res) => {
  const id = parseId(req.params.id);
  const form = new Form(req.body).integer('capacity', { label: 'Capacity', min: 1, max: 12 });
  if (!form.valid) {
    req.flash('error', form.errors.capacity);
  } else {
    updateRoomCapacity(id, form.values.capacity);
    req.flash('success', 'Room capacity updated.');
  }
  res.redirect(`/admin/rooms/${id}`);
});

router.post('/rooms/:id/delete', (req, res) => {
  deleteRoom(parseId(req.params.id));
  req.flash('success', 'Room deleted.');
  res.redirect('/admin/rooms');
});

// ---------------------------------------------------------------- allocations

router.get('/allocations', (req, res) => {
  const filter = filters(req.query, ['hostel', 'search']);
  res.render('admin/allocations', {
    title: 'Allocations',
    allocations: allocations.listActive(filter),
    hostels: rooms.hostelNames(),
    waiting: students.listWithStatus({ allocation: 'waiting' }),
    settings: settings.getAll(),
    filter,
    lastRun: req.session.lastAllocationRun ?? null,
  });
  delete req.session.lastAllocationRun;
});

router.post('/allocations/run', (req, res) => {
  const result = runAllocation();
  req.session.lastAllocationRun = {
    placedCount: result.placedCount,
    unplacedCount: result.unplacedCount,
    averageScore: result.averageScore,
    groups: result.groups.map(({ gender, method, placed, unplaced, roomsUsed }) => ({
      gender,
      method,
      roomsUsed,
      placed: placed.length,
      unplaced: unplaced.map((student) => student.name),
    })),
  };
  if (result.placedCount === 0 && result.unplacedCount === 0) {
    req.flash('info', 'No students are waiting for a room.');
  } else {
    req.flash('success', `Matching complete: ${result.placedCount} student(s) allocated.`);
  }
  res.redirect('/admin/allocations');
});

router.post('/allocations/:id/vacate', (req, res) => {
  vacateAllocation(parseId(req.params.id));
  req.flash('success', 'The allocation was ended and the bed is now free.');
  res.redirect(req.body.returnTo === 'room' && parseId(req.body.roomId) ? `/admin/rooms/${parseId(req.body.roomId)}` : '/admin/allocations');
});

// ---------------------------------------------------------------- students

router.get('/students', (req, res) => {
  const filter = filters(req.query, ['search', 'gender', 'allocation']);
  res.render('admin/students', { title: 'Students', students: students.listWithStatus(filter), genders: GENDERS, filter });
});

// ---------------------------------------------------------------- payments

router.get('/payments', (req, res) => {
  const filter = filters(req.query, ['search', 'status']);
  res.render('admin/payments', {
    title: 'Payments',
    payments: payments.list(filter),
    summary: payments.summary(),
    statuses: PAYMENT_STATUSES,
    currency: settings.get('currency'),
    filter,
  });
});

function renderPaymentForm(res, student, { values, errors = {}, status = 200 }) {
  res.status(status).render('admin/payment-edit', {
    title: `Payment — ${student.name}`,
    student,
    payment: payments.findByStudent(student.id),
    statuses: PAYMENT_STATUSES,
    currency: settings.get('currency'),
    values,
    errors,
  });
}

function findStudentOr404(id) {
  const student = students.findById(parseId(id));
  if (!student) throw notFound('That student could not be found.');
  return student;
}

router.get('/payments/:studentId', (req, res) => {
  const student = findStudentOr404(req.params.studentId);
  const payment = payments.findByStudent(student.id);
  renderPaymentForm(res, student, {
    values: { amount: payment.amount, status: payment.status, reference: payment.reference ?? '', note: payment.note ?? '' },
  });
});

router.post('/payments/:studentId', (req, res) => {
  const student = findStudentOr404(req.params.studentId);
  const form = new Form(req.body)
    .integer('amount', { label: 'Amount', min: 0, max: 100_000_000 })
    .oneOf('status', PAYMENT_STATUSES, { label: 'Status' })
    .text('reference', { label: 'Reference', required: false, max: 60 })
    .text('note', { label: 'Note', required: false, max: 300 });
  if (!form.valid) return renderPaymentForm(res, student, { values: form.values, errors: form.errors, status: 422 });

  updatePayment(student.id, form.values, req.user.id);
  req.flash('success', `Payment status for ${student.name} updated.`);
  res.redirect('/admin/payments');
});

// ---------------------------------------------------------------- complaints

router.get('/complaints', (req, res) => {
  const filter = filters(req.query, ['status', 'category']);
  res.render('admin/complaints', {
    title: 'Complaints',
    complaints: complaints.list(filter),
    statuses: COMPLAINT_STATUSES,
    categories: COMPLAINT_CATEGORIES,
    escalationDays: settings.get('escalationDays'),
    filter,
  });
});

const ADMIN_COMPLAINT_STATUSES = COMPLAINT_STATUSES.filter((s) => ['in_progress', 'resolved'].includes(s.value));

function renderComplaint(res, complaint, { values, errors = {}, status = 200 }) {
  res.status(status).render('admin/complaint-detail', {
    title: `Complaint #${complaint.id}`,
    complaint,
    statuses: ADMIN_COMPLAINT_STATUSES,
    settings: settings.getAll(),
    values,
    errors,
  });
}

function findComplaintOr404(id) {
  const complaint = complaints.findById(parseId(id));
  if (!complaint) throw notFound('That complaint could not be found.');
  return complaint;
}

router.get('/complaints/:id', (req, res) => {
  const complaint = findComplaintOr404(req.params.id);
  renderComplaint(res, complaint, {
    values: { status: complaint.status === 'resolved' ? 'resolved' : 'in_progress', adminResponse: complaint.admin_response ?? '' },
  });
});

router.post('/complaints/:id', (req, res) => {
  const complaint = findComplaintOr404(req.params.id);
  // A response explaining the fix is required when a complaint is marked resolved.
  const form = new Form(req.body)
    .oneOf('status', ADMIN_COMPLAINT_STATUSES, { label: 'Status' })
    .text('adminResponse', { label: 'Response', required: req.body.status === 'resolved', max: 1000 });
  if (!form.valid) return renderComplaint(res, complaint, { values: form.values, errors: form.errors, status: 422 });

  updateComplaint(complaint.id, form.values);
  req.flash('success', `Complaint #${complaint.id} updated.`);
  res.redirect(`/admin/complaints/${complaint.id}`);
});

export default router;
