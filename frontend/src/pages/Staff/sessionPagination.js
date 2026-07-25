export const SESSION_PAGE_SIZE = 15;

const getTimestamp = (value) => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getPrice = (session) => {
  const price = Number(session?.totalPrice);
  return Number.isFinite(price) ? price : 0;
};

export const filterAndSortSessions = (
  sessions = [],
  { searchQuery = '', status = 'all', sortBy = 'newest' } = {},
) => {
  const normalizedQuery = String(searchQuery).trim().toLowerCase();
  const filteredSessions = (Array.isArray(sessions) ? sessions : []).filter((session) => {
    const matchesSearch = !normalizedQuery
      || String(session?.licensePlate || '').toLowerCase().includes(normalizedQuery)
      || String(session?.phone || '').toLowerCase().includes(normalizedQuery);
    const matchesStatus = status === 'all' || session?.status === status;

    return matchesSearch && matchesStatus;
  });

  return filteredSessions.sort((first, second) => {
    if (sortBy === 'oldest') {
      return getTimestamp(first?.checkInTime) - getTimestamp(second?.checkInTime);
    }
    if (sortBy === 'price-high') {
      return getPrice(second) - getPrice(first);
    }
    if (sortBy === 'price-low') {
      return getPrice(first) - getPrice(second);
    }

    return getTimestamp(second?.checkInTime) - getTimestamp(first?.checkInTime);
  });
};

const clampPage = (page, totalPages) => {
  const parsedPage = Number.isFinite(Number(page)) ? Math.floor(Number(page)) : 1;
  return Math.min(Math.max(parsedPage, 1), totalPages);
};

export const paginateSessions = (
  sessions = [],
  page = 1,
  pageSize = SESSION_PAGE_SIZE,
) => {
  const items = Array.isArray(sessions) ? sessions : [];
  const safePageSize = Math.max(1, Math.floor(Number(pageSize)) || SESSION_PAGE_SIZE);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage = clampPage(page, totalPages);
  const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalItems);

  return {
    currentPage,
    totalPages,
    totalItems,
    startIndex,
    endIndex,
    items: items.slice(startIndex, endIndex),
  };
};

export const getPaginationPages = (page, pageCount) => {
  const totalPages = Math.max(1, Math.floor(Number(pageCount)) || 1);
  const currentPage = clampPage(page, totalPages);

  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pageNumbers = [...new Set([
    1,
    currentPage - 1,
    currentPage,
    currentPage + 1,
    totalPages,
  ].filter((value) => value >= 1 && value <= totalPages))].sort((first, second) => first - second);

  return pageNumbers.flatMap((pageNumber, index) => {
    if (index === 0) return [pageNumber];

    const previousPage = pageNumbers[index - 1];
    if (pageNumber - previousPage <= 1) return [pageNumber];

    return [previousPage === 1 ? 'ellipsis-start' : 'ellipsis-end', pageNumber];
  });
};
