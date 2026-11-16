import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { clampMascot, measureMascotBounds, observeMascotBounds } from '../utils/mascotBounds';

const STORAGE_KEY = 'valo-ai-position-v1';
const readPosition = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return saved;
  } catch { /* unavailable storage or invalid saved position */ }
  return null;
};

export default function useMascotPosition(contentRef) {
  const location = useLocation();
  const mascotRef = useRef(null);
  const [savedPosition] = useState(readPosition);
  const initialPosition = useRef(savedPosition);
  const initialized = useRef(false);
  const [position, setPosition] = useState(initialPosition.current || { x: 0, y: 0 });
  const [visible, setVisible] = useState(false);
  const clampPosition = useCallback(candidate => {
    const bounds = measureMascotBounds(contentRef.current, mascotRef.current);
    return bounds ? clampMascot(candidate, bounds) : candidate;
  }, [contentRef]);

  useLayoutEffect(() => {
    const revalidate = () => {
      const bounds = measureMascotBounds(contentRef.current, mascotRef.current);
      if (!bounds) return;
      setVisible(bounds.fits);
      const initialize = !initialized.current && !initialPosition.current;
      setPosition(previous => {
        // Retain the existing initial bottom/right spacing; it is not a boundary offset.
        const candidate = initialize ? { x: bounds.maxX - 24, y: bounds.maxY - 24 } : previous;
        const next = clampMascot(candidate, bounds);
        return next.x === previous.x && next.y === previous.y ? previous : next;
      });
      initialized.current = true;
    };
    revalidate(); // Clamp saved/default coordinates before the first paint and on navigation.
    return observeMascotBounds(contentRef.current, mascotRef.current, revalidate);
  }, [contentRef, location.key]);

  const persistPosition = candidate => {
    const next = clampPosition(candidate);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage is optional */ }
    return next;
  };
  return { position, setPosition, mascotRef, visible, clampPosition, persistPosition };
}
