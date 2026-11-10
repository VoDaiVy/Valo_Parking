// Collect the unread snapshot before PATCHing: changing it while paging skips rows.
export async function markAllUnreadNotifications({ getNotifications, markRead, onRead }) {
  const ids = new Set();
  let pages = 1;
  for (let page = 1; page <= pages; page += 1) {
    const response = await getNotifications('unread', page);
    const data = response.data?.data;
    if (!response.ok || !Array.isArray(data?.notifications)) throw new Error('Unable to load unread notifications. Please try again.');
    if (!Number.isFinite(data.total) || data.total < 0 || (!data.notifications.length && data.total > 0 && page === 1)) throw new Error('Unable to load unread notifications. Please try again.');
    if (page === 1) pages = data.notifications.length ? Math.ceil(data.total / data.notifications.length) : 0;
    for (const row of data.notifications) if (!row.isRead) ids.add(row._id);
  }
  const readIds = [], failedIds = [];
  const snapshot = [...ids];
  // Small batches avoid flooding the existing individual-read endpoint.
  for (let start = 0; start < snapshot.length; start += 4) {
    await Promise.all(snapshot.slice(start, start + 4).map(async id => {
      try {
        const response = await markRead(id);
        if (!response.ok) throw new Error('Read failed');
        readIds.push(id);
        onRead(id);
      } catch { failedIds.push(id); }
    }));
  }
  return { readIds, failedIds };
}

export function applyNotificationRead(rows, id, filter) {
  return filter === 'unread' ? rows.filter(row => row._id !== id) : rows.map(row => row._id === id ? { ...row, isRead: true } : row);
}
