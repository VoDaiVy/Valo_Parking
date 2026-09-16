const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const errorHandler = require('./middlewares/errorHandler');
const { setupNotificationSocket } = require('./sockets/notificationSocket');
const { startScheduler } = require('./services/parkingScheduler');
const { seedRules } = require('./seeds/notificationRuleSeeder');

// Load env variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const ticketPackageRoutes = require('./routes/ticketPackageRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const policyRoutes = require('./routes/policyRoutes');

// Initialize express app
const app = express();
const httpServer = http.createServer(app);

// CORS configuration
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);

// Body parser
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

// Cookie parser
app.use(cookieParser());

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'VALO PARKING API is running',
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/wallet", require("./routes/walletRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));
app.use('/api/ai-copilot', require('./routes/aiCopilotRoutes'));
app.use("/api/vehicles", require("./routes/vehicleRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/policies", policyRoutes);
app.use('/api', serviceRoutes);
app.use('/api/ticket-packages', ticketPackageRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use("/api/staff", require("./routes/staffRoutes"));
app.use("/api/sessions", require("./routes/sessionRoutes"));
app.use("/api/parking-floors", require("./routes/parkingFloorRoutes"));
app.use("/api/maintenance", require("./routes/maintenanceRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/bookings", require("./routes/bookingRoutes"));
app.use("/api/qr", require("./routes/qrRoutes"));
app.use("/api/violations", require("./routes/violationRoutes"));
app.use("/api/revenue", require("./routes/revenueRoutes"));
app.use("/api/statistics", require("./routes/statisticsRoutes"));
app.use("/api/iot", require("./routes/iotRoutes").router);
app.use("/api", require("./routes/bookingTransferRoutes"));
app.use("/api", require("./routes/membershipEntitlementTransferRoutes"));
app.use("/api", require("./routes/contractRoutes"));

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Global error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5001;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Setup Socket.IO
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const io = new Server(httpServer, {
      cors: {
        origin: clientUrl,
        credentials: true,
      },
    });

    // Attach io to app so controllers/services can access it
    app.set('io', io);

    // Setup notification socket handlers
    const { onlineUsers } = setupNotificationSocket(io);
    app.set('onlineUsers', onlineUsers);

    httpServer.listen(PORT, () => {
      console.log(`🚀 VALO PARKING API Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🔌 Socket.IO ready`);

      // Start parking session scheduler
      startScheduler(app);
      require('./services/aiCopilot/monitor').startMonitor(app);
      require('./services/aiCopilot/floorFullMonitor').startFloorMonitor(app);
      require('./services/aiCopilot/refundCompletedMonitor').startRefundMonitor(app);

      // Seed default notification rules (upsert, won't overwrite existing)
      seedRules().catch(err => {
        console.error('⚠️ Auto-seed notification rules failed:', err.message);
      });
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
// Forced restart for nodemon
