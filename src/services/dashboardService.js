import * as allocations from '../repositories/allocations.js';
import * as complaints from '../repositories/complaints.js';
import * as payments from '../repositories/payments.js';
import * as rooms from '../repositories/rooms.js';
import * as students from '../repositories/students.js';

function percent(part, whole) {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/** The live figures shown on the hostel administrator's occupancy dashboard. */
export function occupancySnapshot() {
  const totals = rooms.occupancyTotals();
  const complaintCounts = complaints.countsByStatus();
  const averageScore = allocations.averageScore();
  return {
    rooms: totals.rooms,
    fullRooms: totals.full_rooms,
    roomsWithSpace: totals.rooms - totals.full_rooms,
    emptyRooms: totals.empty_rooms,
    partialRooms: totals.partial_rooms,
    beds: totals.beds,
    occupiedBeds: totals.occupied_beds,
    freeBeds: totals.beds - totals.occupied_beds,
    occupancyRate: percent(totals.occupied_beds, totals.beds),
    awaitingAllocation: students.countAwaitingAllocation(),
    openComplaints: complaintCounts.pending + complaintCounts.in_progress + complaintCounts.escalated,
    escalatedComplaints: complaintCounts.escalated,
    averageCompatibility: averageScore == null ? null : Math.round(averageScore),
    hostels: rooms.occupancyByHostel().map((hostel) => ({
      ...hostel,
      freeBeds: hostel.beds - hostel.occupied_beds,
      occupancyRate: percent(hostel.occupied_beds, hostel.beds),
    })),
    generatedAt: new Date().toISOString(),
  };
}

export function dashboard() {
  return {
    snapshot: occupancySnapshot(),
    payments: payments.summary(),
    complaints: complaints.countsByStatus(),
    recentAllocations: allocations.listRecent(),
  };
}
