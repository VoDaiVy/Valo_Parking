import React, { Component, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/common/Button';
import { AppText } from '@/components/common/AppText';
import { colors, spacing } from '@/theme';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function LocalizedErrorFallback({ error, onReset }: { error: Error | null; onReset: () => void }) {
  const { t } = useLanguage();
  return (
    <View style={styles.container}>
      <AppText color={colors.error.main} style={styles.center} variant="h3">
        {t('Oops! Something went wrong')}
      </AppText>
      <AppText color={colors.light.text.secondary} style={styles.center}>
        {t(error?.message || 'An unexpected error occurred')}
      </AppText>
      <Button title={t('Try Again')} onPress={onReset} />
    </View>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (__DEV__) {
      console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <LocalizedErrorFallback error={this.state.error} onReset={this.handleReset} />;
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.light.background,
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  center: {
    textAlign: 'center',
  },
});
