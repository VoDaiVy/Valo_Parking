import { Children, cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import { assistantSplitLayout, DEFAULT_ASSISTANT_CHAT_RATIO } from '../../utils/assistantSplitLayout';

export default function ResizableAssistantShell({ children, historyCollapsed, language }) {
  const shellRef = useRef(null);
  const dragRef = useRef(null);
  const frameRef = useRef(null);
  const [measurement, setMeasurement] = useState({ width: 0, container: 0, viewport: 0 });
  const [preferences, setPreferences] = useState({ historyWidth: undefined, chatRatio: DEFAULT_ASSISTANT_CHAT_RATIO });
  const [dragging, setDragging] = useState(null);
  const id = useId();
  const vi = language === 'vi';
  const compact = measurement.width > 0 && (measurement.container <= 1100 || measurement.viewport <= 1100);
  const mobile = measurement.width > 0 && (measurement.container <= 640 || measurement.viewport <= 640);
  const sizes = assistantSplitLayout({ width: measurement.width || 1200, ...preferences, collapsed: historyCollapsed, compact });
  const [history, chat, preview] = Children.toArray(children);

  const applyPointer = useCallback((clientX) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = clientX - drag.startX;
    if (drag.kind === 'history') {
      setPreferences((current) => ({ ...current, historyWidth: Math.max(drag.sizes.minHistory, Math.min(drag.sizes.maxHistory, drag.sizes.history + delta)) }));
    } else {
      const chatWidth = Math.max(drag.sizes.minChat, Math.min(drag.sizes.maxChat, drag.sizes.chat + delta));
      setPreferences((current) => ({ ...current, chatRatio: chatWidth / drag.sizes.available }));
    }
  }, []);
  const finishDrag = useCallback((commit = true, unmount = false) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (frameRef.current !== null) { window.cancelAnimationFrame(frameRef.current); frameRef.current = null; }
    if (commit && !unmount) applyPointer(drag.lastX);
    dragRef.current = null;
    if (!drag.hadResizeClass) document.body.classList.remove('valo-assistant-resizing');
    if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
    if (!unmount) setDragging(null);
  }, [applyPointer]);
  useEffect(() => {
    const element = shellRef.current;
    const measure = () => {
      finishDrag();
      setMeasurement({ width: element.clientWidth, container: element.parentElement.clientWidth, viewport: window.innerWidth });
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    const initial = window.requestAnimationFrame(measure);
    const blur = () => finishDrag();
    const escape = (event) => { if (event.key === 'Escape') finishDrag(); };
    window.addEventListener('resize', measure);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', escape);
    return () => {
      observer?.disconnect(); window.cancelAnimationFrame(initial);
      window.removeEventListener('resize', measure); window.removeEventListener('blur', blur); window.removeEventListener('keydown', escape);
      finishDrag(false, true);
    };
  }, [finishDrag]);

  const startDrag = (event, kind) => {
    if (event.button !== 0 || mobile || (kind === 'history' && historyCollapsed) || (kind === 'preview' && compact)) return;
    event.preventDefault();
    finishDrag();
    const element = event.currentTarget;
    element.focus(); element.setPointerCapture(event.pointerId);
    dragRef.current = { kind, element, pointerId: event.pointerId, startX: event.clientX, lastX: event.clientX, sizes,
      hadResizeClass: document.body.classList.contains('valo-assistant-resizing') };
    document.body.classList.add('valo-assistant-resizing');
    setDragging(kind);
  };
  const moveDrag = (event) => {
    if (!dragRef.current || event.pointerId !== dragRef.current.pointerId) return;
    dragRef.current.lastX = event.clientX;
    if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      if (dragRef.current) applyPointer(dragRef.current.lastX);
    });
  };
  const reset = (kind) => {
    finishDrag();
    setPreferences((current) => kind === 'history' ? { ...current, historyWidth: undefined } : { ...current, chatRatio: DEFAULT_ASSISTANT_CHAT_RATIO });
  };
  const keyboardResize = (event, kind) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const min = kind === 'history' ? sizes.minHistory : sizes.minChat;
    const max = kind === 'history' ? sizes.maxHistory : sizes.maxChat;
    const value = kind === 'history' ? sizes.history : sizes.chat;
    const next = event.key === 'Home' ? min : event.key === 'End' ? max
      : Math.max(min, Math.min(max, value + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 16)));
    setPreferences((current) => kind === 'history' ? { ...current, historyWidth: next } : { ...current, chatRatio: next / sizes.available });
  };
  const separator = (kind) => {
    const disabled = mobile || (kind === 'history' ? historyCollapsed : compact);
    const label = kind === 'history' ? (vi ? 'Điều chỉnh chiều rộng lịch sử và khung chat' : 'Resize history and chat')
      : (vi ? 'Điều chỉnh chiều rộng khung chat và booking' : 'Resize chat and booking preview');
    return <div className={`valo-assistant-splitter is-${kind} ${dragging === kind ? 'is-dragging' : ''}`}
      role="separator" aria-orientation="vertical" aria-label={label} aria-controls={kind === 'history' ? `${id}-history ${id}-chat` : `${id}-chat ${id}-preview`}
      aria-valuemin={Math.round(kind === 'history' ? sizes.minHistory : sizes.minChat)} aria-valuemax={Math.round(kind === 'history' ? sizes.maxHistory : sizes.maxChat)}
      aria-valuenow={Math.round(kind === 'history' ? sizes.history : sizes.chat)} aria-valuetext={`${Math.round(kind === 'history' ? sizes.history : sizes.chat)} px`}
      tabIndex={disabled ? -1 : 0} title={`${label}. ${vi ? 'Kéo hoặc dùng phím mũi tên; nhấp đúp để đặt lại.' : 'Drag or use arrow keys; double-click to reset.'}`}
      onPointerDown={(event) => startDrag(event, kind)} onPointerMove={moveDrag}
      onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag()} onLostPointerCapture={() => finishDrag()}
      onKeyDown={(event) => keyboardResize(event, kind)} onDoubleClick={() => reset(kind)} />;
  };
  const style = measurement.width ? {
    '--valo-history-width': `${sizes.history}px`, '--valo-history-handle': historyCollapsed ? '0px' : '8px',
    '--valo-chat-fr': `${sizes.ratio}fr`, '--valo-preview-fr': `${1 - sizes.ratio}fr`,
  } : undefined;
  return <div className="valo-assistant-resizable">
    <div ref={shellRef} className={`valo-assistant-shell ${historyCollapsed ? 'is-history-collapsed' : ''} ${dragging ? 'is-resizing' : ''}`} style={style}>
      {cloneElement(history, { id: `${id}-history` })}{separator('history')}
      {cloneElement(chat, { id: `${id}-chat` })}{separator('preview')}
      {cloneElement(preview, { id: `${id}-preview` })}
    </div>
  </div>;
}
