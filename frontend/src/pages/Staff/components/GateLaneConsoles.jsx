import {
  ShieldCheck, Sparkles, RefreshCw, CheckCircle2, AlertTriangle,
  PauseCircle, User, Zap, ChevronRight, AlertCircle, Check,
  Loader2, Maximize2, Wallet, Banknote
} from 'lucide-react';
import { normalizeLicensePlate, formatLicensePlateDisplay } from '../../../utils/licensePlate';
import LaneCameraPreview from '../../../components/LaneCameraPreview';
import {
  normalizeSlotCodeLocal,
  formatFloorName,
  formatShortCurrency,
  formatInputCurrency,
  formatGateCurrency,
  formatGateTime,
  getQuickCashSuggestions,
  classifyFloorSlot,
} from './gateControlUtils';

function ViolationStatusRow({ violations, violationDetails, formatCurrency, t }) {
  const pendingCount = Number(violations?.pendingFineCount || 0);
  const totalFine = Number(violations?.totalPendingFine || 0);
  const slotViolations = Array.isArray(violations?.slotViolations) ? violations.slotViolations : [];
  const hasViolation = Boolean(violations?.hasViolations || violationDetails || pendingCount > 0 || slotViolations.length > 0);

  if (!hasViolation) {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">
        <CheckCircle2 size={12} className="shrink-0" />
        <span>{t ? t('gateControlUi.violationsClean') : 'No violations detected'}</span>
      </div>
    );
  }

  const detailText = typeof violationDetails === 'string'
    ? violationDetails
    : (violationDetails?.violationMessage ||
      violationDetails?.message ||
      (violationDetails?.slotCode ? `Unauthorized parking at slot ${violationDetails.slotCode}` : ''));

  return (
    <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[10px] text-red-200 space-y-1">
      <div className="flex items-center gap-1.5 font-bold text-red-300">
        <AlertTriangle size={12} className="shrink-0" />
        <span>
          {t ? t('gateControlUi.violationsDetected') : 'Violations Detected'}
          {pendingCount > 0 ? ` · ${pendingCount} Pending Fine(s) (${formatCurrency ? formatCurrency(totalFine) : totalFine})` : ''}
          {slotViolations.length > 0 ? ` · ${slotViolations.length} Slot Issue(s)` : ''}
        </span>
      </div>
      {detailText ? (
        <p className="text-red-200/90 leading-snug">{detailText}</p>
      ) : null}
      {slotViolations.slice(0, 2).map((sv, idx) => (
        <p key={sv._id || idx} className="text-amber-200/90 leading-snug">
          • {sv.violationMessage || `Wrong-slot alert on plate ${sv.detectedPlate || ''}`}
        </p>
      ))}
    </div>
  );
}

/**
 * Shared UI panel for Entry verification, slot assignment, and check-in actions.
 */
export function EntryLaneConsole({
  ctrl,
  floors,
  activeSessionsList,
  otherSelectedSlotKey = '',
  onOpenAiAssistant,
  t,
}) {
  const classifiedSlots = ctrl.floorSlotsData
    .map((slot) =>
      classifyFloorSlot(
        slot,
        ctrl.floorId,
        activeSessionsList,
        ctrl.activeMapBookings,
        ctrl.activeHoldsList,
        ctrl.verifyData,
        otherSelectedSlotKey
      )
    )
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const availableSlotsList = classifiedSlots.filter((s) => s.selectable);
  const visibleSlots = ctrl.slotFilterMode === 'available' ? availableSlotsList : classifiedSlots;
  const selectedSlotMeta = classifiedSlots.find((s) => s.code === normalizeSlotCodeLocal(ctrl.slotCode));

  return (
    <>
      <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-[#161618] p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-black uppercase text-white/40">{t('gateControlUi.detectedPlate')}</label>
            <div className="relative mt-1">
              <input
                type="text"
                value={ctrl.plate}
                onChange={(e) => ctrl.setPlate(e.target.value)}
                onBlur={() => {
                  if (ctrl.plate) {
                    const formatted = formatLicensePlateDisplay(ctrl.plate);
                    ctrl.setPlate(formatted);
                    ctrl.verifyPlate(formatted);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (ctrl.plate) {
                      const formatted = formatLicensePlateDisplay(ctrl.plate);
                      ctrl.setPlate(formatted);
                      ctrl.verifyPlate(formatted);
                    }
                  }
                }}
                placeholder={t('gateControlUi.platePlaceholder')}
                className="w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm font-black tracking-wider text-emerald-400 placeholder:text-white/20 focus:border-emerald-400 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase text-white/40">{t('gateControlUi.phoneNumber')}</label>
            <input
              type="text"
              value={ctrl.phone}
              onChange={(e) => {
                const nextPhone = e.target.value;
                ctrl.setPhone(nextPhone);
                if (ctrl.plate && nextPhone.trim().length >= 10) {
                  ctrl.verifyPlate(ctrl.plate, null, true, nextPhone.trim());
                }
              }}
              onBlur={() => ctrl.plate && ctrl.phone && ctrl.verifyPlate(ctrl.plate, null, true, ctrl.phone.trim())}
              placeholder={t('gateControlUi.customerPhoneOptional')}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm font-medium text-white placeholder:text-white/20 focus:border-emerald-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Classification & Verification Alert */}
        {ctrl.verifyData && (
          <div className={`p-3 rounded-xl border space-y-2 text-xs ${ctrl.verifyData.isActive || ctrl.verifyData.tooEarly
            ? 'bg-red-500/10 border-red-500/30 text-red-300'
            : ctrl.verifyData.isPausedResume
              ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-200'
              : ctrl.verifyData.isMonthly
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-200'
                : ctrl.verifyData.hasPreBooking
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
            }`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <ShieldCheck size={14} className="shrink-0" />
                <span className="font-bold text-[11px] truncate uppercase tracking-wider">
                  {ctrl.verifyData.isActive
                    ? 'Vehicle Already Inside Lot'
                    : ctrl.verifyData.tooEarly
                      ? (ctrl.verifyData.message || 'Arrived Before Booking Window')
                      : ctrl.verifyData.isPausedResume
                        ? `Paused Booking Resumed (${ctrl.verifyData.remainingHours || 0}h ${ctrl.verifyData.remainingMinutes || 0}m left)`
                        : ctrl.verifyData.hasPreBooking
                          ? 'Pre-booked Customer'
                          : ctrl.verifyData.isMonthly
                            ? `VIP Member (${ctrl.verifyData.membershipType || 'Monthly Pass'})`
                            : 'Walk-in Guest'}
                </span>
              </div>
              <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-bold uppercase shrink-0 border ${ctrl.verifyData.registeredVehicleInfo?.isRegisteredVehicle || ctrl.verifyData.isRegisteredVehicle
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                : ctrl.verifyData.registeredVehicleInfo?.isMemberAccount || ctrl.verifyData.hasPreBooking || ctrl.verifyData.walletInfo?.hasWallet
                  ? 'bg-sky-500/20 text-sky-300 border-sky-400/40'
                  : 'bg-white/10 text-white/60 border-white/15'
                }`}>
                {ctrl.verifyData.registeredVehicleInfo?.isRegisteredVehicle || ctrl.verifyData.isRegisteredVehicle ? (
                  <><CheckCircle2 size={10} /> Registered Vehicle</>
                ) : ctrl.verifyData.registeredVehicleInfo?.isMemberAccount || ctrl.verifyData.hasPreBooking || ctrl.verifyData.walletInfo?.hasWallet ? (
                  <><User size={10} /> Valo Member</>
                ) : (
                  'Walk-in'
                )}
              </span>
            </div>

            {ctrl.verifyData.isPausedResume && ctrl.verifyData.slotAutoReallocated && (
              <div className="rounded-lg bg-amber-500/20 border border-amber-400/40 p-2 text-[11px] text-amber-200 font-medium">
                Original slot {ctrl.verifyData.originalSlot || 'reserved'} was blocked. Auto-reassigned conflict-free slot {ctrl.verifyData.assignedSlot} on {formatFloorName(ctrl.verifyData.assignedFloorName)}.
              </div>
            )}

            {ctrl.verifyData.vipSlotOccupiedByOther && (
              <div className="rounded-lg bg-amber-500/20 border border-amber-400/40 p-2 text-[11px] text-amber-200 font-medium">
                VIP reserved slot {ctrl.verifyData.originalSlot || ''} is occupied by another vehicle. Select any free replacement slot below.
              </div>
            )}

            {ctrl.verifyData.isBookingReallocation && !ctrl.verifyData.slotAutoReallocated && (
              <div className="rounded-lg bg-amber-500/20 border border-amber-400/40 p-2 text-[11px] text-amber-200 font-medium">
                Booked slot {ctrl.verifyData.originalSlot || ''} is currently unavailable. Please select a replacement slot below.
              </div>
            )}

            {ctrl.verifyData.sameOwnerAlternateBooking && !ctrl.dismissSameOwnerBooking && (
              <div className="rounded-xl bg-gradient-to-r from-sky-950/80 to-blue-950/80 border border-sky-400/50 p-2.5 text-xs space-y-1.5 text-sky-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-sky-300">
                    <Sparkles size={13} className="text-sky-400 animate-pulse" />
                    <span>Alternate Booking Found</span>
                  </div>
                  <span className="rounded bg-sky-400/20 px-1.5 py-0.5 text-[9px] font-mono text-sky-300 border border-sky-400/40">
                    Transfer
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-sky-100/90">
                  Customer <strong>{ctrl.verifyData.sameOwnerAlternateBooking.ownerName}</strong> has pre-booked slot <strong>{ctrl.verifyData.sameOwnerAlternateBooking.parkingSlot}</strong> for vehicle <strong>{formatLicensePlateDisplay(ctrl.verifyData.sameOwnerAlternateBooking.originalPlate)}</strong>.
                </p>
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      ctrl.setSlotCode(ctrl.verifyData.sameOwnerAlternateBooking.parkingSlot);
                      if (ctrl.verifyData.sameOwnerAlternateBooking.floorId) {
                        ctrl.setFloorId(ctrl.verifyData.sameOwnerAlternateBooking.floorId);
                      }
                      ctrl.checkIn(ctrl.plate, {
                        ...ctrl.verifyData,
                        bookingId: ctrl.verifyData.sameOwnerAlternateBooking.bookingId,
                        assignedSlot: ctrl.verifyData.sameOwnerAlternateBooking.parkingSlot,
                        assignedFloorId: ctrl.verifyData.sameOwnerAlternateBooking.floorId,
                      });
                    }}
                    className="flex-1 rounded-lg bg-sky-500 py-1.5 text-center text-xs font-bold text-black hover:bg-sky-400 transition shadow-md shadow-sky-500/20"
                  >
                    Transfer Booking to this Vehicle &amp; Check-in
                  </button>
                  <button
                    type="button"
                    onClick={() => ctrl.setDismissSameOwnerBooking(true)}
                    className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10"
                  >
                    Walk-in Instead
                  </button>
                </div>
              </div>
            )}

            {ctrl.verifyData.registeredVehicleInfo && (
              <div className="rounded-lg bg-black/40 border border-white/10 p-2 text-[11px] flex items-center justify-between text-white">
                <div className="min-w-0">
                  <span className="text-white/40 block text-[9px] uppercase font-bold">Customer</span>
                  <span className="font-bold text-white truncate block">{ctrl.verifyData.registeredVehicleInfo.ownerName || 'Customer'}</span>
                </div>
                {ctrl.verifyData.registeredVehicleInfo.vehicleModelInfo && (
                  <div className="text-right min-w-0">
                    <span className="text-white/40 block text-[9px] uppercase font-bold">Vehicle</span>
                    <span className="font-medium text-white/80 truncate block">{ctrl.verifyData.registeredVehicleInfo.vehicleModelInfo}</span>
                  </div>
                )}
              </div>
            )}

            {ctrl.verifyData.walletInfo?.hasWallet ? (
              <div className="rounded-lg bg-black/40 border border-emerald-500/20 p-2 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Wallet size={13} className="text-emerald-400" />
                  <span className="text-white/60">Valo Wallet:</span>
                  <span className="text-emerald-300 font-semibold">Linked Account</span>
                </div>
                <span className={`text-[9px] font-bold uppercase rounded px-2 py-0.5 border ${ctrl.verifyData.walletInfo.balance >= 20000
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                  : 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                  }`}>
                  {ctrl.verifyData.walletInfo.balance >= 20000 ? 'Auto-Pay Ready' : 'Low Balance'}
                </span>
              </div>
            ) : (
              <div className="rounded-lg bg-black/40 border border-white/5 px-2.5 py-1.5 flex items-center justify-between text-[11px] text-white/50">
                <span>Payment on Exit:</span>
                <span className="text-white/80 font-medium">Cash / VietQR</span>
              </div>
            )}

            <ViolationStatusRow
              violations={ctrl.verifyData.violations}
              formatCurrency={formatGateCurrency}
            />
          </div>
        )}

        {/* Slot & Floor Assignment */}
        <div className="space-y-2.5 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black uppercase text-white/40">{t('gateControlUi.parkingFloor')}</label>
              <select
                value={ctrl.floorId}
                onChange={(e) => {
                  const nextFloorId = e.target.value;
                  ctrl.setFloorId(nextFloorId);
                  if (
                    ctrl.verifyData?.assignedFloorId &&
                    String(ctrl.verifyData.assignedFloorId) === String(nextFloorId) &&
                    ctrl.verifyData?.assignedSlot
                  ) {
                    ctrl.setSlotCode(ctrl.verifyData.assignedSlot);
                  } else {
                    ctrl.setSlotCode('');
                  }
                  ctrl.setSlotPickerOpen(true);
                }}
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-xs font-semibold text-white focus:outline-none"
              >
                {floors.map(f => (
                  <option key={f._id} value={f._id}>{formatFloorName(f.name || f.floorNumber)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase text-white/40">{t('gateControlUi.parkingSlot')}</label>
              <button
                type="button"
                onClick={() => {
                  const nextOpen = !ctrl.slotPickerOpen;
                  ctrl.setSlotPickerOpen(nextOpen);
                  if (nextOpen && ctrl.floorId) {
                    ctrl.fetchFloorSlotOptions(ctrl.floorId);
                  }
                }}
                className={`mt-1 w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition ${ctrl.slotPickerOpen
                  ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-300'
                  : ctrl.slotCode
                    ? 'border-emerald-500/40 bg-black/60 text-emerald-400 hover:border-emerald-400/60'
                    : 'border-white/15 bg-black/60 text-white/60 hover:border-white/30 hover:text-white'
                  }`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  {ctrl.slotCode ? (
                    <>
                      <span className="uppercase">{ctrl.slotCode}</span>
                      {selectedSlotMeta?.isVipSlot && (
                        <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-black text-amber-300 border border-amber-400/30">
                          VIP
                        </span>
                      )}
                      {selectedSlotMeta?.isEvSlot && (
                        <span className="rounded bg-sky-500/20 px-1 py-0.5 text-[9px] font-black text-sky-300 border border-sky-400/30">
                          EV
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="font-semibold text-white/40">
                      {t('gateControlUi.selectSlot', { count: availableSlotsList.length })}
                    </span>
                  )}
                </span>
                <ChevronRight
                  size={14}
                  className={`shrink-0 transition-transform ${ctrl.slotPickerOpen ? 'rotate-90 text-emerald-300' : 'text-white/40'}`}
                />
              </button>
            </div>
          </div>

          {ctrl.selectedSlotKey && otherSelectedSlotKey && ctrl.selectedSlotKey === otherSelectedSlotKey && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] font-semibold text-red-200 flex items-center gap-1.5">
              <AlertTriangle size={13} className="shrink-0 text-red-400" />
              <span>Slot {ctrl.slotCode} is currently selected on the other entry lane. Please pick another slot.</span>
            </div>
          )}

          {ctrl.slotPickerOpen && (
            <div className="rounded-xl border border-white/15 bg-[#0d0d0f] p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => ctrl.setSlotFilterMode('available')}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-bold transition ${ctrl.slotFilterMode === 'available'
                      ? 'bg-emerald-500 text-black'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                      }`}
                  >
                    Available ({availableSlotsList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => ctrl.setSlotFilterMode('all')}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-bold transition ${ctrl.slotFilterMode === 'all'
                      ? 'bg-white/20 text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                      }`}
                  >
                    All Slots ({classifiedSlots.length})
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => ctrl.floorId && ctrl.fetchFloorSlotOptions(ctrl.floorId)}
                    disabled={ctrl.isLoadingFloorSlots}
                    className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/70 hover:text-white disabled:opacity-50"
                    title="Refresh live slot availability"
                  >
                    <RefreshCw size={11} className={ctrl.isLoadingFloorSlots ? 'animate-spin' : ''} />
                    <span>{t('gateControlUi.refresh')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => ctrl.setSlotPickerOpen(false)}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/60 hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </div>

              {ctrl.isLoadingFloorSlots && classifiedSlots.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-white/50">
                  <Loader2 size={14} className="animate-spin text-emerald-400" />
                  <span>{t('gateControlUi.loadingSlots')}</span>
                </div>
              ) : visibleSlots.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 py-5 px-3 text-center text-[11px] text-white/50">
                  {classifiedSlots.length === 0
                    ? 'No parking slots configured on this floor.'
                    : 'No free slots on this floor right now. Switch to "All Slots" to inspect occupied/VIP spots or choose another floor.'}
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
                  {visibleSlots.map((item) => {
                    const isSelected = normalizeSlotCodeLocal(ctrl.slotCode) === item.code;
                    const cardTheme = !item.selectable
                      ? item.state === 'vip_reserved'
                        ? 'border-purple-500/25 bg-purple-500/5 text-purple-200/70 opacity-75 cursor-not-allowed'
                        : item.state === 'booked' || item.state === 'held'
                          ? 'border-amber-500/25 bg-amber-500/5 text-amber-200/70 opacity-75 cursor-not-allowed'
                          : item.state === 'occupied'
                            ? 'border-red-500/25 bg-red-500/5 text-red-200/70 opacity-75 cursor-not-allowed'
                            : 'border-white/10 bg-white/[0.03] text-white/40 opacity-65 cursor-not-allowed'
                      : isSelected
                        ? 'border-emerald-400 bg-emerald-500/20 text-white shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                        : item.state === 'assigned'
                          ? 'border-sky-400/50 bg-sky-500/15 text-sky-100 hover:border-sky-300'
                          : item.isVipSlot
                            ? 'border-amber-400/35 bg-amber-500/10 text-amber-100 hover:border-amber-300 hover:bg-amber-500/15'
                            : 'border-emerald-500/25 bg-emerald-500/5 text-white hover:border-emerald-400/60 hover:bg-emerald-500/10';

                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!item.selectable}
                        onClick={() => {
                          ctrl.setSlotCode(item.rawCode || item.code);
                          ctrl.setSlotPickerOpen(false);
                        }}
                        className={`rounded-lg border p-2 text-left transition flex flex-col justify-between gap-1 ${cardTheme}`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-black tracking-wide truncate">{item.code}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            {item.isVipSlot && (
                              <span className="rounded bg-amber-500/25 px-1 py-0.5 text-[8px] font-black uppercase text-amber-300 border border-amber-400/30">
                                VIP
                              </span>
                            )}
                            {!item.isVipSlot && item.isEvSlot && (
                              <span className="rounded bg-sky-500/25 px-1 py-0.5 text-[8px] font-black uppercase text-sky-300 border border-sky-400/30">
                                EV
                              </span>
                            )}
                            {isSelected && <Check size={12} className="text-emerald-300" />}
                          </div>
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-[9px] font-bold uppercase tracking-wider opacity-90 truncate">
                            {item.statusLabel}
                          </p>
                          <p className="text-[9px] opacity-65 truncate" title={item.detail}>
                            {item.detail}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Entry Action Buttons */}
      <div className="mt-4 flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onOpenAiAssistant}
            className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-400/15 to-yellow-500/15 py-3 text-xs font-bold text-amber-300 hover:bg-amber-400 hover:text-black transition shadow-sm active:scale-95 cursor-pointer"
          >
            <Sparkles size={15} className="text-amber-400" />
            <span>{t('gateControlUi.aiAssistant')}</span>
          </button>

          <button
            type="button"
            onClick={() => ctrl.checkIn()}
            disabled={ctrl.isCheckingIn || !ctrl.plate || ctrl.verifyData?.isActive}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 py-3 text-xs font-black text-black hover:brightness-110 disabled:opacity-50 transition shadow-lg shadow-emerald-500/20 active:scale-95 cursor-pointer"
          >
            {ctrl.isCheckingIn ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
            <span>{t('gateControlUi.checkinOpen')}</span>
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Shared UI panel for Exit plate lookup, violation double-check, photo inspection, and settlement.
 */
export function ExitLaneConsole({
  ctrl,
  activeSessionsList,
  snapshot,
  videoRef,
  cameraActive = true,
  cameraConfig,
  captureFrame,
  otherExitPlate = '',
  onPreviewPhoto,
  onOpenAiAssistant,
  t,
}) {
  const normalizedOtherPlate = normalizeLicensePlate(otherExitPlate);

  return (
    <>
      <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-[#161618] p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-black uppercase text-white/40">Verified License Plate</label>
            <div className="relative mt-1">
              <input
                type="text"
                value={ctrl.plate}
                onChange={(e) => ctrl.setPlate(e.target.value)}
                onBlur={() => {
                  if (ctrl.plate) {
                    const formatted = formatLicensePlateDisplay(ctrl.plate);
                    ctrl.setPlate(formatted);
                    ctrl.lookupSession(formatted);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (ctrl.plate) {
                      const formatted = formatLicensePlateDisplay(ctrl.plate);
                      ctrl.setPlate(formatted);
                      ctrl.lookupSession(formatted);
                    }
                  }
                }}
                placeholder="e.g. 43AB-091.91"
                className="w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm font-black tracking-wider text-sky-400 placeholder:text-white/20 focus:border-sky-400 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase text-white/40">Active Vehicles in Lot ({activeSessionsList.length})</label>
            <div className="relative mt-1">
              <select
                value={activeSessionsList.find(s => normalizeLicensePlate(s.licensePlate) === normalizeLicensePlate(ctrl.plate))?.licensePlate || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) {
                    const formatted = formatLicensePlateDisplay(val);
                    ctrl.setPlate(formatted);
                    ctrl.lookupSession(val);
                  } else {
                    ctrl.reset();
                  }
                }}
                className="w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-xs font-bold text-sky-300 focus:border-sky-400 focus:outline-none cursor-pointer truncate"
              >
                <option value="">-- Choose active vehicle --</option>
                {activeSessionsList.map(s => {
                  const isAtOtherGate = Boolean(
                    normalizedOtherPlate && normalizeLicensePlate(s.licensePlate) === normalizedOtherPlate
                  );
                  return (
                    <option key={s._id} value={s.licensePlate} disabled={isAtOtherGate}>
                      {formatLicensePlateDisplay(s.licensePlate)} · Slot {s.parkingSlot || 'N/A'}
                      {isAtOtherGate ? ' (At other gate)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </div>

        {ctrl.statusInfo && !ctrl.statusInfo.found && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200 flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0 text-red-400" />
            <span>No active parking session found for plate <strong>{formatLicensePlateDisplay(ctrl.plate)}</strong> inside the lot.</span>
          </div>
        )}
      </div>

      {/* Unified Active Session & Settlement Console */}
      {ctrl.invoiceData && (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#161618] p-3.5 space-y-3">
          {/* 1. Header Bar: Status & Identity */}
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wider border ${
                ctrl.statusInfo?.sessionType === 'VIP' || ctrl.invoiceData.isMonthly
                  ? 'bg-purple-500/20 text-purple-300 border-purple-400/40'
                  : ctrl.statusInfo?.sessionType === 'BOOKING' || ctrl.invoiceData.session?.type === 'BOOKING'
                    ? 'bg-sky-500/20 text-sky-300 border-sky-400/40'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
              }`}>
                {ctrl.statusInfo?.sessionType === 'VIP' || ctrl.invoiceData.isMonthly
                  ? 'VIP Pass'
                  : ctrl.statusInfo?.sessionType === 'BOOKING' || ctrl.invoiceData.session?.type === 'BOOKING'
                    ? 'Pre-booked Vehicle'
                    : 'Walk-in Session'}
              </span>

              {ctrl.invoiceData.session?.parkingSlot && (
                <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold bg-white/10 text-white/90 border border-white/15">
                  Slot {ctrl.invoiceData.session.parkingSlot}
                </span>
              )}

              <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                ctrl.invoiceData.violationDetails || ctrl.statusInfo?.violations?.hasViolations
                  ? 'bg-red-500/20 text-red-300 border-red-400/40'
                  : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              }`}>
                {ctrl.invoiceData.violationDetails || ctrl.statusInfo?.violations?.hasViolations ? (
                  <><AlertTriangle size={10} /> Violation Detected</>
                ) : (
                  <><CheckCircle2 size={10} /> No Violations</>
                )}
              </span>
            </div>
          </div>

          {/* 2. Customer Profile & Visual Double-Check */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-black/40 border border-white/5 p-2.5 space-y-1.5 text-white flex flex-col justify-center">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-white/40 text-[9px] uppercase font-bold">Customer</span>
                <span className="font-bold text-white truncate max-w-[140px]">
                  {ctrl.invoiceData.registeredVehicleInfo?.ownerName || 'Walk-in Customer'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-white/40 text-[9px] uppercase font-bold">Vehicle</span>
                <span className="font-medium text-white/80 truncate max-w-[140px]">
                  {ctrl.invoiceData.registeredVehicleInfo?.vehicleModelInfo || ctrl.invoiceData.session?.vehicleType || 'Automobile'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-white/40 text-[9px] uppercase font-bold">Check-in</span>
                <span className="font-mono text-white/70">{formatGateTime(ctrl.invoiceData.session?.checkInTime)}</span>
              </div>
            </div>

            <div className="rounded-lg bg-black/40 border border-white/5 p-2 flex items-center justify-between gap-2.5">
              <div className="flex-1 text-center">
                <div className="flex items-center justify-between mb-1 px-0.5">
                  <span className="text-[10px] font-bold text-emerald-400">Ảnh Check-in</span>
                  <span className="text-[9px] text-white/40 flex items-center gap-0.5"><Maximize2 size={9} /> Phóng to</span>
                </div>
                <div
                  onClick={() => {
                    onPreviewPhoto?.({
                      title: 'Ảnh xe lúc Check-in (Cổng Vào)',
                      image: ctrl.invoiceData.session?.entryImage,
                      time: formatGateTime(ctrl.invoiceData.session?.checkInTime),
                      plate: formatLicensePlateDisplay(ctrl.invoiceData.session?.licensePlate || ctrl.plate),
                      type: 'entry',
                    });
                  }}
                  className="group relative h-24 sm:h-28 w-full rounded-lg bg-black border border-white/10 overflow-hidden flex items-center justify-center cursor-pointer hover:border-emerald-400 transition"
                  title="Bấm để phóng to kiểm tra ảnh check-in"
                >
                  {ctrl.invoiceData.session?.entryImage ? (
                    <img
                      src={ctrl.invoiceData.session.entryImage}
                      alt="Entry Checkin"
                      className="h-full w-full object-contain group-hover:scale-105 transition duration-200"
                    />
                  ) : (
                    <span className="text-[10px] text-white/30 font-medium">Không có ảnh vào</span>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                    <span className="rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-bold text-white flex items-center gap-1 border border-white/20">
                      <Maximize2 size={10} /> Xem lớn
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex-1 text-center">
                <div className="flex items-center justify-between mb-1 px-0.5">
                  <span className="text-[10px] font-bold text-sky-400">Ảnh Cổng Ra</span>
                  <span className="text-[9px] text-white/40 flex items-center gap-0.5"><Maximize2 size={9} /> Phóng to</span>
                </div>
                <div
                  onClick={() => {
                    const snap = snapshot || captureFrame(ctrl.cameraLane);
                    onPreviewPhoto?.({
                      title: `Ảnh xe tại ${ctrl.gate} (Live Checkout)`,
                      image: snap,
                      time: 'Hiện tại (Check-out)',
                      plate: formatLicensePlateDisplay(ctrl.plate),
                      type: 'exit',
                    });
                  }}
                  className="group relative h-24 sm:h-28 w-full rounded-lg bg-black border border-white/10 overflow-hidden flex items-center justify-center cursor-pointer hover:border-sky-400 transition"
                  title="Bấm để phóng to kiểm tra camera ra"
                >
                  {snapshot ? (
                    <img
                      src={snapshot}
                      alt="Exit Checkout"
                      className="h-full w-full object-contain group-hover:scale-105 transition duration-200"
                    />
                  ) : (
                    <div className="h-full w-full flex flex-col items-center justify-center bg-black/80">
                      <LaneCameraPreview
                        videoRef={videoRef}
                        lane={ctrl.cameraLane}
                        cameraConfig={cameraConfig}
                        active={cameraActive}
                        className="h-full w-full object-contain pointer-events-none"
                      />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                    <span className="rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-bold text-white flex items-center gap-1 border border-white/20">
                      <Maximize2 size={10} /> Xem lớn
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Violation Alert Details */}
          {ctrl.invoiceData.violationDetails && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/50 p-2.5 text-xs text-red-200 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-black text-red-400 uppercase text-[10px]">
                  <AlertTriangle size={13} className="text-red-400" />
                  Parking Violation Detected
                </span>
                <span className="font-mono text-[9px] font-bold text-red-300">
                  {ctrl.invoiceData.violationDetails.durationMinutes || 0} min
                </span>
              </div>
              <p className="text-[11px] text-white/90">
                {typeof ctrl.invoiceData.violationDetails === 'string'
                  ? ctrl.invoiceData.violationDetails
                  : ctrl.invoiceData.violationDetails.violationMessage || `Unauthorized parking at slot ${ctrl.invoiceData.violationDetails.slotCode || 'N/A'}`}
              </p>
            </div>
          )}

          {/* 4. Settlement & Fee Summary */}
          <div className="rounded-lg bg-black/60 px-3.5 py-2.5 text-xs border border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3 text-white/70 text-[11px]">
              <div>
                <span className="text-white/40 block text-[9px] uppercase font-bold">Thời gian đỗ</span>
                <span className="font-bold text-white">{ctrl.invoiceData.durationFormatted || '2 hrs'}</span>
              </div>
              {ctrl.invoiceData.parkingFee > 0 && ctrl.invoiceData.parkingFee !== ctrl.invoiceData.totalAmount && (
                <>
                  <div className="h-5 w-px bg-white/10" />
                  <div>
                    <span className="text-white/40 block text-[9px] uppercase font-bold">Giá gốc</span>
                    <span className="font-mono text-white/50 line-through">{formatGateCurrency(ctrl.invoiceData.parkingFee)}</span>
                  </div>
                </>
              )}
              {ctrl.invoiceData.discountAmount > 0 && (
                <>
                  <div className="h-5 w-px bg-white/10" />
                  <div>
                    <span className="text-emerald-400/80 block text-[9px] uppercase font-bold">Ưu đãi</span>
                    <span className="font-mono font-bold text-emerald-400">-{formatGateCurrency(ctrl.invoiceData.discountAmount)}</span>
                  </div>
                </>
              )}
            </div>
            <div className="text-right">
              <span className="text-white/40 block text-[9px] uppercase font-black">Cần thanh toán</span>
              <span className="text-sm sm:text-base font-black text-[#ffd555] font-mono">
                {formatGateCurrency(ctrl.invoiceData.totalAmount || 0)}
              </span>
            </div>
          </div>

          {/* 5. Payment Methods & Cash Collection */}
          {ctrl.invoiceData.totalAmount > 0 ? (
            <div className="space-y-2">
              {ctrl.invoiceData.canAutoPay && (
                <button
                  type="button"
                  onClick={() => ctrl.checkOut(null, false, 'wallet')}
                  disabled={ctrl.isCheckingOut}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 py-2 text-xs font-black text-black hover:brightness-110 transition shadow-md shadow-cyan-500/20 active:scale-95 cursor-pointer"
                >
                  {ctrl.isCheckingOut ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                  <span>Auto-Debit Wallet &amp; Open Gate ({formatGateCurrency(ctrl.invoiceData.totalAmount)})</span>
                </button>
              )}

              <div className="rounded-lg border border-white/10 bg-[#121214] p-2 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 font-bold text-amber-300 text-[11px]">
                    <Banknote size={13} className="text-amber-400" />
                    <span>{ctrl.invoiceData.canAutoPay ? 'Or Collect Cash / VietQR' : 'Collect Cash / VietQR'}</span>
                  </span>
                  {ctrl.invoiceData.hasWallet && !ctrl.invoiceData.canAutoPay && (
                    <span className="rounded bg-red-400/20 px-1.5 py-0.5 text-[9px] font-bold text-red-300 border border-red-400/30">
                      Insufficient Wallet Balance
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatInputCurrency(ctrl.cashReceivedAmount)}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '');
                        ctrl.setCashReceivedAmount(raw);
                      }}
                      placeholder={`Tối thiểu ${formatGateCurrency(ctrl.invoiceData.totalAmount)}`}
                      className="w-full rounded-lg border border-white/15 bg-black/60 px-2.5 py-1.5 pr-9 font-mono text-xs font-semibold text-white placeholder:text-white/20 outline-none focus:border-amber-400"
                    />
                    <span className="absolute right-2 top-1.5 text-[10px] font-bold text-white/40 font-mono">VND</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => ctrl.setCashReceivedAmount(String(ctrl.invoiceData.totalAmount))}
                    className={`shrink-0 rounded-lg px-2 py-1.5 text-[10px] font-bold transition border ${
                      Number(ctrl.cashReceivedAmount) === Number(ctrl.invoiceData.totalAmount)
                        ? 'bg-amber-400 text-black border-amber-400'
                        : 'bg-amber-400/10 text-amber-300 border-amber-400/30 hover:bg-amber-400/20'
                    }`}
                  >
                    Exact ({formatShortCurrency(ctrl.invoiceData.totalAmount)})
                  </button>

                  {getQuickCashSuggestions(ctrl.invoiceData.totalAmount).map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => ctrl.setCashReceivedAmount(String(val))}
                      className={`shrink-0 rounded-lg px-1.5 py-1.5 text-[10px] font-mono font-medium transition border ${
                        Number(ctrl.cashReceivedAmount) === val
                          ? 'bg-amber-400 text-black border-amber-400 font-bold'
                          : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      {formatShortCurrency(val)}
                    </button>
                  ))}
                </div>

                {Number(ctrl.cashReceivedAmount) >= Number(ctrl.invoiceData.totalAmount) && (
                  <div className="rounded bg-emerald-950/30 border border-emerald-500/30 px-2 py-1 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-emerald-200 text-[11px]">
                      <span>Change:</span>
                      <span className="font-mono font-black text-emerald-300 text-sm">
                        {formatGateCurrency(Number(ctrl.cashReceivedAmount) - Number(ctrl.invoiceData.totalAmount))}
                      </span>
                    </div>
                    {Number(ctrl.cashReceivedAmount) > Number(ctrl.invoiceData.totalAmount) && ctrl.invoiceData.hasWallet && (
                      <label className="flex items-center gap-1 cursor-pointer text-[10px] text-cyan-200">
                        <input
                          type="checkbox"
                          checked={ctrl.depositChangeToWallet}
                          onChange={(e) => ctrl.setDepositChangeToWallet(e.target.checked)}
                          className="rounded border-cyan-400 bg-black/60 text-cyan-500 scale-90"
                        />
                        <span>Deposit to Valo Wallet</span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-400" />
                <span className="font-bold text-emerald-300 text-xs">No Fee Due (0 VND) — Covered by Pass/Booking</span>
              </div>
              <span className="rounded bg-emerald-400/20 px-1.5 py-0.5 text-[9px] font-black uppercase text-emerald-300 border border-emerald-400/40 font-mono">
                PAID
              </span>
            </div>
          )}
        </div>
      )}

      {/* Exit Action Buttons */}
      <div className="mt-4 flex flex-col gap-2">
        {ctrl.invoiceData?.isEarlyExit && (
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-200">
            <div className="flex items-center gap-1.5 font-bold mb-1 text-cyan-300">
              <PauseCircle size={15} className="text-cyan-400" />
              <span>Early Departure Choice</span>
              <span className="ml-auto rounded bg-cyan-400/20 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300 border border-cyan-400/30">
                {ctrl.invoiceData.remainingHours || 0}h Left
              </span>
            </div>
            <p className="text-[11px] text-cyan-100/70 mb-2.5">
              Pre-booking remains valid until {ctrl.invoiceData.bookingEnd ? new Date(ctrl.invoiceData.bookingEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'end time'}. Choose whether customer will return or is ending their visit now.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => ctrl.checkOut(null, true, ctrl.invoiceData.canAutoPay && !ctrl.cashReceivedAmount ? 'wallet' : 'cash')}
                disabled={
                  ctrl.isCheckingOut
                  || (Number(ctrl.invoiceData.totalAmount || 0) > 0
                    && !ctrl.invoiceData.canAutoPay
                    && Number(ctrl.cashReceivedAmount) < Number(ctrl.invoiceData.totalAmount))
                }
                className="flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500 py-2 text-xs font-black text-black hover:bg-cyan-400 disabled:opacity-50 transition shadow-lg shadow-cyan-500/20"
              >
                {ctrl.isCheckingOut ? <Loader2 size={13} className="animate-spin" /> : <PauseCircle size={13} />}
                <span>Pause (Keep Slot)</span>
              </button>
              <button
                type="button"
                onClick={() => ctrl.checkOut(null, false, ctrl.invoiceData.canAutoPay && !ctrl.cashReceivedAmount ? 'wallet' : 'cash')}
                disabled={
                  ctrl.isCheckingOut
                  || (Number(ctrl.invoiceData.totalAmount || 0) > 0
                    && !ctrl.invoiceData.canAutoPay
                    && Number(ctrl.cashReceivedAmount) < Number(ctrl.invoiceData.totalAmount))
                }
                className="flex items-center justify-center gap-1.5 rounded-lg border border-white/20 bg-white/10 py-2 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-50 transition"
              >
                {ctrl.isCheckingOut ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                <span>End Session</span>
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onOpenAiAssistant}
            className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-400/15 to-yellow-500/15 py-3 text-xs font-bold text-amber-300 hover:bg-amber-400 hover:text-black transition shadow-sm active:scale-95 cursor-pointer"
          >
            <Sparkles size={15} className="text-amber-400" />
            <span>{t('gateControlUi.aiAssistant')}</span>
          </button>

          {!ctrl.invoiceData?.isEarlyExit ? (
            <button
              type="button"
              onClick={() => ctrl.checkOut(null, false, ctrl.invoiceData?.canAutoPay && !ctrl.cashReceivedAmount ? 'wallet' : 'cash')}
              disabled={
                ctrl.isCheckingOut
                || !ctrl.invoiceData
                || (Number(ctrl.invoiceData.totalAmount || 0) > 0
                  && !ctrl.invoiceData.canAutoPay
                  && Number(ctrl.cashReceivedAmount) < Number(ctrl.invoiceData.totalAmount))
              }
              className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 py-3 text-xs font-black text-black hover:brightness-110 disabled:opacity-50 transition shadow-lg shadow-sky-500/20 active:scale-95 cursor-pointer"
            >
              {ctrl.isCheckingOut ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              <span>
                {Number(ctrl.cashReceivedAmount) >= Number(ctrl.invoiceData?.totalAmount || 0) && Number(ctrl.invoiceData?.totalAmount || 0) > 0
                  ? 'Collect Cash & Open Gate'
                  : Number(ctrl.invoiceData?.totalAmount || 0) === 0
                    ? 'Free Pass & Open Gate'
                    : (t ? t('gateControlUi.checkoutOpen') : 'Check-out & Open Gate')}
              </span>
            </button>
          ) : (
            <div className="flex items-center justify-center rounded-xl bg-white/5 border border-white/10 px-2 py-3 text-[11px] font-semibold text-white/50 text-center">
              Select Pause or End above
            </div>
          )}
        </div>
      </div>
    </>
  );
}
