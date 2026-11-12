import { View } from 'react-native';
import { PackageText as Text } from '@/components/profile/PackageText';
import type { PackageParkingQuote } from '@/services/api/staff';

const period = (value?: { start: string; end: string } | null) => value ? `${new Date(value.start).toLocaleString('en-GB')} - ${new Date(value.end).toLocaleString('en-GB')}` : 'None';

export function PackageParkingBreakdown({ pricing, paymentStatus = 'unpaid' }: { pricing?: PackageParkingQuote | null; paymentStatus?: string }) {
  if (!pricing?.appliedEntitlement) return null;
  return <View accessibilityLabel="Package parking charges" style={{ gap: 8, padding: 14, backgroundColor: '#10233f', borderColor: '#31557d', borderWidth: 1, borderRadius: 12 }}>
    <Text style={{ color: '#fff', fontWeight: '700' }}>{pricing.packageName || 'Legacy parking package'}</Text>
    <Text style={{ color: '#bfdbfe' }}>{pricing.packageService === 'RESERVED_PAID' ? 'Reserved space; standard parking fees apply.' : 'Reserved space; base parking included while effective.'}</Text>
    {pricing.packageExpired && <Text style={{ color: '#bfdbfe' }}>Package expired at {new Date(pricing.appliedEntitlement.expireAt).toLocaleString('en-GB')}. Parking after this time uses standard rates.</Text>}
    <Text style={{ color: '#bfdbfe' }}>Covered: {period(pricing.coveredInterval)}</Text>
    <Text style={{ color: '#bfdbfe' }}>Chargeable: {period(pricing.uncoveredInterval)}</Text>
    <Text style={{ color: '#fff', fontWeight: '700' }}>Amount due: {pricing.amountToPay.toLocaleString('en-GB')} VND</Text>
    <Text style={{ color: '#bfdbfe' }}>Payment: {paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'pending' ? 'Awaiting bank verification' : 'Awaiting checkout settlement'}</Text>
    <Text style={{ color: '#bfdbfe', fontSize: 12 }}>Standard blocks and caps apply to chargeable time. Block prices are not prorated.</Text>
  </View>;
}
