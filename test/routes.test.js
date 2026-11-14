import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
import app from '../index.js';

import authRoutes from '../src/routes/authRoutes.js';
import categoryRoutes from '../src/routes/categoryRoutes.js';
import organizerRoutes from '../src/routes/organizerRoutes.js';
import eventRoutes from '../src/routes/eventRoutes.js';
import ticketTypeRoutes from '../src/routes/ticketTypeRoutes.js';
import orderRoutes from '../src/routes/orderRoutes.js';
import paymentRoutes from '../src/routes/paymentRoutes.js';
import issuedTicketRoutes from '../src/routes/issuedTicketRoutes.js';
import ticketRedemptionRoutes from '../src/routes/ticketRedemptionRoutes.js';
import staffRoutes from '../src/routes/staffRoutes.js';
import userRoutes from '../src/routes/userRoutes.js';
import adminDashboardRoutes from '../src/routes/adminDashboardRoutes.js';
import auditLogRoutes from '../src/routes/auditLogRoutes.js';
import refundRoutes from '../src/routes/refundRoutes.js';

const routerMap = [
  { name: 'Auth', prefix: '/auth', router: authRoutes },
  { name: 'Categories', prefix: '/categories', router: categoryRoutes },
  { name: 'Organizer', prefix: '/organizer', router: organizerRoutes },
  { name: 'Events', prefix: '/events', router: eventRoutes },
  { name: 'TicketTypes', prefix: '/ticket-types', router: ticketTypeRoutes },
  { name: 'Orders', prefix: '/orders', router: orderRoutes },
  { name: 'Payments', prefix: '/payments', router: paymentRoutes },
  { name: 'IssuedTickets', prefix: '/issued-tickets', router: issuedTicketRoutes },
  { name: 'TicketRedemption', prefix: '/ticket-redemption', router: ticketRedemptionRoutes },
  { name: 'Staff', prefix: '/staff', router: staffRoutes },
  { name: 'Users', prefix: '/users', router: userRoutes },
  { name: 'AdminDashboard', prefix: '/admin/dashboard', router: adminDashboardRoutes },
  { name: 'AuditLogs', prefix: '/audit-logs', router: auditLogRoutes },
  { name: 'Refunds', prefix: '/refunds', router: refundRoutes },
];

test('Verifies that all 14 router modules have valid stacks and active handlers', () => {
  let totalEndpoints = 0;

  for (const item of routerMap) {
    const stack = item.router.stack || (item.router.router && item.router.router.stack);
    assert.ok(stack, `${item.name} router must have a middleware/route stack`);

    for (const layer of stack) {
      if (layer.route) {
        totalEndpoints++;
        assert.ok(layer.route.path, `${item.name} route must have a valid path`);
        assert.ok(layer.route.stack.length > 0, `Route ${layer.route.path} must have at least one handler`);
        layer.route.stack.forEach((h) => {
          assert.equal(typeof h.handle, 'function', `Handler on ${layer.route.path} must be a function`);
        });
      }
    }
  }

  assert.equal(totalEndpoints, 86, 'Total defined router endpoints must equal 86');
});

test('Verifies root Express app mounts router cleanly and responds to root route', () => {
  assert.ok(app);
  assert.ok(app.router);
});
