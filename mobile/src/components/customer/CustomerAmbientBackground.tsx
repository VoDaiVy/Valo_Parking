import React from 'react';
import { StyleSheet, View } from 'react-native';

/** Shared VALO surface treatment for customer tabs. */
export function CustomerAmbientBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.topGlow} />
      <View style={styles.topHalo} />
      <View style={styles.lowerGlow} />
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  topGlow: {
    backgroundColor: 'rgba(226,186,75,0.09)',
    borderRadius: 180,
    height: 360,
    position: 'absolute',
    right: -190,
    top: -160,
    width: 360,
  },
  topHalo: {
    borderColor: 'rgba(226,186,75,0.14)',
    borderRadius: 140,
    borderWidth: 1,
    height: 280,
    position: 'absolute',
    right: -120,
    top: -90,
    width: 280,
  },
  lowerGlow: {
    backgroundColor: 'rgba(226,186,75,0.06)',
    borderRadius: 150,
    bottom: -110,
    height: 300,
    left: -190,
    position: 'absolute',
    width: 300,
  },
  rule: {
    backgroundColor: 'rgba(226,186,75,0.12)',
    height: 1,
    left: 16,
    position: 'absolute',
    right: 16,
    top: 112,
  },
});
