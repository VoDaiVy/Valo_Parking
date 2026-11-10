// Only derive destinations from records returned by an authorized read tool.
const destinations = {
  get_active_sessions: ['/admin/sessions', 'sessionId', 'Session'],
  search_sessions: ['/admin/sessions', 'sessionId', 'Session'],
  get_session_detail: ['/admin/sessions', 'sessionId', 'Session'],
  search_bookings: ['/admin/parking-lots', 'bookingId', 'Booking'],
  get_booking_detail: ['/admin/parking-lots', 'bookingId', 'Booking'],
  get_parking_floors: ['/admin/parking-lots', 'floorId', 'Floor'],
  search_users: ['/admin/accounts', 'userId', 'Account'],
  get_current_user: ['/admin/accounts', 'userId', 'Account'],
  get_user_detail: ['/admin/accounts', 'userId', 'Account'],
  get_subscription_members: ['/admin/subscriptions', 'subscriptionId', 'Membership'],
  get_subscription_detail: ['/admin/subscriptions', 'subscriptionId', 'Membership'],
  search_ticket_packages: ['/admin/tickets', 'packageId', 'Package'],
  get_ticket_package_detail: ['/admin/tickets', 'packageId', 'Package'],
  get_package_list: ['/admin/tickets', 'packageId', 'Package'],
  search_services: ['/admin/services', 'serviceId', 'Service'],
  get_service_detail: ['/admin/services', 'serviceId', 'Service'],
  get_service_catalog: ['/admin/services', 'serviceId', 'Service'],
};
function entityLinks(tool, data, role = 'admin') {
  if (role === 'staff') {
    if (!['search_users', 'get_user_detail'].includes(tool)) return [];
    const rows = data?.items || (data ? [data] : []);
    return rows.filter(row => row.role === 'customer' && /^[a-f\d]{24}$/i.test(String(row._id))).map(row => ({ url: `/staff/accounts?userId=${row._id}`, label: `Customer: ${row.username || row.email || row._id}` }));
  }
  if (tool === 'get_pricing_config' && data) return [{ url: '/admin/pricing', label: 'Current pricing' }];
  if (tool === 'get_parking_slots') return (data?.items || []).flatMap(row => {
    const floorId = String(row.floorID?._id || row.floorID || '');
    if (!/^[a-f\d]{24}$/i.test(String(row._id)) || !/^[a-f\d]{24}$/i.test(floorId)) return [];
    return [{ url: `/admin/parking-lots?floorId=${floorId}&slotId=${row._id}`, label: `Slot: ${row.slotNumber} (${row.floorID?.name || floorId})` }];
  });
  const destination = destinations[tool];
  if (!destination || !data) return [];
  const [path, parameter, type] = destination;
  const rows = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [data];
  return rows.filter(row => /^[a-f\d]{24}$/i.test(String(row?._id || ''))).map(row => ({
    url: `${path}?${parameter}=${row._id}`,
    label: `${type}: ${row.licensePlate || row.name || row.email || row.ticketPackage?.name || row._id}${row.checkInTime ? ` - ${row.checkInTime}` : ''}`,
  }));
}
module.exports = { entityLinks };
