const ATTRIBUTE = 'data-valo-typography';

export function scopeStaffTypography(element, role) {
  if (role !== 'staff') return () => {};
  const previous = element.getAttribute(ATTRIBUTE);
  element.setAttribute(ATTRIBUTE, 'staff');
  return () => {
    if (previous === null) element.removeAttribute(ATTRIBUTE);
    else element.setAttribute(ATTRIBUTE, previous);
  };
}
