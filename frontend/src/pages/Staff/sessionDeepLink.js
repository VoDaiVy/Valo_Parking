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
