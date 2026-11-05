const ATTRIBUTE = 'data-valo-typography';

// Body scope includes dialogs, dropdowns and 3D Html portals outside the layout.
export function scopeAdminTypography(element, role) {
  if (role !== 'admin') return () => {};
  const previous = element.getAttribute(ATTRIBUTE);
  element.setAttribute(ATTRIBUTE, 'admin');
  return () => {
    if (previous === null) element.removeAttribute(ATTRIBUTE);
    else element.setAttribute(ATTRIBUTE, previous);
  };
}
