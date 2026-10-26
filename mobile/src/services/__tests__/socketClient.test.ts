import { io } from 'socket.io-client';
import { socketClient } from '../socket/socketClient';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));

describe('socket subscriptions across authentication and reconnect', () => {
  const socket = {
    connected: false,
    auth: {},
    on: jest.fn(),
    off: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    removeAllListeners: jest.fn(),
  };
  const handler = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(io).mockReturnValue(socket as never);
  });
  afterEach(() => {
    socketClient.off('booking:changed', handler);
    socketClient.disconnect();
  });

  it('retains handlers registered before the access token is available', () => {
    socketClient.on('booking:changed', handler);
    socketClient.connect('token');
    expect(socket.on).toHaveBeenCalledWith('booking:changed', handler);
    expect(socket.connect).toHaveBeenCalled();
  });
  it('reuses a connecting socket rather than opening another one', () => {
    socketClient.connect('first-token');
    socketClient.connect('refreshed-token');
    expect(io).toHaveBeenCalledTimes(1);
    expect(socket.auth).toEqual({ token: 'refreshed-token' });
  });
  it('reattaches active handlers after disconnect and respects unsubscribe', () => {
    socketClient.on('booking:changed', handler);
    socketClient.connect('token');
    socketClient.disconnect();
    socket.on.mockClear();
    socketClient.connect('new-token');
    expect(socket.on).toHaveBeenCalledWith('booking:changed', handler);
    socketClient.off('booking:changed', handler);
    socketClient.disconnect();
    socket.on.mockClear();
    socketClient.connect('last-token');
    expect(socket.on).not.toHaveBeenCalledWith('booking:changed', handler);
  });
});
