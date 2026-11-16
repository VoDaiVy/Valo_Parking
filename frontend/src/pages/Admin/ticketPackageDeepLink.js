export const ticketPackageLinkState = (response, packageId) => {
  if ([401, 403].includes(response.status)) return { status: 'unavailable' };
  if (!response.ok || !response.data?.success || !Array.isArray(response.data.data)) return { status: 'error' };
  if (!/^[a-f\d]{24}$/i.test(packageId || '')) return { status: 'missing' };
  const target = response.data.data.find(pkg => String(pkg._id).toLowerCase() === packageId.toLowerCase());
  return target ? { status: 'ready', packageId: String(target._id) } : { status: 'missing' };
};

export const includeLinkedPackage = (filtered, packages, packageId) => {
  if (!packageId) return filtered;
  const visible = new Set(filtered.map(pkg => String(pkg._id).toLowerCase()));
  return packages.filter(pkg => visible.has(String(pkg._id).toLowerCase()) || String(pkg._id).toLowerCase() === packageId.toLowerCase());
};

export const highlightTicketPackageRow = row => {
  if (!row) return () => {};
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('ticket-package-highlight');
  const timer = setTimeout(() => row.classList.remove('ticket-package-highlight'), 4000);
  return () => { clearTimeout(timer); row.classList.remove('ticket-package-highlight'); };
};
