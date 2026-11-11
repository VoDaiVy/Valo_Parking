// An explicit list status comes from this turn, not previous model arguments.
function staffCustomerStatus(message) {
  if (!/^(?:show|list|find|get|search|display)\b/i.test(message.trim()) || !/\b(?:customers?|accounts?)\b/i.test(message)) return undefined;
  const text = message.replace(/[^\s<>]+@[^\s<>]+/g, '');
  if (/\bactive\b/i.test(text) && /\b(?:inactive|blocked|disabled)\b/i.test(text)) return undefined;
  const active = /\bactive\s+(?:customer\s+accounts?|customers?|accounts?)\b|\b(?:customers?|accounts?)\s+(?:(?:who|that) are\s+|with status\s+)?active\b/i.test(text);
  const inactive = /\b(?:inactive|blocked|disabled)\s+(?:customer\s+accounts?|customers?|accounts?)\b|\b(?:customers?|accounts?)\s+(?:(?:who|that) are\s+|with status\s+)?(?:inactive|blocked|disabled)\b/i.test(text);
  return active === inactive ? undefined : active;
}
module.exports = { staffCustomerStatus };
