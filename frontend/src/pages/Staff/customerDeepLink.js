export function revealCustomer(rows, filtered, id, pageSize) {
  if (!/^[a-f\d]{24}$/i.test(id || '')) return null;
  const target = rows.find(row => row.role === 'customer' && String(row._id).toLowerCase() === id.toLowerCase());
  if (!target) return null;
  const visible = filtered.some(row => String(row._id) === String(target._id)) ? filtered : [target, ...filtered];
  return { target, rows: visible, page: Math.floor(visible.findIndex(row => String(row._id) === String(target._id)) / pageSize) + 1 };
}
export function highlightCustomerRow(row) {
  if (!row) return () => {};
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('customer-ai-highlight');
  const timer = setTimeout(() => row.classList.remove('customer-ai-highlight'), 4000);
  return () => { clearTimeout(timer); row.classList.remove('customer-ai-highlight'); };
}
