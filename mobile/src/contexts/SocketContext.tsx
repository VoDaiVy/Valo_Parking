import { AppState } from 'react-native';
import { createContext, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { socketClient } from '@/services/socket/socketClient';
import { tokenStorage } from '@/services/storage/tokenStorage';

interface SocketContextValue {
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  emit: (event: string, payload?: unknown) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler?: (...args: unknown[]) => void) => void;
}

export const SocketContext = createContext<SocketContextValue | undefined>(undefined);

export const SocketProvider = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useAuth();
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(async () => {
    const token = await tokenStorage.getAccessToken();

    if (token) {
      socketClient.connect(token);
      setIsConnected(socketClient.getConnectionStatus());
    }
  }, []);

  const disconnect = useCallback(() => {
    socketClient.disconnect();
    setIsConnected(false);
  }, []);

  useEffect(() => {
    const connected = () => setIsConnected(true);
    const disconnected = () => setIsConnected(false);
    socketClient.on('connect', connected);
    socketClient.on('disconnect', disconnected);
    return () => {
      socketClient.off('connect', connected);
      socketClient.off('disconnect', disconnected);
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void connect();
    } else {
      disconnect();
    }
  }, [connect, disconnect, isAuthenticated]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isAuthenticated && !socketClient.getConnectionStatus()) {
        void connect();
      }
    });

    return () => subscription.remove();
  }, [connect, isAuthenticated]);

  const value = useMemo<SocketContextValue>(
    () => ({
      isConnected,
      connect,
      disconnect,
      emit: socketClient.emit.bind(socketClient),
      on: socketClient.on.bind(socketClient),
      off: socketClient.off.bind(socketClient),
    }),
    [connect, disconnect, isConnected],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};
