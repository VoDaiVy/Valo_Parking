import { Navigate, useLocation } from 'react-router-dom';
import { buildLoginUrl } from '../utils/bookingNavigation';

/**
 * ProtectedRoute
 * @param {string[]} allowedRoles - array of roles allowed to access this route, e.g. ['admin'] or ['admin','manager']
 * @param {React.ReactNode} children
 *
 * Logic:
 *  - Not logged in          → redirect /login
 *  - Logged in with the wrong role → redirect /unauthorized
 *  - Correct role           → render children
 */
export default function ProtectedRoute({ allowedRoles = [], children }) {
  const location = useLocation();
  const raw = sessionStorage.getItem('valo_user');
  const user = raw ? JSON.parse(raw) : null;

  if (!user) {
    const returnUrl = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={buildLoginUrl(returnUrl)} replace />;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
}
