const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attachBookingUserDetails,
} = require('../services/bookingUserProjectionService');

test('adds profile name and phone from UserDetail to populated booking users', () => {
  const bookings = [
    {
      _id: 'booking-1',
      userId: {
        _id: 'user-1',
        username: 'vyvodadin',
        email: 'vyvodadin@gmail.com',
      },
    },
  ];
  const userDetails = [
    {
      userId: 'user-1',
      firstName: 'Vy',
      lastName: 'Vo',
      phone: '0904555791',
    },
  ];

  const [booking] = attachBookingUserDetails(bookings, userDetails);

  assert.equal(booking.userId.fullName, 'Vy Vo');
  assert.equal(booking.userId.phone, '0904555791');
  assert.equal(booking.userId.email, 'vyvodadin@gmail.com');
});
