import AnimatedNumber from '../../../components/AnimatedNumber';
import { format } from 'date-fns';
import { enUS, vi } from 'date-fns/locale';
import {
  MonitorCheck, Car, FileWarning, ClipboardList, CheckCircle2, AlertTriangle,
  DoorOpen, ArrowRightCircle, QrCode, Activity, Crown, CircleDollarSign,
  CalendarCheck2, Wrench, LogIn, LogOut, Lock, Pause, Play,
} from 'lucide-react';
import { getOperationalValue } from '../../../utils/staffOperationalAvailability';
import { useLanguage } from '../../../i18n/hooks/useLanguage';
import './staffDashboard.css';

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', {
  style: 'currency', currency: 'VND', maximumFractionDigits: 0,
}).format(Number(value || 0));

export function DashboardMetric({ icon: Icon, label, value, sub, emphasis }) {
  return <article className="staff-dash-metric" aria-label={label} data-emphasis={emphasis}>
    <p className="staff-dash-metric-label"><Icon size={18} aria-hidden="true" />{label}</p>
    <p className="staff-type-kpi"><AnimatedNumber value={value} /></p><p className="staff-dash-support">{sub}</p>
  </article>;
}

export function DashboardSlot({ id, name, status, plate, isVip, onClick }) {
  const { t } = useLanguage();
  const hasName = name && name.trim().length > 0;
  const displayName = hasName ? name : t('staffDashboard.grid.unnamed');
  const statusLabel = t(`staffDashboard.status.${String(status).toLowerCase()}`, { defaultValue: status });
  const plateLabel = plate ? `, ${plate}` : '';
  const vipLabel = isVip ? `, ${t('staffDashboard.grid.vip')}` : '';
  return <button type="button" className={`staff-dash-slot staff-dash-slot-${status.toLowerCase()}${hasName ? '' : ' staff-dash-slot-unnamed'}`}
    onClick={onClick} aria-label={t('staffDashboard.grid.slotAria', { name: displayName, status: statusLabel, plate: plateLabel, vip: vipLabel })}>
    {isVip && <Crown className="staff-dash-slot-vip" size={12} aria-hidden="true" />}
    <span className="staff-dash-slot-name" title={hasName ? name : id}>{displayName}</span>
    {(!hasName || plate) && <span className="staff-dash-slot-plate" title={hasName ? plate : id}>{hasName ? plate : `#${id.split('-').pop()}`}</span>}
    <span className={`staff-dash-badge staff-dash-tone-${status.toLowerCase()}`}>{statusLabel}</span>
  </button>;
}

function DashboardState({ children, error = false }) {
  const Icon = error ? AlertTriangle : MonitorCheck;
  return <div className={`staff-dash-state${error ? ' staff-dash-error' : ''}`} role={error ? 'alert' : 'status'}><Icon size={24} aria-hidden="true" /><p>{children}</p></div>;
}

function DashboardBooking({ booking }) {
  const { t } = useLanguage();
  const normalizedStatus = String(booking.status || '').toLowerCase();
  const statusLabel = t(`staffDashboard.status.${normalizedStatus}`, {
    defaultValue: t(`sessionManagementUi.${normalizedStatus}`, { defaultValue: booking.status }),
  });
  return <li className="staff-dash-booking">
    <Car size={18} className="staff-dash-muted" aria-hidden="true" />
    <div className="staff-dash-booking-identity"><p className="staff-dash-plate">{booking.licensePlate}</p><p className="staff-dash-support">{t('staffDashboard.activity.bookingSupport', { id: booking._id.slice(-4).toUpperCase(), slot: booking.parkingSlot })}</p></div>
    <div className="staff-dash-booking-status"><time>{format(new Date(booking.createdAt || booking.scheduledStart), 'HH:mm')}</time><span className={`staff-dash-badge staff-dash-tone-${normalizedStatus}`}>{statusLabel}</span></div>
  </li>;
}

export default function StaffDashboardView({
  loading, floors, metrics, syncStatus, viewAvailability, revenueState,
  revenueStatistics, activeFloorZones, getSlotData, lotDiagnostics, navigate,
  selectedGate, setSelectedGate, gateOpen, gateHold, isTriggeringGate,
  handleOpenGate, handleCloseGate, handleToggleHoldGate,
}) {
  const { t, language } = useLanguage();
  const initialLoading = loading && floors.length === 0;
  const { totalSlots, activeFloor, vehiclesInside, cancellationsToday, recentBookings, occupancyRate } = metrics;
  return <div className="staff-operations-dashboard" aria-busy={loading}>
    <header className="staff-dash-header">
      <div className="staff-dash-header-identity"><p className="staff-dash-eyebrow">{t('staffDashboard.eyebrow')}</p><h1 className="staff-type-page-title">{t('staffDashboard.title')}</h1></div>
      <div className="staff-dash-header-status"><p className={`staff-dash-sync ${initialLoading ? 'staff-dash-muted' : syncStatus.isAvailable ? 'staff-dash-success' : 'staff-dash-error'}`} role="status">
        {initialLoading ? <MonitorCheck size={16} aria-hidden="true" /> : syncStatus.isAvailable ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
        {initialLoading ? t('staffDashboard.sync.updating') : syncStatus.isAvailable ? t('staffDashboard.sync.synchronized') : t('staffDashboard.sync.unavailable', { error: syncStatus.error })}
      </p><p className="staff-dash-support">{format(new Date(), 'EEEE, MMM dd, yyyy', { locale: language === 'vi' ? vi : enUS })}</p></div>
    </header>

    <div className="staff-dash-instruments">
    <section className="staff-dash-operations" aria-labelledby="staff-dash-overview">
      <div className="staff-dash-section-heading"><h2 className="staff-type-section-title" id="staff-dash-overview">{t('staffDashboard.sections.operations')}</h2></div>
      <div className="staff-dash-metrics staff-dash-metrics-operations">
        <DashboardMetric icon={MonitorCheck} label={t('staffDashboard.metrics.managedSlots')} emphasis="capacity" value={viewAvailability.managedSlots ? totalSlots : '—'} sub={viewAvailability.managedSlots ? t('staffDashboard.metrics.configuredFloors', { count: floors.length }) : t('staffDashboard.metrics.dataUnavailable')} />
        <DashboardMetric icon={Car} label={t('staffDashboard.metrics.vehiclesInside')} value={viewAvailability.vehiclesInside ? vehiclesInside : '—'} sub={viewAvailability.occupancy ? t('staffDashboard.metrics.occupancy', { percent: occupancyRate, floor: activeFloor?.name || t('staffDashboard.metrics.firstFloor') }) : t('staffDashboard.metrics.dataUnavailable')} />
        <DashboardMetric icon={FileWarning} label={t('staffDashboard.metrics.cancellations')} value={viewAvailability.cancellations ? cancellationsToday : '—'} sub={viewAvailability.cancellations ? t('staffDashboard.metrics.bookingCancellations') : t('staffDashboard.metrics.dataUnavailable')} />
      </div>
    </section>

    <section className="staff-dash-revenue" aria-labelledby="staff-dash-revenue">
      <div className="staff-dash-section-heading"><h2 className="staff-type-section-title" id="staff-dash-revenue">{t('staffDashboard.sections.revenue')}</h2><p className={`staff-dash-support${revenueState.isAvailable ? '' : ' staff-dash-error'}`}>{revenueState.isAvailable ? t('staffDashboard.metrics.allTimeRevenue') : revenueState.error || t('staffDashboard.revenueUnavailable')}</p></div>
      <div className="staff-dash-metrics staff-dash-metrics-revenue">
        <DashboardMetric icon={CircleDollarSign} label={t('staffDashboard.metrics.platformRevenue')} emphasis="revenue" value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.totalRevenue))} sub={revenueState.isAvailable ? `${t('staffDashboard.metrics.vipRevenue')} + ${t('staffDashboard.metrics.bookingRevenue')} + ${t('staffDashboard.metrics.serviceRevenue')}` : t('staffDashboard.metrics.dataUnavailable')} />
        <div className="staff-dash-revenue-breakdown">
        <DashboardMetric icon={Crown} label={t('staffDashboard.metrics.vipRevenue')} value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.vip.revenue))} sub={revenueState.isAvailable ? t('staffDashboard.metrics.vipTransactions', { count: revenueStatistics.vip.transactionCount }) : t('staffDashboard.metrics.dataUnavailable')} />
        <DashboardMetric icon={CalendarCheck2} label={t('staffDashboard.metrics.bookingRevenue')} value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.booking.revenue))} sub={revenueState.isAvailable ? t('staffDashboard.metrics.completedBookings', { count: revenueStatistics.booking.completedCount }) : t('staffDashboard.metrics.dataUnavailable')} />
        <DashboardMetric icon={Wrench} label={t('staffDashboard.metrics.serviceRevenue')} value={getOperationalValue(revenueState, formatCurrency(revenueStatistics.service.revenue))} sub={revenueState.isAvailable ? t('staffDashboard.metrics.completedServices', { count: revenueStatistics.service.completedBookingCount }) : t('staffDashboard.metrics.dataUnavailable')} />
        </div>
      </div>
    </section>
    </div>

    <div className="staff-dash-workspace">
      <section className="staff-dash-parking" aria-labelledby="staff-dash-parking-title">
        <div className="staff-dash-section-heading"><div><h2 className="staff-type-section-title" id="staff-dash-parking-title">{t('staffDashboard.sections.liveGrid')} <span className="staff-dash-floor-name">— {activeFloor ? activeFloor.name : t('staffDashboard.grid.noFloor')}</span></h2><p className="staff-dash-support">{t('staffDashboard.grid.selectSlot')}</p></div><span className={`staff-dash-badge ${viewAvailability.liveGrid ? 'staff-dash-tone-empty' : 'staff-dash-tone-maintenance'}`}>{viewAvailability.liveGrid ? t('staffDashboard.grid.synchronized') : t('staffDashboard.grid.unavailable')}</span></div>
        {!viewAvailability.liveGrid ? <DashboardState error>{t('staffDashboard.grid.unavailableMessage')}</DashboardState> : activeFloorZones.length === 0 ? <DashboardState>{t('staffDashboard.grid.noLayout')}</DashboardState> : <div className="staff-dash-zones">
          {activeFloorZones.map((zone) => <section key={zone.key} aria-labelledby={`dashboard-zone-${zone.key}`}>
            <div className="staff-dash-zone-heading"><h3 className="staff-type-card-title" id={`dashboard-zone-${zone.key}`}>{zone.label}</h3><span className="staff-dash-support">{t('staffDashboard.grid.slots', { count: zone.slots.length })}</span></div>
            <div className="staff-dash-slot-grid">{zone.slots.map((slot) => <DashboardSlot key={slot.id} {...slot} {...getSlotData(slot)} onClick={() => navigate('/staff/live-grid')} />)}</div>
          </section>)}
        </div>}
        {viewAvailability.liveGrid && <ul className="staff-dash-legend" aria-label={t('staffDashboard.grid.legend.occupied')}>{['occupied', 'empty', 'reserved', 'maintenance'].map((status) => <li key={status}><span className={`staff-dash-dot staff-dash-dot-${status}`} aria-hidden="true" />{t(`staffDashboard.grid.legend.${status}`)}</li>)}</ul>}
      </section>

      <section className="staff-dash-gates" aria-labelledby="staff-dash-gates">
        <div className="staff-dash-section-heading"><h2 className="staff-type-section-title" id="staff-dash-gates">{t('staffDashboard.sections.gates')}</h2><span className={`staff-dash-badge ${gateOpen ? 'staff-dash-tone-empty' : 'staff-dash-tone-occupied'}`}>{gateOpen ? t('staffDashboard.gate.barrierOpen') : t('staffDashboard.gate.standby')}</span></div>
        <div className="staff-dash-gate-selector" aria-label={t('staffDashboard.gate.select')}>
          <button type="button" aria-pressed={selectedGate === 'ENTRY_1'} onClick={() => setSelectedGate('ENTRY_1')}><LogIn size={16} aria-hidden="true" />{t('staffDashboard.gate.entry')}</button>
          <button type="button" aria-pressed={selectedGate === 'EXIT_1'} onClick={() => setSelectedGate('EXIT_1')}><LogOut size={16} aria-hidden="true" />{t('staffDashboard.gate.exit')}</button>
        </div>
        <div className="staff-dash-gate-status"><DoorOpen size={24} aria-hidden="true" /><div><h3 className="staff-type-card-title">{selectedGate === 'ENTRY_1' ? t('staffDashboard.gate.entryId') : t('staffDashboard.gate.exitId')}</h3><p className="staff-dash-support">{gateOpen ? t('staffDashboard.gate.open') : t('staffDashboard.gate.closed')}{gateHold ? ` · ${t('staffDashboard.gate.paused')}` : ''}</p></div></div>
        <div className="staff-dash-gate-actions" aria-busy={isTriggeringGate}>
          <button type="button" className={gateOpen ? 'staff-dash-button staff-dash-destructive' : 'staff-dash-button staff-dash-primary'} disabled={isTriggeringGate} onClick={() => { if (gateOpen) handleCloseGate(selectedGate); else handleOpenGate(selectedGate); }}>
            {gateOpen ? <Lock size={17} aria-hidden="true" /> : selectedGate === 'ENTRY_1' ? <LogIn size={17} aria-hidden="true" /> : <LogOut size={17} aria-hidden="true" />}
            {gateOpen ? t('staffDashboard.gate.closeGate') : t('staffDashboard.gate.openGate', { gate: selectedGate === 'ENTRY_1' ? t('staffDashboard.gate.entry') : t('staffDashboard.gate.exit') })}
          </button>
          <button type="button" className="staff-dash-button staff-dash-warning" disabled={isTriggeringGate} onClick={() => handleToggleHoldGate(selectedGate)}>{gateHold ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}{gateHold ? t('staffDashboard.gate.resume') : t('staffDashboard.gate.pause')}</button>
        </div>
        <div className="staff-dash-shortcuts">
          <button type="button" className="staff-dash-shortcut"><ArrowRightCircle size={19} aria-hidden="true" /><span><strong>{t('staffDashboard.gate.processExit')}</strong><span>{t('staffDashboard.gate.processExitHint')}</span></span></button>
          <button type="button" className="staff-dash-shortcut"><QrCode size={19} aria-hidden="true" /><span><strong>{t('staffDashboard.gate.scanQr')}</strong><span>{t('staffDashboard.gate.scanQrHint')}</span></span></button>
          <button type="button" className="staff-dash-shortcut"><ClipboardList size={19} aria-hidden="true" /><span><strong>{t('staffDashboard.gate.updateSlot')}</strong><span>{t('staffDashboard.gate.updateSlotHint')}</span></span></button>
        </div>
      </section>
    </div>

    <div className="staff-dash-bottom">
      <section aria-labelledby="staff-dash-activity">
        <div className="staff-dash-section-heading"><div><h2 className="staff-type-section-title" id="staff-dash-activity">{t('staffDashboard.sections.recentBookings')}</h2><p className="staff-dash-support">{t('staffDashboard.activity.subtitle')}</p></div><span className="staff-dash-muted">{t('staffDashboard.activity.viewAll')}</span></div>
        {!viewAvailability.activityStream ? <DashboardState error>{t('staffDashboard.activity.unavailable')}</DashboardState> : recentBookings.length === 0 ? <DashboardState>{t('staffDashboard.activity.empty')}</DashboardState> : <ul>{recentBookings.map((booking) => <DashboardBooking key={booking._id} booking={booking} />)}</ul>}
      </section>
      <section aria-labelledby="staff-dash-diagnostics">
        <div className="staff-dash-section-heading"><h2 className="staff-type-section-title" id="staff-dash-diagnostics">{t('staffDashboard.sections.diagnostics')}</h2><Activity size={18} className="staff-dash-muted" aria-hidden="true" /></div>
        <ul className="staff-dash-diagnostics">{lotDiagnostics.map((diagnostic) => {
          const Icon = diagnostic.key === 'maintenance' ? Wrench : diagnostic.key === 'cancellations' ? FileWarning : diagnostic.level === 'ok' ? CheckCircle2 : AlertTriangle;
          return <li key={diagnostic.key} className={`staff-dash-diagnostic staff-dash-diagnostic-${diagnostic.level}`}><Icon size={18} aria-hidden="true" /><div><p>{diagnostic.text}</p><p className="staff-dash-support">{diagnostic.time}</p></div></li>;
        })}</ul>
        <p className="staff-dash-verification-note">{t('staffDashboard.diagnosticsNote')}</p>
      </section>
    </div>
  </div>;
}
