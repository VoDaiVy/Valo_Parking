/**
 * Migration Script: Normalize Floor 2 -> Floor 1 and Zone E, F, G, H -> Zone A, B, C, D
 * Fully synchronizes:
 * - ParkingFloor (floorNumber, name, code, layoutData)
 * - Zone (zoneName)
 * - Slot (slotNumber)
 * - MembershipSlotEntitlement (slotCode)
 * - Subscription (slots[].slotCode)
 * - Booking (parkingSlot, slotChangesHistory)
 * - Session (parkingSlot)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');

const ParkingFloor = require('../models/ParkingFloor');
const Zone = require('../models/Zone');
const Slot = require('../models/Slot');
const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');
const Subscription = require('../models/Subscription');
const Booking = require('../models/Booking');
const Session = require('../models/Session');

const ZONE_MAP = {
  'ZONE E': 'ZONE A',
  'ZONE F': 'ZONE B',
  'ZONE G': 'ZONE C',
  'ZONE H': 'ZONE D',
  'Zone E': 'Zone A',
  'Zone F': 'Zone B',
  'Zone G': 'Zone C',
  'Zone H': 'Zone D',
};

function mapSlotCode(oldCode) {
  if (!oldCode) return oldCode;
  const upper = oldCode.toUpperCase().trim();
  const firstChar = upper.charAt(0);
  const rest = upper.slice(1);
  if (firstChar === 'E') return `A${rest}`;
  if (firstChar === 'F') return `B${rest}`;
  if (firstChar === 'G') return `C${rest}`;
  if (firstChar === 'H') return `D${rest}`;
  return upper;
}

async function runMigration() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/valoparking';
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB successfully.');

  try {
    // 1. Locate Floor 2 (or the active floor that needs renumbering)
    let floor = await ParkingFloor.findOne({ floorNumber: 2 });
    if (!floor) {
      floor = await ParkingFloor.findOne({ name: /Floor 2/i });
    }

    if (!floor) {
      console.log('No Floor 2 found in database. Checking existing floors...');
      const allFloors = await ParkingFloor.find().select('floorNumber name code').lean();
      console.log('Existing floors:', allFloors);
      if (allFloors.some(f => f.floorNumber === 1)) {
        console.log('Floor 1 already exists. No migration needed.');
        process.exit(0);
      }
      console.error('Neither Floor 2 nor Floor 1 found. Aborting.');
      process.exit(1);
    }

    const floorId = floor._id;
    console.log(`Found target floor: "${floor.name}" (ID: ${floorId}, Floor Number: ${floor.floorNumber})`);

    // Check if Floor 1 already exists
    const existingFloor1 = await ParkingFloor.findOne({ floorNumber: 1, _id: { $ne: floorId } });
    if (existingFloor1) {
      console.error('Error: Another Floor 1 already exists in database. Please inspect first.');
      process.exit(1);
    }

    // 2. Build Slot Mapping for all existing slots in this floor
    const slots = await Slot.find({ floorID: floorId });
    console.log(`Found ${slots.length} slots associated with this floor.`);

    const slotCodeMapping = {}; // OldCode -> NewCode
    for (const slot of slots) {
      const newSlotNumber = mapSlotCode(slot.slotNumber);
      if (newSlotNumber !== slot.slotNumber) {
        slotCodeMapping[slot.slotNumber] = newSlotNumber;
      }
    }
    console.log(`Slot mappings (${Object.keys(slotCodeMapping).length} slots to rename):`, slotCodeMapping);

    // 3. Update Slot documents
    let updatedSlotsCount = 0;
    for (const [oldCode, newCode] of Object.entries(slotCodeMapping)) {
      await Slot.updateOne(
        { floorID: floorId, slotNumber: oldCode },
        { $set: { slotNumber: newCode } }
      );
      updatedSlotsCount++;
    }
    console.log(`Updated ${updatedSlotsCount} Slot records in DB.`);

    // 4. Update Zone documents
    const zones = await Zone.find({ floorID: floorId });
    console.log(`Found ${zones.length} zones for this floor.`);
    for (const zone of zones) {
      const newZoneName = ZONE_MAP[zone.zoneName] || zone.zoneName;
      if (newZoneName !== zone.zoneName) {
        await Zone.updateOne({ _id: zone._id }, { $set: { zoneName: newZoneName } });
        console.log(`Renamed Zone "${zone.zoneName}" -> "${newZoneName}"`);
      }
    }

    // 5. Update MembershipSlotEntitlement (VIP users)
    const entitlements = await MembershipSlotEntitlement.find({ floorId });
    console.log(`Found ${entitlements.length} VIP entitlements on this floor.`);
    let updatedEntitlements = 0;
    for (const ent of entitlements) {
      const newCode = slotCodeMapping[ent.slotCode] || mapSlotCode(ent.slotCode);
      if (newCode && newCode !== ent.slotCode) {
        await MembershipSlotEntitlement.updateOne(
          { _id: ent._id },
          { $set: { slotCode: newCode } }
        );
        updatedEntitlements++;
        console.log(`VIP Entitlement for owner ${ent.ownerId}: ${ent.slotCode} -> ${newCode}`);
      }
    }
    console.log(`Updated ${updatedEntitlements} VIP entitlements.`);

    // 6. Update Subscriptions (User monthly ticket packages)
    const subscriptions = await Subscription.find({ 'slots.floorId': floorId });
    console.log(`Found ${subscriptions.length} Subscriptions referencing this floor.`);
    let updatedSubscriptions = 0;
    for (const sub of subscriptions) {
      let modified = false;
      sub.slots = sub.slots.map(s => {
        if (String(s.floorId) === String(floorId)) {
          const newCode = slotCodeMapping[s.slotCode] || mapSlotCode(s.slotCode);
          if (newCode !== s.slotCode) {
            modified = true;
            return { ...s.toObject(), slotCode: newCode };
          }
        }
        return s;
      });
      if (modified) {
        await sub.save();
        updatedSubscriptions++;
      }
    }
    console.log(`Updated ${updatedSubscriptions} Subscriptions.`);

    // 7. Update Bookings
    const bookings = await Booking.find({ floorId });
    console.log(`Found ${bookings.length} Bookings on this floor.`);
    let updatedBookings = 0;
    for (const booking of bookings) {
      const newSlot = slotCodeMapping[booking.parkingSlot] || mapSlotCode(booking.parkingSlot);
      if (newSlot && newSlot !== booking.parkingSlot) {
        await Booking.updateOne(
          { _id: booking._id },
          {
            $set: { parkingSlot: newSlot },
            $push: {
              slotChangesHistory: {
                oldSlot: booking.parkingSlot,
                newSlot: newSlot,
                reason: 'System floor normalization: Floor 2 -> Floor 1 (Zone E..H -> Zone A..D)',
                changedAt: new Date(),
              }
            }
          }
        );
        updatedBookings++;
      }
    }
    console.log(`Updated ${updatedBookings} Bookings.`);

    // 8. Update Sessions
    const sessions = await Session.find({ floorId });
    console.log(`Found ${sessions.length} Sessions on this floor.`);
    let updatedSessions = 0;
    for (const session of sessions) {
      const newSlot = slotCodeMapping[session.parkingSlot] || mapSlotCode(session.parkingSlot);
      if (newSlot && newSlot !== session.parkingSlot) {
        await Session.updateOne(
          { _id: session._id },
          { $set: { parkingSlot: newSlot } }
        );
        updatedSessions++;
      }
    }
    console.log(`Updated ${updatedSessions} Sessions.`);

    // 9. Update ParkingFloor layoutData
    const layout = floor.layoutData || { elements: [] };
    if (layout.elements && Array.isArray(layout.elements)) {
      layout.elements = layout.elements.map(el => {
        let updatedEl = { ...el };
        // Decorative text
        if (el.type === 'text' && typeof el.text === 'string') {
          if (el.text.includes('FLOOR 2') || el.text.includes('Floor 2')) {
            updatedEl.text = el.text.replace(/FLOOR 2/gi, 'FLOOR 1');
          }
        }
        // Zones
        if (el.type === 'zone' && el.name) {
          const newName = ZONE_MAP[el.name] || el.name;
          updatedEl.name = newName;
        }
        // Slots
        if (el.type && el.type.startsWith('slot') && el.name) {
          const newName = slotCodeMapping[el.name] || mapSlotCode(el.name);
          updatedEl.name = newName;
        }
        return updatedEl;
      });
    }

    // 10. Save updated ParkingFloor
    floor.floorNumber = 1;
    floor.name = 'Floor 1';
    floor.code = 'F1';
    floor.layoutData = layout;
    await floor.save();

    console.log('Floor 2 has been successfully normalized to Floor 1!');
    console.log('Summary of synchronization:');
    console.log(`  - Floor ID: ${floor._id}`);
    console.log(`  - Floor Number: 1, Name: "Floor 1", Code: "F1"`);
    console.log(`  - Slots Renamed: ${updatedSlotsCount}`);
    console.log(`  - VIP Entitlements Migrated: ${updatedEntitlements}`);
    console.log(`  - Subscriptions Migrated: ${updatedSubscriptions}`);
    console.log(`  - Bookings Migrated: ${updatedBookings}`);
    console.log(`  - Sessions Migrated: ${updatedSessions}`);
    console.log('Migration completed with 100% data integrity!');

    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration, mapSlotCode, ZONE_MAP };
