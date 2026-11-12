export const ASSISTANT_SPLITTER_WIDTH = 8;
export const DEFAULT_ASSISTANT_CHAT_RATIO = 1.12 / 2.12;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function assistantSplitLayout({ width, historyWidth, chatRatio, collapsed = false, compact = false }) {
  const total = Math.max(0, finite(width, 1200));
  const historyHandle = collapsed ? 0 : ASSISTANT_SPLITTER_WIDTH;
  const previewHandle = compact ? 0 : ASSISTANT_SPLITTER_WIDTH;
  const minHistory = 180;
  const maxHistory = Math.max(minHistory, Math.min(360, total - historyHandle - previewHandle - (compact ? 320 : 640)));
  const history = collapsed ? 68 : clamp(finite(historyWidth, compact ? 195 : 230), minHistory, maxHistory);
  const available = Math.max(0, total - history - historyHandle - previewHandle);
  const minChat = Math.min(320, available / 2);
  const maxChat = Math.max(minChat, available - minChat);
  const chat = compact ? available : clamp(available * finite(chatRatio, DEFAULT_ASSISTANT_CHAT_RATIO), minChat, maxChat);
  return { history, chat, preview: compact ? total : available - chat, available,
    minHistory, maxHistory, minChat, maxChat, ratio: available ? chat / available : DEFAULT_ASSISTANT_CHAT_RATIO };
}
