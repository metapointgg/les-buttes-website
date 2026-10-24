// The same occupancy rule must be used by availability checks and exported calendars.
// Bookings without an expiresAt field are permanent, including confirmed reservations
// and manual Airbnb/winter-let blocks. Only a positively dated, expired hold is free.
export function slotBlocksAvailability(slot, nowEpoch) {
  if (!slot || typeof slot !== 'object') return false;
  const expiresAt = slot.expiresAt;
  if (Number.isInteger(expiresAt) && expiresAt > 0 && expiresAt < nowEpoch) return false;
  return true;
}
