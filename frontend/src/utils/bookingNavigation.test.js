import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBookingUrl,
  buildLoginUrl,
  findRequestedService,
  getSafeReturnUrl,
  resolvePostLoginDestination,
} from './bookingNavigation.js';

test('builds a booking URL with the selected service', () => {
  assert.equal(buildBookingUrl('service 1'), '/booking?serviceId=service+1');
  assert.equal(buildBookingUrl(''), '/booking');
});

test('keeps the protected booking URL through login', () => {
  const bookingUrl = buildBookingUrl('service-1');
  const loginUrl = buildLoginUrl(bookingUrl);
  const loginSearch = loginUrl.slice(loginUrl.indexOf('?'));

  assert.equal(getSafeReturnUrl(loginSearch), bookingUrl);
  assert.equal(
    resolvePostLoginDestination('customer', getSafeReturnUrl(loginSearch)),
    bookingUrl,
  );
});

test('rejects external return URLs and keeps role-specific destinations', () => {
  assert.equal(getSafeReturnUrl('?returnUrl=https%3A%2F%2Fevil.example'), '');
  assert.equal(getSafeReturnUrl('?returnUrl=%2F%2Fevil.example'), '');
  assert.equal(
    resolvePostLoginDestination('admin', '/booking?serviceId=service-1'),
    '/admin/dashboard',
  );
});

test('finds only a service returned by the active service list', () => {
  const services = [{ _id: 'service-1', name: 'Car wash' }];

  assert.equal(findRequestedService(services, 'service-1'), services[0]);
  assert.equal(findRequestedService(services, 'inactive-service'), null);
});
