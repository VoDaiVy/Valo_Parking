import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StaffAssistantProvider, useStaffAssistant } from '@/contexts/StaffAssistantContext';
import { assistantService } from '@/services/api/assistant';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));
jest.mock('@/services/api/assistant', () => ({
  assistantService: { chat: jest.fn(), decideDraft: jest.fn() },
}));

function ToolRow() {
  const { openAssistant } = useStaffAssistant();
  return (
    <Pressable onPress={openAssistant}>
      <Text>Open from tools</Text>
    </Pressable>
  );
}
function App() {
  return (
    <StaffAssistantProvider>
      <ToolRow />
    </StaffAssistantProvider>
  );
}
const reply = {
  success: true,
  data: {
    type: 'analysis',
    message: 'There are 12 vehicles parked.',
    conversationId: 'conversation-1',
  },
};

describe('staff assistant popup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(assistantService.chat).mockResolvedValue(reply);
    jest.mocked(assistantService.decideDraft).mockResolvedValue({ success: true });
  });

  it('opens in place and keeps the conversation when closed and reopened', async () => {
    const ui = render(<App />);
    expect(ui.queryByTestId('staff-assistant-popup')).toBeNull();
    fireEvent.press(ui.getByText('Open from tools'));
    expect(ui.getByTestId('staff-assistant-popup')).toBeTruthy();
    fireEvent.changeText(ui.getByLabelText('Message VALO AI'), 'How many vehicles?');
    fireEvent.press(ui.getByLabelText('Send message'));
    await ui.findByText(reply.data.message);
    fireEvent.press(ui.getByLabelText('Close VALO AI chat'));
    expect(ui.queryByTestId('staff-assistant-popup')).toBeNull();
    fireEvent.press(ui.getByLabelText('Open VALO AI chat'));
    expect(ui.getByText('How many vehicles?')).toBeTruthy();
    expect(ui.getByText(reply.data.message)).toBeTruthy();
    fireEvent.changeText(ui.getByLabelText('Message VALO AI'), 'Which floor?');
    fireEvent.press(ui.getByLabelText('Send message'));
    await waitFor(() =>
      expect(assistantService.chat).toHaveBeenLastCalledWith('Which floor?', 'conversation-1'),
    );
  });

  it('finishes an in-flight reply while minimized without losing it or resending', async () => {
    let resolveReply!: (value: typeof reply) => void;
    jest.mocked(assistantService.chat).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReply = resolve;
      }),
    );
    const ui = render(<App />);
    fireEvent.press(ui.getByLabelText('Open VALO AI chat'));
    fireEvent.press(ui.getByText('Find recent bookings'));
    fireEvent.press(ui.getByLabelText('Minimize VALO AI chat'));
    expect(ui.getByTestId('assistant-busy-indicator')).toBeTruthy();
    await act(async () => {
      resolveReply(reply);
    });
    fireEvent.press(ui.getByLabelText('Open VALO AI chat'));
    expect(ui.getByText(reply.data.message)).toBeTruthy();
    expect(assistantService.chat).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation and accepts the draft id returned by the web API', async () => {
    jest.mocked(assistantService.chat).mockResolvedValueOnce({
      success: true,
      data: {
        ...reply.data,
        message: 'Review this notification.',
        draft: {
          id: 'draft-from-api',
          type: 'SEND_NOTIFICATION',
          status: 'PENDING',
          payload: { title: 'Notice', content: 'The entry gate is under maintenance.' },
        },
      },
    });
    const ui = render(<App />);
    fireEvent.press(ui.getByLabelText('Open VALO AI chat'));
    fireEvent.changeText(ui.getByLabelText('Message VALO AI'), 'Prepare a notice');
    fireEvent.press(ui.getByLabelText('Send message'));
    fireEvent.press(await ui.findByText('Review & apply'));
    expect(assistantService.decideDraft).not.toHaveBeenCalled();
    fireEvent.press(ui.getByText('Confirm changes'));
    await ui.findByText('Applied successfully');
    expect(assistantService.decideDraft).toHaveBeenCalledWith('draft-from-api', 'approve');
  });
});
