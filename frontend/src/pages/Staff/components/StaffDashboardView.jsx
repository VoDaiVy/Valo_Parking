import { format } from 'date-fns';
import {
  MonitorCheck, Car, FileWarning, ClipboardList, CheckCircle2, AlertTriangle,
  DoorOpen, ArrowRightCircle, QrCode, Activity, Crown, CircleDollarSign,
  CalendarCheck2, Wrench, LogIn, LogOut, Lock, Pause, Play,
} from 'lucide-react';
import { getOperationalValue } from '../../../utils/staffOperationalAvailability';
import './staffDashboard.css';

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', {
  style: 'currency', currency: 'VND', maximumFractionDigits: 0,
}).format(Number(value || 0));

export function DashboardMetric({ icon: Icon, label, value, sub, emphasis }) {
  return <article className="staff-dash-metric" aria-label={label} data-emphasis={emphasis}>
    <p className="staff-dash-metric-label"><Icon size={18} aria-hidden="true" />{label}</p>
    <p className="staff-type-kpi">{value}</p><p className="staff-dash-support">{sub}</p>
  </article>;
}

export function DashboardSlot({ id, name, status, plate, isVip, onClick }) {
  const hasName = name && name.trim().length > 0;
  const displayName = hasName ? name : 'Unnamed Slot';
  return <button type="button" className={`staff-dash-slot staff-dash-slot-${status.toLowerCase()}${hasName ? '' : ' staff-dash-slot-unnamed'}`}
    onClick={onClick} aria-label={`${displayName}, ${status}${plate ? `, ${plate}` : ''}${isVip ? ', VIP' : ''}. Open Live Grid`}>
    {isVip && <Crown className="staff-dash-slot-vip" size={12} aria-hidden="true" />}
    <span className="staff-dash-slot-name" title={hasName ? name : id}>{displayName}</span>
    {(!hasName || plate) && <span className="staff-dash-slot-plate" title={hasName ? plate : id}>{hasName ? plate : `#${id.split('-').pop()}`}</span>}
    <span className={`staff-dash-badge staff-dash-tone-${status.toLowerCase()}`}>{status}</span>
  </button>;
}

function DashboardState({ children, error = false }) {
  const Icon = error ? AlertTriangle : MonitorCheck;
  return <div className={`staff-dash-state${error ? ' staff-dash-error' : ''}`} role={error ? 'alert' : 'status'}><Icon size={24} aria-hidden="true" /><p>{children}</p></div>;
}

function DashboardBooking({ booking }) {
  return <li className="staff-dash-booking">
    <Car size={18} className="staff-dash-muted" aria-hidden="true" />
    <div className="staff-dash-booking-identity"><p className="staff-dash-plate">{booking.licensePlate}</p><p className="staff-dash-support">Booking #B-{booking._id.slice(-4).toUpperCase()} · Slot {booking.parkingSlot}</p></div>
    <div className="staff-dash-booking-status"><time>{format(new Date(booking.createdAt || booking.scheduledStart), 'HH:mm')}</time><span className={`staff-dash-badge staff-dash-tone-${booking.status.toLowerCase()}`}>{booking.status.toLowerCase()}</span></div>
  </li>;
}

export default function StaffDashboardView({
  loading, floors, metrics, syncStatus, viewAvailability, revenueState,
  revenueStatistics, activeFloorZones, getSlotData, lotDiagnostics, navigate,
  selectedGate, setSelectedGate, gateOpen, gateHold, isTriggeringGate,
  handleOpenGate, handleCloseGate, handleToggleHoldGate,
}) {
  const initialLoading = loading && floors.length === 0;
  const { totalSlots, activeFloor, vehiclesInside, cancellationsToday, recentBookings, occupancyRate } = metrics;
  return <div className="staff-operations-dashboard" aria-busy={loading}>
    <header className="staff-dash-header">
      <div className="staff-dash-header-identity"><p className="staff-dash-eyebrow">VALO Operations</p><h1 className="staff-type-page-title">Dashboard</h1></div>
      <div className="staff-dash-header-status"><p className={`staff-dash-sync ${initialLoading ? 'staff-dash-muted' : syncStatus.isAvailable ? 'staff-dash-success' : 'staff-dash-error'}`} role="status">
        {initialLoading ? <MonitorCheck size={16} aria-hidden="true" /> : syncStatus.isAvailable ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
        {initialLoading ? 'Updating data…' : syncStatus.isAvailable ? 'Data synchronized' : `Operational sync unavailable: ${syncStatus.error}`}
      </p><p className="staff-dash-support">{format(new Date(), 'EEEE, MMM dd, yyyy')}</p></div>
    </header>

    <div className="staff-dash-instruments">
    <section className="staff-dash-operations" aria-labelledby="staff-dash-overview">
      <div className="staff-dash-section-heading"><h2 className="staff-type-section-title" id="staff-dash-overview">Operations overview</h2></div>
      <div className="staff-dash-metrics staff-dash-metrics-operations">
        <DashboardMetric icon={MonitorCheck} label="Managed slots" emphasis="capacity" value={viewAvailability.managedSlots ? totalSlots : '—'} sub={viewAvailability.managedSlots ? `${floors.length} configured floors` : 'Data unavailable'} />
        <DashboardMetric icon={Car} label="Vehicles inside" value={viewAvailability.vehiclesInside ? vehiclesInside : '—'} sub={viewAvailability.occupancy ? `${occupancyRate}% occupancy · ${activeFloor?.name || 'First floor'}` : 'Data unavailable'} />
        <DashboardMetric icon={FileWarning} label="Cancellations today" value={viewAvailability.cancellations ? cancellationsToday : '—'} sub={viewAvailability.cancellations ? 'Booking cancellations for today' : 'Data unavailable'} />
      </div>
    </section>

    <section className="staff-dash-revenue" aria-labelledby="staff-dash-revenue">
      <div className="staff-dash-section-heading"><h2 className="staff-type-section-title" id="staff-dash-revenue">Revenue</h2><p className={`staff-dash-support${revenueState.isAvailable ? '' : ' staff-dash-error'}`}>{revenueState.isAvailable ? 'All-time realized revenue' : revenueState.error || 'Revenue data unavailable'}</p></div>
      <div className="staff-dash-metrics staff-dash-metrics-revenue">
        <DashboardMetric icon={CircleDollarSign} label="Platform revenue" emphasis="revenue" value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.totalRevenue))} sub={revenueState.isAvailable ? 'VIP + booking + services' : 'Data unavailable'} />
        <div className="staff-dash-revenue-breakdown">
        <DashboardMetric icon={Crown} label="VIP revenue" value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.vip.revenue))} sub={revenueState.isAvailable ? `${revenueStatistics.vip.transactionCount} paid transactions` : 'Data unavailable'} />
        <DashboardMetric icon={CalendarCheck2} label="Booking revenue" value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.booking.revenue))} sub={revenueState.isAvailable ? `${revenueStatistics.booking.completedCount} completed bookings` : 'Data unavailable'} />
        <DashboardMetric icon={Wrench} label="Service revenue" value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.service.revenue))} sub={revenueState.isAvailable ? `${revenueStatistics.service.completedBookingCount} completed with services` : 'Data unavailable'} />
        </div>
      </div>
    </section>
    </div>

    <div className="staff-dash-workspace">
      <section className="staff-dash-parking" aria-labelledby="staff-dash-parking-title">
        <div className="staff-dash-section-heading"><div><h2 className="staff-type-section-title" id="staff-dash-parking-title">Live Grid <span className="staff-dash-floor-name">— {activeFloor ? activeFloor.name : 'No floor configured'}</span></h2><p className="staff-dash-support">Select a slot to open Live Grid.</p></div><span className={`staff-dash-badge ${viewAvailability.liveGrid ? 'staff-dash-tone-empty' : 'staff-dash-tone-maintenance'}`}>{viewAvailability.liveGrid ? 'Data synchronized' : 'Data unavailable'}</span></div>
        {!viewAvailability.liveGrid ? <DashboardState error>Live grid data unavailable. Floor, slot, session, or booking data could not be synchronized.</DashboardState> : activeFloorZones.length === 0 ? <DashboardState>No slot layout found on this floor.</DashboardState> : <div className="staff-dash-zones">
          {activeFloorZones.map((zone) => <section key={zone.key} aria-labelledby={`dashboard-zone-${zone.key}`}>
            <div className="staff-dash-zone-heading"><h3 className="staff-type-card-title" id={`dashboard-zone-${zone.key}`}>{zone.label}</h3><span className="staff-dash-support">{zone.slots.length} slots</span></div>
            <div className="staff-dash-slot-grid">{zone.slots.map((slot) => <DashboardSlot key={slot.id} {...slot} {...getSlotData(slot)} onClick={() => navigate('/staff/live-grid')} />)}</div>
          </section>)}
        </div>}
        {viewAvailability.liveGrid && <ul className="staff-dash-legend" aria-label="Slot status legend">{['Occupied', 'Empty', 'Reserved', 'Maintenance'].map((status) => <li key={status}><span className={`staff-dash-dot staff-dash-dot-${status.toLowerCase()}`} aria-hidden="true" />{status}</li>)}</ul>}
      </section>

      <section className="staff-dash-gates" aria-labelledby="staff-dash-gates">
        <div className="staff-dash-section-heading"><h2 className="staff-type-section-title" id="staff-dash-gates">Gate & actions</h2><span className={`staff-dash-badge ${gateOpen ? 'staff-dash-tone-empty' : 'staff-dash-tone-occupied'}`}>{gateOpen ? 'Barrier open' : 'Standby'}</span></div>
        <div className="staff-dash-gate-selector" aria-label="Select gate">
          <button type="button" aria-pressed={selectedGate === 'ENTRY_1'} onClick={() => setSelectedGate('ENTRY_1')}><LogIn size={16} aria-hidden="true" />Entry gate</button>
          <button type="button" aria-pressed={selectedGate === 'EXIT_1'} onClick={() => setSelectedGate('EXIT_1')}><LogOut size={16} aria-hidden="true" />Exit gate</button>
        </div>
        <div className="staff-dash-gate-status"><DoorOpen size={24} aria-hidden="true" /><div><h3 className="staff-type-card-title">{selectedGate === 'ENTRY_1' ? 'Entry gate (ENTRY_1)' : 'Exit gate (EXIT_1)'}</h3><p className="staff-dash-support">{gateOpen ? 'Barrier is open' : 'Barrier is closed'}{gateHold ? ' · Paused' : ''}</p></div></div>
        <div className="staff-dash-gate-actions" aria-busy={isTriggeringGate}>
          <button type="button" className={gateOpen ? 'staff-dash-button staff-dash-destructive' : 'staff-dash-button staff-dash-primary'} disabled={isTriggeringGate} onClick={() => { if (gateOpen) handleCloseGate(selectedGate); else handleOpenGate(selectedGate); }}>
            {gateOpen ? <Lock size={17} aria-hidden="true" /> : selectedGate === 'ENTRY_1' ? <LogIn size={17} aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}
            {gateOpen ? 'Close gate' : selectedGate === 'ENTRY_1' ? 'Open entry gate' : 'Open exit gate'}
          </button>
          <button type="button" className="staff-dash-button staff-dash-warning" disabled={isTriggeringGate} onClick={() => handleToggleHoldGate(selectedGate)}>{gateHold ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}{gateHold ? 'Resume barrier' : 'Pause barrier'}</button>
        </div>
        <div className="staff-dash-shortcuts">
          <button type="button" className="staff-dash-shortcut"><ArrowRightCircle size={19} aria-hidden="true" /><span><strong>Process Exit</strong><span>Confirm payment & exit</span></span></button>
          <button type="button" className="staff-dash-shortcut"><QrCode size={19} aria-hidden="true" /><span><strong>Scan QR Code</strong><span>Manual fallback checkout</span></span></button>
          <button type="button" className="staff-dash-shortcut"><ClipboardList size={19} aria-hidden="true" /><span><strong>Update Slot</strong><span>Mark maintenance issues</span></span></button>
        </div>
      </section>
    </div>

    <div className="staff-dash-bottom">
      <section aria-labelledby="staff-dash-activity">
        <div className="staff-dash-section-heading"><div><h2 className="staff-type-section-title" id="staff-dash-activity">Recent bookings</h2><p className="staff-dash-support">The five most recent booking records.</p></div><span className="staff-dash-muted">View All</span></div>
        {!viewAvailability.activityStream ? <DashboardState error>Activity data unavailable. Booking records could not be synchronized.</DashboardState> : recentBookings.length === 0 ? <DashboardState>No booking activity.</DashboardState> : <ul>{recentBookings.map((booking) => <DashboardBooking key={booking._id} booking={booking} />)}</ul>}
      </section>
      <section aria-labelledby="staff-dash-diagnostics">
        <div className="staff-dash-section-heading"><h2 className="staff-type-section-title" id="staff-dash-diagnostics">Lot diagnostics</h2><Activity size={18} className="staff-dash-muted" aria-hidden="true" /></div>
        <ul className="staff-dash-diagnostics">{lotDiagnostics.map((diagnostic) => {
          const Icon = diagnostic.key === 'maintenance' ? Wrench : diagnostic.key === 'cancellations' ? FileWarning : diagnostic.level === 'ok' ? CheckCircle2 : AlertTriangle;
          return <li key={diagnostic.key} className={`staff-dash-diagnostic staff-dash-diagnostic-${diagnostic.level}`}><Icon size={18} aria-hidden="true" /><div><p>{diagnostic.text}</p><p className="staff-dash-support">{diagnostic.time}</p></div></li>;
        })}</ul>
        <p className="staff-dash-verification-note">Sensor and camera health is not verified by this dashboard.</p>
      </section>
    </div>
  </div>;
}
