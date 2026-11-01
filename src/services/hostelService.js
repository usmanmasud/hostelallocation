import { transaction } from '../db/connection.js';
import { COMPLAINT_STATUSES, PAYMENT_STATUSES, labelFor } from '../lib/constants.js';
import { DomainError } from '../lib/errors.js';
import * as allocations from '../repositories/allocations.js';
import * as complaints from '../repositories/complaints.js';
import * as payments from '../repositories/payments.js';
import * as preferences from '../repositories/preferences.js';
import * as rooms from '../repositories/rooms.js';
import * as settings from '../repositories/settings.js';
import * as students from '../repositories/students.js';
import { runAllocation } from './allocationService.js';
import { notifyUser } from './notificationService.js';

// ---------------------------------------------------------------- preferences

/**
 * Saves a student's preference answers. Answers are locked once a room is allocated,
 * because they were used to choose the student's roommates. In instant allocation mode
 * the matching engine runs straight away (Figure 3.2).
 */
export function savePreferences(student, answers) {
  if (allocations.findActiveByStudent(student.id)) {
    throw new DomainError('Your preferences are locked because you have already been allocated a room.');
  }
  preferences.upsert(student.id, answers);
  if (settings.get('allocationMode') === 'instant') return runAllocation({ genders: [student.gender] });
  return null;
}

// ---------------------------------------------------------------- complaints

export function submitComplaint(student, { category, title, description }) {
  const allocation = allocations.findActiveByStudent(student.id);
  if (!allocation) throw new DomainError('You can report hostel complaints once you have been allocated a room.');
  return complaints.create({ studentId: student.id, roomId: allocation.room_id, category, title, description });
}

/** Records the hostel administrator's action on a complaint and tells the student. */
export function updateComplaint(complaintId, { status, adminResponse }) {
  transaction(() => {
    const complaint = complaints.findById(complaintId);
    if (!complaint) throw new DomainError('That complaint no longer exists.');
    complaints.updateByAdmin(complaintId, { status, adminResponse });
    notifyUser(complaint.student_user_id, {
      subject: `Complaint update: ${labelFor(COMPLAINT_STATUSES, status)}`,
      body: adminResponse
        ? `Your complaint "${complaint.title}" is now ${labelFor(COMPLAINT_STATUSES, status).toLowerCase()}. Response: ${adminResponse}`
        : `Your complaint "${complaint.title}" is now ${labelFor(COMPLAINT_STATUSES, status).toLowerCase()}.`,
      link: `/student/complaints/${complaintId}`,
    });
  });
}

// ---------------------------------------------------------------- payments

export function updatePayment(studentId, { amount, status, reference, note }, updatedBy) {
  transaction(() => {
    const student = students.findById(studentId);
    if (!student || !payments.findByStudent(studentId)) throw new DomainError('That payment record no longer exists.');
    payments.update(studentId, { amount, status, reference, note, updatedBy });
    notifyUser(student.user_id, {
      subject: 'Your payment status was updated',
      body: `Your hostel payment status is now: ${labelFor(PAYMENT_STATUSES, status)}.`,
      link: '/student/payment',
    });
  });
}

// ---------------------------------------------------------------- rooms

export function createRoom({ hostelName, roomNumber, gender, capacity }) {
  const existingGender = rooms.hostelGender(hostelName);
  if (existingGender && existingGender !== gender) {
    throw new DomainError(`${hostelName} is a ${existingGender} hostel; new rooms must match.`);
  }
  if (rooms.findByNumber(hostelName, roomNumber)) {
    throw new DomainError(`Room ${roomNumber} already exists in ${hostelName}.`);
  }
  return rooms.create({ hostelName, roomNumber, gender, capacity });
}

export function updateRoomCapacity(roomId, capacity) {
  const room = rooms.findById(roomId);
  if (!room) throw new DomainError('That room no longer exists.');
  if (capacity < room.current_occupancy) {
    throw new DomainError(`Capacity cannot be lower than the ${room.current_occupancy} student(s) currently in the room.`);
  }
  rooms.updateCapacity(roomId, capacity);
}

export function deleteRoom(roomId) {
  const room = rooms.findById(roomId);
  if (!room) throw new DomainError('That room no longer exists.');
  if (rooms.hasAllocationHistory(roomId)) {
    throw new DomainError('This room has allocation records and cannot be deleted.');
  }
  rooms.remove(roomId);
}
