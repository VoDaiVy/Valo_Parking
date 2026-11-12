const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, { autoIndex: process.env.MONGODB_AUTO_INDEX === 'true' || (process.env.MONGODB_AUTO_INDEX !== 'false' && process.env.NODE_ENV !== 'production') });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
