export const buildBookingUrl = (serviceId) => {
  const normalizedServiceId = String(serviceId || '').trim();
  if (!normalizedServiceId) return '/booking';

  const params = new URLSearchParams({ serviceId: normalizedServiceId });
  return `/booking?${params.toString()}`;
};

export const buildLoginUrl = (returnUrl) => {
  const normalizedReturnUrl = String(returnUrl || '').trim();
  if (!normalizedReturnUrl) return '/login';

  const params = new URLSearchParams({ returnUrl: normalizedReturnUrl });
  return `/login?${params.toString()}`;
};

export const getSafeReturnUrl = (search = '') => {
  const returnUrl = new URLSearchParams(search).get('returnUrl');

  if (!returnUrl || !returnUrl.startsWith('/') || returnUrl.startsWith('//')) {
    return '';
  }

  return returnUrl;
};

export const resolvePostLoginDestination = (role, returnUrl = '') => {
  const roleRedirect = {
    admin: '/admin/dashboard',
    staff: '/staff/dashboard',
  };

  if (roleRedirect[role]) return roleRedirect[role];
  if (role === 'customer' && returnUrl) return returnUrl;
  return '/';
};

export const findRequestedService = (services = [], serviceId = '') =>
  services.find((service) => String(service?._id) === String(serviceId)) || null;
