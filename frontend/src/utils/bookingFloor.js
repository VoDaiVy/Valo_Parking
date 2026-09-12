export const buildFloorLookup = (floors = []) => Object.fromEntries(
  floors.filter((floor) => floor?._id).map((floor) => [String(floor._id), floor]),
);

export const getBookingFloorLabel = (booking, floorLookup = {}) => {
  const reference = booking?.floorId;
  const id = String(reference?._id || reference || '');
  const floor = floorLookup[id] || reference;
  const name = typeof floor?.name === 'string' ? floor.name.trim() : '';
  if (name && !/^floor$/i.test(name)) return name;
  if (Number.isInteger(floor?.floorNumber)) return `Floor ${floor.floorNumber}`;
  return 'Unknown floor';
};
