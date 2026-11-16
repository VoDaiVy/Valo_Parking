const { SELLABLE_PACKAGE_TYPES: WRITABLE_PACKAGE_TYPES } = require('./ticketPackageRules');
const IDENTITY_INDEX = 'ticket_package_identity_unique';

function packageIdentity(pkg) {
  return JSON.stringify([pkg.type, Number(pkg.price), [...new Set((pkg.serviceBenefits || [])
    .map((benefit) => String(benefit.serviceId).toLowerCase()))].sort()]);
}

function assertWritableType(type) {
  if (!WRITABLE_PACKAGE_TYPES.includes(type)) {
    throw Object.assign(new Error('Loại gói không hợp lệ. Chỉ hỗ trợ weekly, monthly, yearly, custom.'), { statusCode: 400 });
  }
}

function duplicatePackageError() {
  return Object.assign(new Error('A package with the same type, price, and services already exists. Please edit the existing package or select different services.'), { statusCode: 409 });
}

function mapIdentityError(error) {
  if (error.code === 11000 && (error.keyPattern?.identityKey || error.message?.includes(IDENTITY_INDEX))) return duplicatePackageError();
  return error;
}

module.exports = { WRITABLE_PACKAGE_TYPES, IDENTITY_INDEX, packageIdentity, assertWritableType, duplicatePackageError, mapIdentityError };
