import { PaginationError } from "./src/utils/paginate.js";
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import authRoutes from './src/routes/authRoutes.js';
import categoryRoutes from './src/routes/categoryRoutes.js';
import organizerRoutes from './src/routes/organizerRoutes.js';
import eventRoutes from './src/routes/eventRoutes.js';
import ticketTypeRoutes from './src/routes/ticketTypeRoutes.js';
import orderRoutes from './src/routes/orderRoutes.js';
import paymentRoutes from './src/routes/paymentRoutes.js';
import issuedTicketRoutes from './src/routes/issuedTicketRoutes.js';
import ticketRedemptionRoutes from './src/routes/ticketRedemptionRoutes.js';
import staffRoutes from './src/routes/staffRoutes.js';
import userRoutes from './src/routes/userRoutes.js';
import adminDashboardRoutes from './src/routes/adminDashboardRoutes.js';
import auditLogRoutes from './src/routes/auditLogRoutes.js';
import refundRoutes from './src/routes/refundRoutes.js';

import { fileURLToPath } from 'url';
import { expirePendingOrders } from './src/controllers/orderController.js';
import RefundService from './src/service/refundService.js';
import PaymentService from './src/service/paymentService.js';
import { processQueuedTicketEmails } from './src/service/ticketEmailService.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Idempotency-Key',
    'x-callback-token',
  ],
  exposedHeaders: ['Authorization'],
}));
app.use(express.json());
app.use(cookieParser());

app.get('/', (req, res) => {
  res.json({
    name: 'Gateway Backend API',
    status: 'online',
    version: '1.0.0',
  });
});

const registerRoutes = (router) => {
  router.use('/auth', authRoutes);
  router.use('/categories', categoryRoutes);
  router.use('/organizer', organizerRoutes);
  router.use('/events', eventRoutes);
  router.use('/ticket-types', ticketTypeRoutes);
  router.use('/orders', orderRoutes);
  router.use('/payments', paymentRoutes);
  router.use('/issued-tickets', issuedTicketRoutes);
  router.use('/ticket-redemption', ticketRedemptionRoutes);
  router.use('/staff', staffRoutes);
  router.use('/users', userRoutes);
  router.use('/admin/dashboard', adminDashboardRoutes);
  router.use('/audit-logs', auditLogRoutes);
  router.use('/refunds', refundRoutes);
};

// Mount routes at both /api prefix and root for full compatibility
const apiRouter = express.Router();
registerRoutes(apiRouter);
app.use('/api', apiRouter);

const rootRouter = express.Router();
registerRoutes(rootRouter);
app.use('/', rootRouter);

// Global Error Handler
app.use((err, req, res, next) => {
  if (err instanceof PaginationError) {
    return res.status(400).json({ statusCode: 400, message: err.message });
  }
  console.error('Unhandled error:', err);
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({
    statusCode: status,
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain && process.env.NODE_ENV !== 'test') {
  let ticketMailRunning = false;
  const deliverTicketMail = async () => {
    if (ticketMailRunning) return;
    ticketMailRunning = true;
    try {
      await processQueuedTicketEmails();
    } catch (error) {
      console.error("Ticket email queue failed:", error.code || error.name);
    } finally {
      ticketMailRunning = false;
    }
  };
  setInterval(deliverTicketMail, 5000).unref();
  void deliverTicketMail();
  let maintenanceRunning = false;
  const maintain = async () => {
    if (maintenanceRunning) return;
    maintenanceRunning = true;
    try {
      for (const task of [() => expirePendingOrders(), () => RefundService.processQueuedRefunds(), () => PaymentService.reconcilePayments()]) {
        try { await task(); } catch (error) { console.error("Maintenance failed:", error.message); }
      }
    } finally { maintenanceRunning = false; }
  };
  setInterval(maintain, 30000).unref();
  void maintain();
  app.listen(port, () => {
    console.log(`Gateway Backend running on port ${port}`);
  });
}

export default app;
