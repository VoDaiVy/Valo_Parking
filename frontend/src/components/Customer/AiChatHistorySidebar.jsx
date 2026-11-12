import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, MessageSquare, MoreVertical, Pencil, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';

export default function AiChatHistorySidebar({ language, items, loading, error, search, onSearch, onNew, onOpen, onRename, onDelete, selectedId, disabled, hasMore, onMore, collapsed, onToggle }) {
  const vi = language === 'vi';
  const [action, setAction] = useState(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [referenceTime, setReferenceTime] = useState(() => Date.now());
  const dialogRef = useRef(null);
  useEffect(() => {
    const timer = window.setInterval(() => setReferenceTime(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (action) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [action]);
  const openAction = (type, item) => {
    setTitle(item.title);
    setModalError('');
    setAction({ type, item });
  };
  const submitAction = async (event) => {
    event.preventDefault();
    if (!action || saving) return;
    setSaving(true);
    setModalError('');
    try {
      if (action.type === 'rename') await onRename(action.item, title.trim());
      else await onDelete(action.item);
      setAction(null);
    } catch (caught) {
      setModalError(caught.message || (vi ? 'Thao tác chưa thành công. Vui lòng thử lại.' : 'Unable to complete the action. Please try again.'));
    } finally { setSaving(false); }
  };
  const timestamp = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const day = (input) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(input);
    const clock = new Intl.DateTimeFormat(vi ? 'vi-VN' : 'en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(date);
    if (day(date) === day(new Date(referenceTime))) return `${vi ? 'Hôm nay' : 'Today'}, ${clock}`;
    if (day(date) === day(new Date(referenceTime - 86400000))) return vi ? 'Hôm qua' : 'Yesterday';
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(vi ? 'vi-VN' : 'en-GB', {
      timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  };
  return <>
    <aside aria-label={vi ? 'Lịch sử trò chuyện' : 'Chat history'} className="valo-history">
      <div className="valo-history-heading">
        <MessageSquare size={19} />
        <h2>{vi ? 'Lịch sử trò chuyện' : 'Chat History'}</h2>
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={vi ? (collapsed ? 'Mở lịch sử' : 'Thu gọn lịch sử') : (collapsed ? 'Expand history' : 'Collapse history')} className="valo-history-collapse">{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
      </div>
      <div className="valo-history-tools">
        <button type="button" disabled={disabled} onClick={onNew} aria-label={vi ? 'Cuộc trò chuyện mới' : 'New chat'} title={vi ? 'Cuộc trò chuyện mới' : 'New chat'} className="valo-history-new disabled:opacity-50">
          <Plus size={17} /><span>{vi ? 'Cuộc trò chuyện mới' : 'New Chat'}</span>
        </button>
        <label className="valo-history-search">
          <Search size={15} className="shrink-0 text-gray-400" />
          <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} maxLength={100} aria-label={vi ? 'Tìm kiếm lịch sử trò chuyện' : 'Search chat history'} placeholder={vi ? 'Tìm cuộc trò chuyện...' : 'Search conversations...'} className="min-w-0 w-full bg-transparent text-xs outline-none" />
        </label>
      </div>
      <p className="valo-history-caption">{vi ? 'Trò chuyện gần đây' : 'Recent chats'}</p>
      <div className="valo-history-list" aria-busy={loading}>
        {loading && <p role="status" className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" />{vi ? 'Đang tải...' : 'Loading...'}</p>}
        {error && <p role="alert" className="m-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
        {!loading && !error && !items.length && <div className="px-3 py-8 text-center text-xs leading-5 text-gray-400"><MessageSquare size={24} className="mx-auto mb-3 text-gray-300" />{search ? (vi ? 'Không tìm thấy cuộc trò chuyện.' : 'No matching conversations.') : (vi ? 'Cuộc trò chuyện của bạn sẽ xuất hiện ở đây.' : 'Your conversations will appear here.')}</div>}
        {items.map((item) => <div key={item.sessionId} className={`valo-history-item ${selectedId === item.sessionId ? 'is-selected' : ''}`}>
          <button type="button" disabled={disabled} onClick={() => onOpen(item)} aria-current={selectedId === item.sessionId ? 'true' : undefined} title={item.title} className="valo-history-open disabled:opacity-50">
            <span className="valo-history-icon"><MessageSquare size={14} /></span>
            <span className="valo-history-label"><strong>{item.title}</strong><time dateTime={item.updatedAt}>{timestamp(item.updatedAt)}</time></span>
          </button>
          <details className="valo-history-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
            <summary aria-label={`${vi ? 'Quản lý' : 'Manage'}: ${item.title}`} onClick={(event) => { if (disabled) event.preventDefault(); }}><MoreVertical size={16} /></summary>
            <div className="valo-history-menu-content">
              <button type="button" disabled={disabled} onClick={(event) => { event.currentTarget.closest('details').open = false; openAction('rename', item); }} aria-label={`${vi ? 'Đổi tên' : 'Rename'}: ${item.title}`}><Pencil size={13} />{vi ? 'Đổi tên' : 'Rename'}</button>
              <button type="button" disabled={disabled} onClick={(event) => { event.currentTarget.closest('details').open = false; openAction('delete', item); }} aria-label={`${vi ? 'Xóa' : 'Delete'}: ${item.title}`} className="text-rose-600"><Trash2 size={13} />{vi ? 'Xóa' : 'Delete'}</button>
            </div>
          </details>
        </div>)}
        {hasMore && <button type="button" disabled={loading} onClick={onMore} className="w-full rounded-xl px-3 py-3 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50">{vi ? 'Xem thêm' : 'Load more'}</button>}
      </div>
      <div className="valo-history-help"><div><strong><Sparkles size={15} className="text-amber-500" />{vi ? 'Cần hỗ trợ?' : 'Need help?'}</strong><p>{vi ? 'Hỏi trợ lý VALO bất cứ lúc nào!' : 'Ask VALO Assistant anytime!'}</p></div><img src="/assets/notification-mascots/success.png" alt="" aria-hidden="true" /></div>
    </aside>
    <dialog ref={dialogRef} onCancel={(event) => { if (saving) event.preventDefault(); else setAction(null); }} onClose={() => setAction(null)} aria-labelledby="chat-history-dialog-title" className="m-auto w-[min(420px,calc(100%-32px))] rounded-3xl border border-gray-200 bg-white p-6 shadow-2xl backdrop:bg-gray-950/40">
      {action && <form onSubmit={submitAction}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="chat-history-dialog-title" className="font-black text-gray-900">{action.type === 'rename' ? (vi ? 'Đổi tên cuộc trò chuyện' : 'Rename conversation') : (vi ? 'Xóa cuộc trò chuyện?' : 'Delete conversation?')}</h2>
          <button type="button" disabled={saving} onClick={() => setAction(null)} aria-label={vi ? 'Đóng' : 'Close'} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
        </div>
        {action.type === 'rename' ? <input autoFocus required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} aria-label={vi ? 'Tên cuộc trò chuyện' : 'Conversation title'} className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-yellow-400" />
          : <p className="break-words text-sm leading-6 text-gray-600">{vi ? `Xóa “${action.item.title}” khỏi lịch sử? Thao tác này không hủy booking đã tạo.` : `Delete “${action.item.title}” from history? This does not cancel any bookings.`}</p>}
        {modalError && <p role="alert" className="mt-3 text-sm text-rose-600">{modalError}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={() => setAction(null)} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600">{vi ? 'Hủy' : 'Cancel'}</button>
          <button type="submit" disabled={saving || (action.type === 'rename' && !title.trim())} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50 ${action.type === 'delete' ? 'bg-rose-600 text-white' : 'bg-yellow-400 text-gray-900'}`}>{saving && <Loader2 size={15} className="animate-spin" />}{action.type === 'delete' ? (vi ? 'Xóa cuộc trò chuyện' : 'Delete conversation') : (vi ? 'Lưu tên' : 'Save name')}</button>
        </div>
      </form>}
    </dialog>
  </>;
}
