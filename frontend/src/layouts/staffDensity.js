export const STAFF_DENSITY_CLASS = 'staff-density-active';

export function getDashboardDensityClass(role) {
  return role === 'staff' ? STAFF_DENSITY_CLASS : '';
}
