const accountTypes = new Set(['UPDATE_USER_STATUS', 'CHANGE_USER_ROLE', 'UPDATE_USER_PROFILE']);

export function approvalConfirmed(response, draft, approve) {
  if (!response.ok || response.data?.success !== true) return false;
  if (!approve || !accountTypes.has(draft.type)) return true;
  const result = response.data.data;
  const target = draft.targetId || draft.current?._id;
  return result?.status === 'EXECUTED' && result.type === draft.type && /^[a-f\d]{24}$/i.test(String(result.id || ''))
    && (!target || String(target).toLowerCase() === String(result.id).toLowerCase());
}
