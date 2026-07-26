const toId = (value) => String(value?._id || value || '');

const buildVehiclesByUserId = (vehicles = []) => {
  const vehiclesByUserId = new Map();

  for (const vehicle of vehicles) {
    const userId = toId(vehicle.owner);
    if (!userId) continue;
    if (!vehiclesByUserId.has(userId)) vehiclesByUserId.set(userId, []);
    vehiclesByUserId.get(userId).push(vehicle.licensePlate);
  }

  return vehiclesByUserId;
};

const buildOwnersBySubscriptionId = (entitlements = [], vehiclesByUserId) => {
  const ownersBySubscriptionId = new Map();

  for (const entitlement of entitlements) {
    const subscriptionId = toId(entitlement.sourceSubscriptionId);
    const ownerId = toId(entitlement.ownerId);
    if (!subscriptionId || !ownerId) continue;

    if (!ownersBySubscriptionId.has(subscriptionId)) {
      ownersBySubscriptionId.set(subscriptionId, new Map());
    }

    const owners = ownersBySubscriptionId.get(subscriptionId);
    if (!owners.has(ownerId)) {
      owners.set(ownerId, {
        ...entitlement.ownerId,
        vehicles: vehiclesByUserId.get(ownerId) || [],
      });
    }
  }

  return ownersBySubscriptionId;
};

const buildAdminSubscriptionProjection = ({
  subscriptions = [],
  entitlements = [],
  vehicles = [],
}) => {
  const vehiclesByUserId = buildVehiclesByUserId(vehicles);
  const ownersBySubscriptionId = buildOwnersBySubscriptionId(
    entitlements,
    vehiclesByUserId
  );

  return subscriptions.map((subscription) => {
    const originalUserId = toId(subscription.user);
    const originalUser = subscription.user
      ? {
          ...subscription.user,
          vehicles: vehiclesByUserId.get(originalUserId) || [],
        }
      : null;
    const currentOwners = Array.from(
      ownersBySubscriptionId.get(toId(subscription))?.values() || []
    );

    return {
      ...subscription,
      user: originalUser,
      originalUser,
      currentOwner: currentOwners.length === 1 ? currentOwners[0] : null,
      currentOwners,
    };
  });
};

module.exports = {
  buildAdminSubscriptionProjection,
};
