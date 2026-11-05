import { useLanguage } from '@/contexts/LanguageContext';
import { Share, StyleSheet, View } from 'react-native';
import { useState } from 'react';
import QRCode from 'react-native-qrcode-svg';

import { AppText, Button, Card } from '@/components/common';
import { borderRadius, colors, spacing } from '@/theme';

interface QRCodeDisplayProps {
  bookingId?: string;
  value?: string;
  reference?: string;
  shareLabel?: string;
  shareTitle?: string;
  size?: number;
  showBrightnessControl?: boolean;
}

export const isValidBookingQrValue = (value: string) =>
  /^[a-f\d]{24}$/i.test(value) ||
  /^VALO_(BOOKING|MEMBERSHIP):[1-9]\d*:[a-f\d]{24}:[A-Za-z0-9_-]{20,}$/i.test(value);

export const QRCodeDisplay = ({
  bookingId,
  value,
  reference,
  shareLabel = 'VALO parking pass',
  shareTitle = 'Share pass',
  size = 200,
  showBrightnessControl = true,
}: QRCodeDisplayProps) => {
  const { t: translateUi } = useLanguage();
  const [bright, setBright] = useState(false);
  const qrValue = value || bookingId || '';
  const displayReference = reference || bookingId;

  return (
    <Card style={[styles.card, bright && styles.bright]}>
      <View style={styles.qrWrap}>
        <QRCode backgroundColor="white" color="black" ecl="M" size={size} value={qrValue} />
      </View>
      {displayReference ? (
        <AppText color={bright ? colors.light.text.inverse : colors.light.text.secondary} style={styles.center} variant="caption">
          {" "}{translateUi("Ref:")}{" "}{displayReference}
        </AppText>
      ) : null}
      {showBrightnessControl ? (
        <Button
          title={bright ? translateUi("Normal Brightness") : translateUi("Boost Brightness")}
          variant="outline"
          onPress={() => setBright((current) => !current)}
        />
      ) : null}
      <Button
        title={translateUi(shareTitle)}
        textStyle={bright ? styles.brightText : undefined}
        variant="ghost"
        onPress={() => Share.share({ message: `${shareLabel}: ${qrValue}` })}
      />
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: spacing.md,
  },
  bright: {
    backgroundColor: colors.neutral.white,
  },
  center: {
    textAlign: 'center',
    maxWidth: '100%',
  },
  brightText: { color: colors.light.text.inverse },
  qrWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
});
