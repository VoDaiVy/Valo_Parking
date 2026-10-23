import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Save, Clock3, CalendarDays } from 'lucide-react';
import { PricingHeader, PricingOverview, PricingSchedule, TimeBlockEditor, PricePolicyEditor, AdditionalPricingRules, PricingSummary } from './PricingPanels';
import { DEFAULT_DAY_NIGHT, serializeConfig, getScheduleStatus } from './pricingDisplay';
import './pricingManagement.css';

export default function PricingManagement() {
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [activeTab, setActiveTab] = useState('time-blocks');
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [timeBlocks, setTimeBlocks] = useState([]);
  const [dayNightPricing, setDayNightPricing] = useState(DEFAULT_DAY_NIGHT);
  const [pricePolicies, setPricePolicies] = useState([]);
  const [baselineConfig, setBaselineConfig] = useState('');

  const fetchConfig = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError('');
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/admin/pricing-config`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` }
      });
      const data = await res.json();
      if (data.success && data.data) {
        const nextBlocks = data.data.timeBlocks || [];
        const nextDayNight = data.data.dayNightPricing || DEFAULT_DAY_NIGHT;
        const nextPolicies = data.data.pricePolicies || [];
        setConfig(data.data);
        setTimeBlocks(nextBlocks);
        setDayNightPricing(nextDayNight);
        setPricePolicies(nextPolicies);
        setBaselineConfig(serializeConfig(nextBlocks, nextDayNight, nextPolicies));
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load pricing config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConfig();
  }, []);

  const handleAddTimeBlock = () => {
    setSuccess('');
    setTimeBlocks([...timeBlocks, { startHour: 0, endHour: 0, price: 0 }]);
  };

  const handleRemoveTimeBlock = (index) => {
    setSuccess('');
    const newBlocks = [...timeBlocks];
    newBlocks.splice(index, 1);
    setTimeBlocks(newBlocks);
  };

  const handleTimeBlockChange = (index, field, value) => {
    setSuccess('');
    const newBlocks = [...timeBlocks];
    newBlocks[index][field] = value === '' ? '' : Number(value);
    setTimeBlocks(newBlocks);
  };

  const handleAddPolicy = () => {
    setSuccess('');
    setPricePolicies((current) => [...current, {
      name: '', scope: 'weekday', daysOfWeek: [1], months: [], startDate: '', endDate: '', adjustmentPercent: 0, priority: 0, isActive: true,
    }]);
  };

  const handlePolicyChange = (index, field, value) => {
    setSuccess('');
    setError('');
    setPricePolicies((current) => current.map((policy, policyIndex) => policyIndex === index ? { ...policy, [field]: value } : policy));
  };

  const handleRemovePolicy = (index) => {
    setSuccess('');
    setPricePolicies((current) => current.filter((_, policyIndex) => policyIndex !== index));
  };

  const handleResetChanges = () => {
    if (!baselineConfig) return;
    const parsed = JSON.parse(baselineConfig);
    setTimeBlocks(parsed.timeBlocks);
    setDayNightPricing(parsed.dayNightPricing || DEFAULT_DAY_NIGHT);
    setPricePolicies(parsed.pricePolicies || []);
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    // Validate
    if (timeBlocks.length === 0) {
      setError('Must have at least one time block.');
      return;
    }
    for (let i = 0; i < timeBlocks.length; i++) {
      const b = timeBlocks[i];
      if (b.startHour < 0 || b.startHour > 23 || b.endHour < 0 || b.endHour > 24) {
        setError('Hours must be between 0 and 24.');
        return;
      }
      if (b.price === '' || b.price < 0) {
        setError('Price must be a valid number and cannot be negative.');
        return;
      }
      if (b.startHour === b.endHour) {
        setError('A time block cannot have the same start and end time.');
        return;
      }
    }

    // Validate coverage of 24 hours (no gaps, no overlaps)
    const hours = new Array(24).fill(false);
    for (let i = 0; i < timeBlocks.length; i++) {
      const b = timeBlocks[i];
      const start = b.startHour;
      const end = b.endHour;

      const markHour = (h) => {
        if (hours[h]) {
          throw new Error(`Overlap detected at hour ${h}:00`);
        }
        hours[h] = true;
      };

      try {
        if (start < end) {
          for (let h = start; h < end; h++) markHour(h);
        } else {
          for (let h = start; h < 24; h++) markHour(h);
          for (let h = 0; h < end; h++) markHour(h);
        }
      } catch (e) {
        setError(e.message);
        return;
      }
    }

    const missingHour = hours.findIndex(h => !h);
    if (missingHour !== -1) {
      setError(`Gap detected in schedule. Time block missing for hour ${missingHour}:00`);
      return;
    }

    for (const [period, block] of Object.entries(dayNightPricing)) {
      if (!Number.isInteger(Number(block.startHour)) || Number(block.startHour) < 0 || Number(block.startHour) > 23
        || block.price === '' || !Number.isFinite(Number(block.price)) || Number(block.price) < 0) {
        setError(`${period === 'day' ? 'Day' : 'Night'} pricing needs a valid start hour and non-negative price.`);
        return;
      }
    }
    if ((Number(dayNightPricing.day.startHour) + 12) % 24 !== Number(dayNightPricing.night.startHour)) {
      setError('Day and night blocks must be consecutive and exactly 12 hours each.');
      return;
    }
    for (const policy of pricePolicies) {
      if (!policy.name?.trim() || policy.adjustmentPercent === '' || !Number.isFinite(Number(policy.adjustmentPercent)) || Number(policy.adjustmentPercent) < -100 || Number(policy.adjustmentPercent) > 500) {
        setError('Mỗi chính sách cần có tên và phần trăm hợp lệ: giảm tối đa 100%, tăng tối đa 500%.');
        return;
      }
      if (policy.scope === 'weekday' && !policy.daysOfWeek?.length) {
        setError(`Select at least one weekday for ${policy.name}.`);
        return;
      }
      if (policy.scope === 'month' && !policy.months?.length) {
        setError(`Select at least one month for ${policy.name}.`);
        return;
      }
      if (policy.scope === 'date_range' && (!policy.startDate || !policy.endDate || policy.startDate > policy.endDate)) {
        setError(`Choose a valid date range for ${policy.name}.`);
        return;
      }
    }

    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/admin/pricing-config`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}` 
        },
        body: JSON.stringify({
          timeBlocks,
          dayNightPricing,
          pricePolicies,
          // The existing API requires these legacy fields, even without cap controls.
          cap12h: config.cap12h ?? 100000,
          cap24h: config.cap24h ?? 180000,
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccess('Pricing configuration updated successfully!');
        await fetchConfig({ silent: true });
      } else {
        setError(data.message || 'Failed to update configuration.');
      }
    } catch (err) {
      console.error(err);
      setError('Network error while saving config.');
    } finally {
      setSaving(false);
    }
  };

  const scheduleStatus = useMemo(() => getScheduleStatus(timeBlocks), [timeBlocks]);
  const hasUnsavedChanges = useMemo(
    () => Boolean(baselineConfig) && serializeConfig(timeBlocks, dayNightPricing, pricePolicies) !== baselineConfig,
    [baselineConfig, dayNightPricing, pricePolicies, timeBlocks]
  );

  const selectBlock = (index) => {
    setSelectedBlock(index);
    const row = document.getElementById(`pricing-block-${index}`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
  };

  if (loading) return <div className="pricing-page pricing-loading" role="status"><Loader2 className="animate-spin" size={24} />Loading pricing configuration...</div>;

  return <div className="pricing-page">
    <div className="pricing-content">
      <PricingHeader status={scheduleStatus} />
      <nav className="pricing-tabs" aria-label="Pricing sections">
        {[['time-blocks', 'Time Blocks', Clock3], ['policies', 'Calendar Policies', CalendarDays]].map(([value, label, Icon]) => <button key={value} type="button" aria-current={activeTab === value ? 'page' : undefined} onClick={() => setActiveTab(value)}><Icon size={16} aria-hidden="true" />{label}</button>)}
      </nav>
      {activeTab === 'time-blocks' ? <>
        <PricingOverview timeBlocks={timeBlocks} />
        <PricingSchedule timeBlocks={timeBlocks} onSelect={selectBlock} />
        <TimeBlockEditor timeBlocks={timeBlocks} selectedBlock={selectedBlock} onAdd={handleAddTimeBlock} onChange={handleTimeBlockChange} onRemove={handleRemoveTimeBlock} />
      </> : <PricePolicyEditor policies={pricePolicies} onAdd={handleAddPolicy} onChange={handlePolicyChange} onRemove={handleRemovePolicy} />}
      {config && <AdditionalPricingRules config={config} />}
      <PricingSummary timeBlocks={timeBlocks} status={scheduleStatus} />
    </div>
    {(hasUnsavedChanges || error || success || saving) && <footer className="pricing-save-bar">
      <p role={error ? 'alert' : 'status'} className={error ? 'pricing-error' : success ? 'pricing-success' : ''}>{error || success || 'You have unsaved changes'}</p>
      <div><button type="button" className="pricing-button" onClick={handleResetChanges} disabled={saving || !hasUnsavedChanges}><RotateCcw size={16} aria-hidden="true" />Reset changes</button><button type="button" className="pricing-button pricing-primary" onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} aria-hidden="true" />}{saving ? 'Saving...' : 'Save configuration'}</button></div>
    </footer>}
  </div>;
}
