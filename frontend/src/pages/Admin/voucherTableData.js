const PAGE_SIZE = 5;

export function filterVoucherRows(rows, { query = '', status = 'all', type = 'all', getStatus, getText }) {
  const search = query.trim().toLocaleLowerCase();
  return rows.filter((row) => (status === 'all' || getStatus(row) === status)
    && (type === 'all' || row.type === type)
    && (!search || getText(row).filter((value) => value != null).join(' ').toLocaleLowerCase().includes(search)));
}

export function paginateVoucherRows(rows, requestedPage, pageSize = PAGE_SIZE) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(requestedPage, totalPages));
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), page, totalPages, total };
}

export const canEditVoucherExpiry = (voucher) => ['available', 'expired'].includes(voucher.status) && !voucher.usedAt && !voucher.bookingId;

export function vietnamDateTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '';
  return new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 16);
}

export function voucherExpiryTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) return null;
  const date = new Date(`${value}:00+07:00`);
  return !Number.isNaN(date.getTime()) && vietnamDateTime(date) === value ? date : null;
}
