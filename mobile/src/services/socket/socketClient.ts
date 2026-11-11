import { io, Socket } from 'socket.io-client';

import { SOCKET_URL } from '@/config/env';

type SocketHandler = (...args: unknown[]) => void;

class SocketClient {
  private socket: Socket | null = null;
  private handlers = new Map<string, Set<SocketHandler>>();

  connect(token: string) {
    if (this.socket) {
      this.socket.auth = { token };
      if (!this.socket.connected) this.socket.connect();
      return;
    }

    this.socket = io(SOCKET_URL, {
      autoConnect: false,
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.handlers.forEach((handlers, event) => handlers.forEach((handler) => this.socket?.on(event, handler)));

    this.socket.on('connect_error', (error) => {
      if (__DEV__) {
        console.warn('[Socket] connection error:', error.message);
      }
    });
    this.socket.connect();
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket?.removeAllListeners();
    this.socket = null;
  }

  on(event: string, handler: SocketHandler) {
    const handlers = this.handlers.get(event) || new Set<SocketHandler>();
    if (handlers.has(handler)) return;
    handlers.add(handler);
    this.handlers.set(event, handlers);
    this.socket?.on(event, handler);
  }

  off(event: string, handler?: SocketHandler) {
    if (handler) {
      this.handlers.get(event)?.delete(handler);
    } else {
      this.handlers.delete(event);
    }
    this.socket?.off(event, handler);
  }

  emit(event: string, payload?: unknown) {
    this.socket?.emit(event, payload);
  }

  getConnectionStatus() {
    return Boolean(this.socket?.connected);
  }
}

export const socketClient = new SocketClient();
