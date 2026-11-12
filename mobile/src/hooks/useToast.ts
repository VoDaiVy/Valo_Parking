import { useCallback } from 'react';
import Toast from 'react-native-toast-message';
import { useLanguage } from '@/contexts/LanguageContext';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

export const useToast = () => {
  const { t } = useLanguage();
  const showToast = useCallback((options: ToastOptions) => {
    Toast.show({
      type: options.type,
      text1: t(options.title),
      text2: options.message ? t(options.message) : options.message,
      visibilityTime: options.duration || 3000,
      position: 'top',
    });
  }, [t]);

  return {
    showToast,
    showSuccess: (title: string, message?: string) => showToast({ type: 'success', title, message }),
    showError: (title: string, message?: string) => showToast({ type: 'error', title, message }),
    showInfo: (title: string, message?: string) => showToast({ type: 'info', title, message }),
    showWarning: (title: string, message?: string) => showToast({ type: 'warning', title, message }),
  };
};
