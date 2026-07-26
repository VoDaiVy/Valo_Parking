const MAX_VEHICLES_PER_USER = 3;

const getVehicleCapacity = (vehicleCount) => {
  const normalizedCount = Math.max(0, Number(vehicleCount) || 0);
  return {
    count: normalizedCount,
    limit: MAX_VEHICLES_PER_USER,
    remaining: Math.max(0, MAX_VEHICLES_PER_USER - normalizedCount),
    limitReached: normalizedCount >= MAX_VEHICLES_PER_USER,
  };
};

module.exports = {
  MAX_VEHICLES_PER_USER,
  getVehicleCapacity,
};
