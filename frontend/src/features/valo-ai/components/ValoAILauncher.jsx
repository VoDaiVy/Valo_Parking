import { useState } from 'react';
import ValoAIMascot from './ValoAIMascot';

// Both roles use the original artwork, geometry, effects and pointer behavior.
export default function ValoAILauncher({ position, mascotRef, mascotVisible, triggerRef, controls, open, busy, preview, dragging, unreadCount, onPointerDown, onPointerMove, onPointerUp, onTriggerClick, children }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const onMascotMove = event => {
    onPointerMove(event);
    if (dragging) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTilt({ x: ((event.clientY - rect.top) / rect.height - 0.5) * -12, y: ((event.clientX - rect.left) / rect.width - 0.5) * 12 });
  };
  return <div ref={mascotRef} className="valo-ai-anchor" style={{ left: position.x, top: position.y, visibility: mascotVisible === false ? 'hidden' : undefined }}>
    {children}
    <button ref={triggerRef} type="button" aria-label="Open VALO AI" aria-expanded={open} aria-controls={controls} className={`valo-ai-trigger ${dragging ? 'is-dragging' : ''} ${busy ? 'is-thinking' : ''} ${preview ? 'has-notification' : ''} ${open ? 'is-open' : ''}`} onPointerDown={onPointerDown} onPointerMove={onMascotMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => setTilt({ x: 0, y: 0 })} onClick={onTriggerClick}>
      <span className="valo-ai-platform"/>
      <span className="valo-ai-car" aria-hidden="true" style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}><ValoAIMascot size={82}/></span>
      {unreadCount > 0 && <span key={unreadCount} className="valo-ai-badge" aria-label={`${unreadCount} unread notifications`}>{unreadCount}</span>}
      <span className="valo-ai-label">VALO AI</span>
    </button>
  </div>;
}
