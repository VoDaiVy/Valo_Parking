const PAGE_SIZE = 4;

// Merge all payment sources before paging so no source is capped or skipped.
function paginateRevenueTransactions(records, requestedPage) {
  const parsed = Number(requestedPage);
  const requested = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
  const sorted = [...records].sort((left, right) => new Date(right.paidAt) - new Date(left.paidAt) || left.id.localeCompare(right.id));
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requested, totalPages);
  return {
    recentTransactions: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    transactionPagination: { page, pageSize: PAGE_SIZE, total, totalPages },
  };
}

module.exports = { paginateRevenueTransactions };
