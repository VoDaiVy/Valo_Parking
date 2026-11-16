// Featured plans come from the live catalog; deployments may select preferred records.
// Override these IDs per deployment without changing card presentation.
const env = import.meta.env || {};
export const FEATURED_MEMBERSHIP_PACKAGE_IDS = Object.freeze({
  monthly: env.VITE_FEATURED_MONTHLY_PACKAGE_ID || '',
  yearly: env.VITE_FEATURED_YEARLY_PACKAGE_ID || '',
});

export function partitionMembershipPlans(packages, featuredIds = FEATURED_MEMBERSHIP_PACKAGE_IDS) {
  const unique = new Map();
  for (const pkg of packages || []) {
    if (pkg?._id && pkg.isActive === true && ['hourly', 'monthly', 'yearly'].includes(pkg.type)) {
      unique.set(String(pkg._id), pkg);
    }
  }
  const featuredPackages = ['monthly', 'yearly'].flatMap((type) => {
    const pkg = unique.get(String(featuredIds[type])) || [...unique.values()].filter((item) => item.type === type).sort((a, b) => Number(a.price) - Number(b.price) || String(a._id).localeCompare(String(b._id)))[0];
    return pkg?.type === type ? [pkg] : [];
  });
  const featuredSet = new Set(featuredPackages.map((pkg) => String(pkg._id)));
  const additionalPackages = [...unique.values()]
    .filter((pkg) => !featuredSet.has(String(pkg._id)))
    .sort((a, b) => (a.type === 'monthly' ? 0 : 1) - (b.type === 'monthly' ? 0 : 1)
      || Number(a.price || 0) - Number(b.price || 0)
      || String(a._id).localeCompare(String(b._id)));
  return { featuredPackages, additionalPackages };
}
