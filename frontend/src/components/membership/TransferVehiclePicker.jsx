import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyVehicles } from '../../services/vehicleService';

export default function TransferVehiclePicker({ value, onChange }) {
  const [vehicles, setVehicles] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    getMyVehicles().then((response) => {
      if (!response.ok) throw new Error(response.data?.message || 'Unable to load vehicles.');
      if (current) setVehicles((response.data?.data || []).filter((vehicle) => vehicle.status === 'approved'));
    }).catch((failure) => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, []);
  return <div className="my-3 min-w-0 font-['Montserrat',sans-serif]">
    <label className="block text-xs font-semibold text-white/70">
      Vehicle receiving this parking space
      <select aria-label="Vehicle receiving this parking space" value={value || ''} onChange={(event) => onChange(event.target.value)} disabled={!vehicles?.length} className="mt-2 w-full rounded-lg border border-white/20 bg-[#141b25] p-3 text-sm text-white disabled:opacity-60">
        <option value="">{vehicles === null ? 'Loading vehicles…' : 'Select an approved vehicle'}</option>
        {vehicles?.map((vehicle) => <option key={vehicle._id} value={vehicle._id}>{vehicle.licensePlate}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    {vehicles?.length === 0 && <Link to="/customer/vehicles" className="mt-2 inline-block text-sm text-amber-200 underline">Add a vehicle before completing the transfer</Link>}
  </div>;
}
