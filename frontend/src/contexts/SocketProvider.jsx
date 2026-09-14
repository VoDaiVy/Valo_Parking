import { createContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

/**
 * SocketProvider — wraps the app and provides a Socket.IO connection
 * that auto-connects when the user is logged in and disconnects on logout.
 *
 * Listens for 'valo_auth_change' events to reconnect/disconnect.
 */
export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const connect = () => {
      const token = localStorage.getItem('accessToken');

      // If already connected with same token status
      if (socketRef.current?.connected) {
        return;
      }

      // Disconnect old socket if exists
      if (socketRef.current) {
        socketRef.current.disconnect();
      }

      const serverUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001/api')
        .replace('/api', '');

      const newSocket = io(serverUrl, {
        auth: token ? { token } : {},
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
      });

      newSocket.on('connect', () => {
        console.log('🔌 Socket connected:', newSocket.id);
      });

      newSocket.on('connect_error', (err) => {
        console.error('🔌 Socket connection error:', err.message);
      });

      newSocket.on('disconnect', (reason) => {
        console.log('🔌 Socket disconnected:', reason);
      });

      socketRef.current = newSocket;
      setSocket(newSocket);
    };

    // Connect on mount
    connect();

    // Listen for auth changes
    const handleAuthChange = () => {
      // Small delay to let localStorage update settle
      setTimeout(connect, 100);
    };

    window.addEventListener('valo_auth_change', handleAuthChange);
    window.addEventListener('focus', handleAuthChange);

    return () => {
      window.removeEventListener('valo_auth_change', handleAuthChange);
      window.removeEventListener('focus', handleAuthChange);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}

export default SocketContext;
