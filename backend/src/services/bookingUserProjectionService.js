const getEntityId = (entity) => String(entity?._id || entity || '');

const buildFullName = (detail, fallback = '') => {
  const fullName = [detail?.firstName, detail?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return fullName || fallback;
};

const attachBookingUserDetails = (bookings = [], userDetails = []) => {
  const detailByUserId = new Map(
    userDetails.map((detail) => [getEntityId(detail.userId), detail])
  );

  return bookings.map((booking) => {
    const user = booking?.userId;
    if (!user || typeof user !== 'object') return booking;

    const detail = detailByUserId.get(getEntityId(user));

    return {
      ...booking,
      userId: {
        ...user,
        fullName: buildFullName(detail, user.fullName || user.username || ''),
        phone: detail?.phone || user.phone || '',
      },
    };
  });
};

module.exports = {
  attachBookingUserDetails,
};
