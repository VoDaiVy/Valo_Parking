import { apiClient } from './client';

export type GateName = 'ENTRY_1' | 'EXIT_1';

export interface GateState {
  gate: GateName;
  open: boolean;
  holdOpen: boolean;
  forceClose: boolean;
  triggerId: number;
  licensePlate: string;
  slotCode: string;
  timestamp: number;
}

export interface GateStatesResponse {
  success: boolean;
  gates: Record<GateName, GateState>;
}

export interface GateCommandResponse {
  success: boolean;
  message: string;
  data: GateState;
}

export const staffGateService = {
  getStatus: () => apiClient.get<GateStatesResponse>('/iot/barrier-status', { timeout: 0 }),
  open: (gate: GateName) => apiClient.post<GateCommandResponse>('/iot/open-barrier', {
    gate,
    licensePlate: gate === 'ENTRY_1' ? 'STAFF-IN' : 'STAFF-OUT',
    slotCode: 'STAFF',
  }, { timeout: 0 }),
  close: (gate: GateName) =>
    apiClient.post<GateCommandResponse>('/iot/close-barrier', { gate }, { timeout: 0 }),
  setHold: (gate: GateName, hold: boolean) =>
    apiClient.post<GateCommandResponse>('/iot/hold-barrier', { gate, hold }, { timeout: 0 }),
};
