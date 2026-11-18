const Service = require('../models/Service');
const { getPackageDurationMinutes } = require('../utils/ticketPackageRules');

async function resolveServiceBenefits(benefits, session, requireActive = true) {
  if (!benefits.length) return [];
  const ids = benefits.map((benefit) => benefit.serviceId);
  const query = Service.find({ _id: { $in: ids }, ...(requireActive ? { isActive: true } : {}) }).select('_id name');
  if (session) query.session(session);
  const services = await query.lean();
  const byId = new Map(services.map((service) => [String(service._id), service]));
  return benefits.map((benefit) => {
    const service = byId.get(String(benefit.serviceId));
    if (!service) throw Object.assign(new Error('A selected service is no longer active. Update the package services before purchasing.'), { statusCode: 409 });
    return { serviceId: service._id, serviceName: service.name, quantityPerSlot: benefit.quantityPerSlot };
  });
}

async function capturePackageTerms(pkg, revision) {
  if (pkg.benefitsVersion >= 1 && revision !== pkg.revision) {
    throw Object.assign(new Error('Package terms changed. Reload the package and confirm its price and benefits.'), { statusCode: 409, code: 'PACKAGE_TERMS_CHANGED' });
  }
  return {
    name: pkg.name,
    unitPrice: pkg.price,
    type: pkg.type,
    durationDays: pkg.durationDays ?? null,
    durationMinutes: getPackageDurationMinutes(pkg),
    benefitsVersion: pkg.benefitsVersion || 0,
    displayBenefits: Array.from(pkg.displayBenefits || []),
    serviceBenefits: await resolveServiceBenefits(pkg.serviceBenefits || []),
    revision: pkg.revision ?? 0,
  };
}

module.exports = { resolveServiceBenefits, capturePackageTerms };
