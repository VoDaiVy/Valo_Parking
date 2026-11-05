import { fireEvent, render } from '@testing-library/react-native';
import { Button } from 'react-native';

import { AppAlertProvider, useAppAlert } from '../AppAlertContext';

jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (message: string) => message }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const ErrorTrigger = () => {
  const { alert } = useAppAlert();
  return <Button title="Open error" onPress={() => alert('Error', 'Unable to complete this action.')} />;
};

const ConfirmTrigger = ({ onConfirm }: { onConfirm: () => void }) => {
  const { alert } = useAppAlert();
  return (
    <Button
      title="Open confirm"
      onPress={() =>
        alert('Delete vehicle', 'Are you sure?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: onConfirm },
        ])
      }
    />
  );
};

describe('AppAlertProvider', () => {
  it('renders a branded modal for simple alerts', () => {
    const screen = render(
      <AppAlertProvider>
        <ErrorTrigger />
      </AppAlertProvider>,
    );

    fireEvent.press(screen.getByText('Open error'));

    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText('Unable to complete this action.')).toBeTruthy();
    expect(screen.getByText('Close')).toBeTruthy();
  });

  it('preserves destructive confirmation callbacks', () => {
    const onConfirm = jest.fn();
    const screen = render(
      <AppAlertProvider>
        <ConfirmTrigger onConfirm={onConfirm} />
      </AppAlertProvider>,
    );

    fireEvent.press(screen.getByText('Open confirm'));
    fireEvent.press(screen.getByText('Delete'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Are you sure?')).toBeNull();
  });
});
