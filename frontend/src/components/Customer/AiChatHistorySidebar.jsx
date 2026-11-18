import { useLanguage } from '../../i18n/hooks/useLanguage';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, MessageSquare, MoreVertical, Pencil, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';

export default function AiChatHistorySidebar({ id, items, loading, error, search, onSearch, onNew, onOpen, onRename, onDelete, selectedId, disabled, hasMore, onMore, collapsed, onToggle }) {
  const { language, t } = useLanguage();
  const locale = language === 'vi' ? 'vi-VN' : 'en-GB';
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
      setModalError(caught.message || (t('aiBookingUi.unableToCompleteTheActionPlease')));
    } finally { setSaving(false); }
  };
  const timestamp = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const day = (input) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(input);
    const clock = new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(date);
    if (day(date) === day(new Date(referenceTime))) return t('aiBookingUi.historyToday', { time: clock });
    if (day(date) === day(new Date(referenceTime - 86400000))) return t('aiBookingUi.yesterday');
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  };
  return <>
    <aside id={id} aria-label={t('aiBookingUi.chatHistory')} className="valo-history">
      <div className="valo-history-heading">
        <MessageSquare size={19} />
        <h2>{t('aiBookingUi.chatHistory2')}</h2>
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={t(collapsed ? 'aiBookingUi.expandHistory' : 'aiBookingUi.collapseHistory')} className="valo-history-collapse">{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
      </div>
      <div className="valo-history-tools">
        <button type="button" disabled={disabled} onClick={onNew} aria-label={t('aiBookingUi.newChat')} title={t('aiBookingUi.newChat')} className="valo-history-new disabled:opacity-50">
          <Plus size={17} /><span>{t('aiBookingUi.newChat2')}</span>
        </button>
        <label className="valo-history-search">
          <Search size={15} className="shrink-0 text-gray-400" />
          <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} maxLength={100} aria-label={t('aiBookingUi.searchChatHistory')} placeholder={t('aiBookingUi.searchConversations')} className="min-w-0 w-full bg-transparent text-xs outline-none" />
        </label>
      </div>
      <p className="valo-history-caption">{t('aiBookingUi.recentChats')}</p>
      <div className="valo-history-list" aria-busy={loading}>
        {loading && <p role="status" className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500"><Loader2 size={14} className="animate-spin" />{t('aiBookingUi.loading')}</p>}
        {error && <p role="alert" className="m-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
        {!loading && !error && !items.length && <div className="px-3 py-8 text-center text-xs leading-5 text-gray-400"><MessageSquare size={24} className="mx-auto mb-3 text-gray-300" />{search ? (t('aiBookingUi.noMatchingConversations')) : (t('aiBookingUi.yourConversationsWillAppearHere'))}</div>}
        {items.map((item) => <div key={item.sessionId} className={`valo-history-item ${selectedId === item.sessionId ? 'is-selected' : ''}`}>
          <button type="button" disabled={disabled} onClick={() => onOpen(item)} aria-current={selectedId === item.sessionId ? 'true' : undefined} title={item.title} className="valo-history-open disabled:opacity-50">
            <span className="valo-history-icon"><MessageSquare size={14} /></span>
            <span className="valo-history-label"><strong>{item.title}</strong><time dateTime={item.updatedAt}>{timestamp(item.updatedAt)}</time></span>
          </button>
          <details className="valo-history-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
            <summary aria-label={t('aiBookingUi.historyManage', { title: item.title })} onClick={(event) => { if (disabled) event.preventDefault(); }}><MoreVertical size={16} /></summary>
            <div className="valo-history-menu-content">
              <button type="button" disabled={disabled} onClick={(event) => { event.currentTarget.closest('details').open = false; openAction('rename', item); }} aria-label={t('aiBookingUi.historyRename', { title: item.title })}><Pencil size={13} />{t('aiBookingUi.rename')}</button>
              <button type="button" disabled={disabled} onClick={(event) => { event.currentTarget.closest('details').open = false; openAction('delete', item); }} aria-label={t('aiBookingUi.historyDelete', { title: item.title })} className="text-rose-600"><Trash2 size={13} />{t('aiBookingUi.delete')}</button>
            </div>
          </details>
        </div>)}
        {hasMore && <button type="button" disabled={loading} onClick={onMore} className="w-full rounded-xl px-3 py-3 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50">{t('aiBookingUi.loadMore')}</button>}
      </div>
      <div className="valo-history-help"><div><strong><Sparkles size={15} className="text-amber-500" />{t('aiBookingUi.needHelp')}</strong><p>{t('aiBookingUi.askValoAssistantAnytime')}</p></div><img src="/assets/notification-mascots/success.png" alt="" aria-hidden="true" /></div>
    </aside>
    <dialog ref={dialogRef} onCancel={(event) => { if (saving) event.preventDefault(); else setAction(null); }} onClose={() => setAction(null)} aria-labelledby="chat-history-dialog-title" className="m-auto w-[min(420px,calc(100%-32px))] rounded-3xl border border-gray-200 bg-white p-6 shadow-2xl backdrop:bg-gray-950/40">
      {action && <form onSubmit={submitAction}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="chat-history-dialog-title" className="font-black text-gray-900">{action.type === 'rename' ? (t('aiBookingUi.renameConversation')) : (t('aiBookingUi.deleteConversation'))}</h2>
          <button type="button" disabled={saving} onClick={() => setAction(null)} aria-label={t('aiBookingUi.close')} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
        </div>
        {action.type === 'rename' ? <input autoFocus required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} aria-label={t('aiBookingUi.conversationTitle')} className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-yellow-400" />
          : <p className="break-words text-sm leading-6 text-gray-600">{t('aiBookingUi.historyDeletePrompt', { title: action.item.title })}</p>}
        {modalError && <p role="alert" className="mt-3 text-sm text-rose-600">{modalError}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={() => setAction(null)} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600">{t('aiBookingUi.cancel')}</button>
          <button type="submit" disabled={saving || (action.type === 'rename' && !title.trim())} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50 ${action.type === 'delete' ? 'bg-rose-600 text-white' : 'bg-yellow-400 text-gray-900'}`}>{saving && <Loader2 size={15} className="animate-spin" />}{action.type === 'delete' ? (t('aiBookingUi.deleteConversation2')) : (t('aiBookingUi.saveName'))}</button>
        </div>
      </form>}
    </dialog>
  </>;
}
