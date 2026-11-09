import { filterAndSortSessions, SESSION_PAGE_SIZE } from './sessionPagination.js';

export const sessionRowTarget = (sessionId, sessions) => {
  const rows = filterAndSortSessions(sessions);
  const index = rows.findIndex(row => String(row._id).toLowerCase() === String(sessionId).toLowerCase());
  return index < 0 ? null : { id: String(rows[index]._id), page: Math.floor(index / SESSION_PAGE_SIZE) + 1 };
};

export const highlightSessionRow = row => {
  if (!row) return () => {};
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('session-ai-highlight');
  const timer = setTimeout(() => row.classList.remove('session-ai-highlight'), 4000);
  return () => { clearTimeout(timer); row.classList.remove('session-ai-highlight'); };
};

export const resolveSessionDeepLink = ({ sessionId, sessions, loading, error }) => {
  if (!sessionId || loading || error) return { session: null, missing: false };
  const session = sessions.find((item) => String(item._id).toLowerCase() === sessionId.toLowerCase()) || null;
  return { session, missing: !session };
};

// Only the newest Admin request may publish a result, including after cancellation.
export const createSessionVerification = (request, publish) => {
  let generation = 0;
  return {
    cancel() { generation += 1; },
    async verify(role, sessionId, requestKey) {
      const current = ++generation;
      if (role !== 'admin' || !sessionId) return;
      publish({ sessionId, requestKey, status: 'loading', session: null });
      let result;
      try {
        const response = await request();
        if (response.status === 401 || response.status === 403) {
          result = { status: 'unavailable', session: null };
        } else if (!response.ok || !response.data?.success || !Array.isArray(response.data.data)) {
          result = { status: 'error', session: null };
        } else {
          const sessions = response.data.data;
          const { session } = resolveSessionDeepLink({ sessionId, sessions, loading: false, error: '' });
          result = { status: session ? 'verified' : 'missing', session, sessions };
        }
      } catch {
        result = { status: 'error', session: null };
      }
      if (current === generation) publish({ sessionId, requestKey, ...result });
    },
  };
};

export const verifiedSessionForQuery = (verification, sessionId, requestKey) => (
  sessionId && verification.sessionId === sessionId && verification.requestKey === requestKey && verification.status === 'verified'
    ? verification.session : null
);
