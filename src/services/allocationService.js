import { randomUUID } from 'node:crypto';
import { transaction } from '../db/connection.js';
import { GENDERS, ROLES } from '../lib/constants.js';
import { DomainError } from '../lib/errors.js';
import * as allocations from '../repositories/allocations.js';
import * as rooms from '../repositories/rooms.js';
import * as students from '../repositories/students.js';
import { compareProfiles, compatibilityScore, personalScore, profileFromRow } from './matching/compatibility.js';
import { optimizeAssignment } from './matching/optimizer.js';
import { notifyRole, notifyUser } from './notificationService.js';

/**
 * Chooses the rooms a matching run may fill: every partly filled room (so existing
 * occupants get roommates before new rooms are opened), then empty rooms in order until
 * there is a bed for every waiting student. `roomsWithSpace` must list partial rooms first.
 */
export function selectCandidateRooms(roomsWithSpace, studentCount) {
  const selected = roomsWithSpace.filter((room) => room.current_occupancy > 0);
  let beds = selected.reduce((sum, room) => sum + room.capacity - room.current_occupancy, 0);
  for (const room of roomsWithSpace) {
    if (beds >= studentCount) break;
    if (room.current_occupancy === 0) {
      selected.push(room);
      beds += room.capacity;
    }
  }
  return selected;
}

/** Recomputes every occupant's personal compatibility score after a room's membership changes. */
export function refreshRoomScores(roomId) {
  const occupants = allocations.listOccupants(roomId);
  const profiles = occupants.map(profileFromRow);
  occupants.forEach((occupant, index) => {
    const roommates = profiles.filter((_, other) => other !== index);
    allocations.setScore(occupant.allocation_id, personalScore(profiles[index], roommates));
  });
}

function allocateGroup(gender, batchId) {
  const waiting = students.listAwaitingAllocation(gender);
  if (waiting.length === 0) return null;

  const candidateRooms = selectCandidateRooms(rooms.listWithSpace(gender), waiting.length);
  const beds = candidateRooms.reduce((sum, room) => sum + room.capacity - room.current_occupancy, 0);
  // When beds run out, the students who submitted preferences earliest are placed first.
  const toPlace = waiting.slice(0, beds);
  const unplaced = waiting.slice(beds);

  const people = toPlace.map(profileFromRow);
  const roomInputs = candidateRooms.map((room) => {
    const occupants = allocations.listOccupants(room.id).map((row) => people.push(profileFromRow(row)) - 1);
    return { freeSlots: room.capacity - room.current_occupancy, occupants };
  });

  const result = optimizeAssignment({
    studentCount: toPlace.length,
    rooms: roomInputs,
    score: (i, j) => compatibilityScore(people[i], people[j]),
  });

  const touchedRooms = new Set();
  const placed = toPlace.map((student, index) => {
    const room = candidateRooms[result.assignment[index]];
    allocations.create({ studentId: student.id, roomId: room.id, batchId });
    rooms.adjustOccupancy(room.id, 1);
    touchedRooms.add(room.id);
    return { studentId: student.id, name: student.name, roomId: room.id, room };
  });
  touchedRooms.forEach(refreshRoomScores);

  return { gender, method: result.method, placed, unplaced, roomsUsed: touchedRooms.size };
}

/**
 * Runs the matching engine for every student waiting for a room (optionally only one
 * gender, since rooms are single-gender), saves the allocations and sends notifications.
 */
export function runAllocation({ genders = GENDERS.map((g) => g.value) } = {}) {
  const batchId = randomUUID();
  const groups = transaction(() => {
    const results = genders.map((gender) => allocateGroup(gender, batchId)).filter(Boolean);
    notifyAboutRun(results);
    return results;
  });

  const placed = groups.flatMap((group) => group.placed);
  const scores = placed
    .map((p) => allocations.findActiveByStudent(p.studentId)?.compatibility_score)
    .filter((score) => score != null);

  return {
    batchId,
    groups,
    placedCount: placed.length,
    unplacedCount: groups.reduce((sum, group) => sum + group.unplaced.length, 0),
    averageScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
  };
}

function notifyAboutRun(groups) {
  for (const group of groups) {
    for (const { studentId, room } of group.placed) {
      const student = students.findById(studentId);
      notifyUser(student.user_id, {
        subject: 'Your hostel room has been allocated',
        body: `You have been allocated ${room.hostel_name}, Room ${room.room_number}. View your roommates and compatibility score on the allocation page.`,
        link: '/student/allocation',
      });
    }
  }
  const placedCount = groups.reduce((sum, group) => sum + group.placed.length, 0);
  const unplacedCount = groups.reduce((sum, group) => sum + group.unplaced.length, 0);
  if (placedCount > 0 || unplacedCount > 0) {
    const shortage = unplacedCount > 0 ? ` ${unplacedCount} student(s) could not be placed because no beds are free.` : '';
    notifyRole(ROLES.HOSTEL_ADMIN, {
      subject: placedCount === 1 ? 'New room allocation made' : `${placedCount} new room allocations made`,
      body: `${placedCount} student(s) were allocated rooms by the matching engine.${shortage}`,
      link: '/admin/allocations',
    });
  }
}

/** Ends a student's current allocation (for example when they leave the hostel). */
export function vacateAllocation(allocationId) {
  transaction(() => {
    const allocation = allocations.findById(allocationId);
    if (!allocation || allocation.vacated_at) throw new DomainError('That allocation is no longer active.');
    allocations.markVacated(allocationId);
    rooms.adjustOccupancy(allocation.room_id, -1);
    refreshRoomScores(allocation.room_id);
    const student = students.findById(allocation.student_id);
    notifyUser(student.user_id, {
      subject: 'Your room allocation has ended',
      body: 'Your hostel room allocation was ended by the hostel administrator.',
      link: '/student/allocation',
    });
  });
}

/** The student's allocation with each roommate and a per-criterion comparison against them. */
export function allocationDetails(studentId) {
  const allocation = allocations.findActiveByStudent(studentId);
  if (!allocation) return null;
  const occupants = allocations.listOccupants(allocation.room_id);
  const selfProfile = profileFromRow(occupants.find((occupant) => occupant.id === studentId));
  const roommates = occupants
    .filter((occupant) => occupant.id !== studentId)
    .map((occupant) => ({ ...occupant, comparison: compareProfiles(selfProfile, profileFromRow(occupant)) }));
  return { allocation, roommates };
}
