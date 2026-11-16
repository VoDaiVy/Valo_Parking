export const bookingManagementScope = (range, date, floorId, search) => ({
  ...(range === 'daily' ? { date } : {}),
  ...(floorId !== 'all' ? { floorId } : {}),
  ...(search.trim() ? { search: search.trim() } : {}),
});
