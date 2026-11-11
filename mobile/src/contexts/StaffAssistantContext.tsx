import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { StaffAssistantPopup } from '@/components/staff/StaffAssistantPopup';

const StaffAssistantContext = createContext<{ openAssistant: () => void } | null>(null);

export function StaffAssistantProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const openAssistant = useCallback(() => setVisible(true), []);
  const closeAssistant = useCallback(() => setVisible(false), []);
  const value = useMemo(() => ({ openAssistant }), [openAssistant]);

  return (
    <StaffAssistantContext.Provider value={value}>
      {children}
      <StaffAssistantPopup visible={visible} onOpen={openAssistant} onClose={closeAssistant} />
    </StaffAssistantContext.Provider>
  );
}

export function useStaffAssistant() {
  const context = useContext(StaffAssistantContext);
  if (!context) throw new Error('StaffAssistantProvider is required.');
  return context;
}
