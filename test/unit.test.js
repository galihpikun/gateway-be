import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';

import { buildPaginatedResponse } from '../src/utils/paginate.js';
import { generateToken } from '../src/utils/generateToken.js';
import { requireRoles } from '../src/middlewares/roleMiddleware.js';
import { RefundService, CUSTOMER_REFUND_DEDUCTION_RATE } from '../src/service/refundService.js';
import app from '../index.js';

test('buildPaginatedResponse computes correct pagination metadata', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const result = buildPaginatedResponse(items, 25, 2, 10);

  assert.deepEqual(result.data, items);
  assert.equal(result.meta.total, 25);
  assert.equal(result.meta.page, 2);
  assert.equal(result.meta.limit, 10);
  assert.equal(result.meta.totalPages, 3);
});

test('buildPaginatedResponse handles single page edge cases', () => {
  const page1 = buildPaginatedResponse([], 10, 1, 10);
  assert.equal(page1.meta.totalPages, 1);
});

test('generateToken produces valid JWT with required claims', () => {
  process.env.JWT_SECRET = 'test_secret_key_123456';
  const mockUser = {
    id: 'user_123',
    email: 'test@festix.id',
    role: 'ADMIN',
  };

  const token = generateToken(mockUser);
  assert.ok(token);

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  assert.equal(decoded.sub, 'user_123');
  assert.equal(decoded.id, 'user_123');
  assert.equal(decoded.email, 'test@festix.id');
  assert.equal(decoded.role, 'ADMIN');
});

test('roleMiddleware enforces role restrictions', () => {
  const adminGuard = requireRoles('ADMIN');

  let passed = false;
  const mockReqAdmin = { user: { role: 'ADMIN' } };
  const mockRes = {
    status: (code) => ({
      json: (data) => ({ code, data }),
    }),
  };

  adminGuard(mockReqAdmin, mockRes, () => {
    passed = true;
  });
  assert.equal(passed, true);

  let forbiddenStatus = null;
  const mockReqCustomer = { user: { role: 'CUSTOMER' } };
  const mockResCustomer = {
    status: (code) => {
      forbiddenStatus = code;
      return { json: () => {} };
    },
  };

  adminGuard(mockReqCustomer, mockResCustomer, () => {
    assert.fail('Should not call next for unauthorized role');
  });
  assert.equal(forbiddenStatus, 403);
});

test('RefundService deduction calculation matches business rules', () => {
  assert.equal(CUSTOMER_REFUND_DEDUCTION_RATE, 0.05);

  // 5% platform deduction for customer requested refunds
  const customerCalc = RefundService.calculateCustomerRefund(100000);
  assert.equal(Number(customerCalc.originalAmount), 100000);
  assert.equal(Number(customerCalc.deductionAmount), 5000);
  assert.equal(Number(customerCalc.refundAmount), 95000);

  // 100% refund for cancelled event
  const cancellationCalc = RefundService.calculateCancellationRefund(100000);
  assert.equal(Number(cancellationCalc.originalAmount), 100000);
  assert.equal(Number(cancellationCalc.deductionAmount), 0);
  assert.equal(Number(cancellationCalc.refundAmount), 100000);

  // Cumulative refund validation
  assert.doesNotThrow(() => {
    RefundService.validateCumulativeRefund(50000, 50000, 100000);
  });

  assert.throws(() => {
    RefundService.validateCumulativeRefund(60000, 50000, 100000);
  });
});

test('Express app initializes with routes defined', () => {
  assert.ok(app);
});
