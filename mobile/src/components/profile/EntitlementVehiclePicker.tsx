import { PackageText as Text } from '@/components/profile/PackageText';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { vehiclesService } from '@/services/api/vehicles';
import type { Vehicle } from '@/types/models';

export function EntitlementVehiclePicker({ value, onChange, label = 'Vehicle receiving this space', excluded = [], eligible }: {
  value?: string; onChange: (id: string) => void; label?: string; excluded?: string[]; eligible?: string[];
}) {
  const [vehicles, setVehicles] = useState<Array<Vehicle & { _id: string }> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    vehiclesService.getMyVehicles().then((response) => {
      if (active) setVehicles((response.data || []).flatMap((vehicle) => { const id = vehicle._id || vehicle.id; return vehicle.status === 'approved' && id ? [{ ...vehicle, _id: id }] : []; }));
    }).catch(() => { if (active) setError('Unable to load vehicles. Please reopen this screen.'); });
    return () => { active = false; };
  }, []);
  return <View style={{ gap: 8, marginVertical: 12 }}>
    <Text style={{ color: '#cbd5e1', fontWeight: '600' }}>{label}</Text>
    {vehicles?.filter((vehicle) => !eligible || eligible.includes(vehicle._id)).map((vehicle) => <Pressable key={vehicle._id} accessibilityRole="radio" accessibilityState={{ checked: value === vehicle._id, disabled: excluded.includes(vehicle._id) }} disabled={excluded.includes(vehicle._id)} onPress={() => onChange(vehicle._id)} style={{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: value === vehicle._id ? '#d4af37' : '#334155', opacity: excluded.includes(vehicle._id) ? 0.4 : 1 }}>
      <Text style={{ color: '#f8fafc' }}>{vehicle.licensePlate}{value === vehicle._id ? ' · Selected' : ''}</Text>
    </Pressable>)}
    <Text style={{ color: '#94a3b8' }}>{error || (vehicles === null ? 'Loading vehicles…' : vehicles.length ? 'Each vehicle may have one effective parking entitlement.' : 'Add an approved vehicle before confirming.')}</Text>
  </View>;
}
