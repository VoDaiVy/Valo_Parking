import { useEffect, useRef } from 'react';

/**
 * useQrScannerListener — Hook to capture rapid barcode / QR scanner inputs (USB HID Keyboard mode).
 * Scanner hardware (like GM65) types characters rapidly (< 50ms between keys) and ends with 'Enter'.
 *
 * @param {Function} onScan - Callback when a complete QR/barcode string is scanned: (scannedText) => void
 * @param {boolean} enabled - Whether the listener is active (default: true)
 */
export function useQrScannerListener(onScan, enabled = true) {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const debounceTimerRef = useRef(null);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return undefined;

    const MAX_INTERVAL_MS = 400; // Allow sufficient interval between keystrokes from hardware scanner
    const MIN_LENGTH = 3;

    const triggerScan = () => {
      const text = bufferRef.current.trim();
      bufferRef.current = '';
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      if (text.length >= MIN_LENGTH) {
        console.log('📷 [GM65 Scanner] Full QR Received:', text);
        onScanRef.current?.(text);
      }
    };

    const handleKeyDown = (event) => {
      // Don't intercept modifier keys alone
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) {
        return;
      }

      const now = Date.now();
      const timeDiff = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // If key is Enter, trigger immediately
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (bufferRef.current.trim().length >= MIN_LENGTH) {
          event.preventDefault();
          event.stopPropagation();
          triggerScan();
        }
        return;
      }

      // Printable characters
      if (event.key && event.key.length === 1) {
        // If slow manual typing (user typing manually on keyboard > 400ms per key), reset buffer
        if (timeDiff > MAX_INTERVAL_MS && bufferRef.current.length > 0) {
          bufferRef.current = '';
        }
        bufferRef.current += event.key;

        // Auto-trigger fallback only after 350ms of silence
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        if (bufferRef.current.length >= 8) {
          debounceTimerRef.current = setTimeout(() => {
            triggerScan();
          }, 350);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [enabled]);
}

export default useQrScannerListener;
