import RefundService from "../service/refundService.js";

export const createRefund = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  try {
    const result = await RefundService.createCustomerRefund(userId, req.body);
    return res.status(201).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      statusCode,
      message: error.message,
    });
  }
};

export const getMyRefunds = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  try {
    const result = await RefundService.getCustomerRefunds(userId, req.query);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      statusCode,
      message: error.message,
    });
  }
};

export const getRefundDetail = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const { id } = req.params;
  try {
    const result = await RefundService.getCustomerRefundDetail(userId, id);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      statusCode,
      message: error.message,
    });
  }
};

// Admin controller actions
export const getAdminRefunds = async (req, res) => {
  try {
    const result = await RefundService.getAdminRefunds(req.query);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      statusCode,
      message: error.message,
    });
  }
};

export const getAdminRefundDetail = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await RefundService.getAdminRefundDetail(id);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      statusCode,
      message: error.message,
    });
  }
};

export const approveRefund = async (req, res) => {
  const adminId = req.user?.userId || req.user?.id;
  const { id } = req.params;
  try {
    const result = await RefundService.approveRefund(adminId, id);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      statusCode,
      message: error.message,
    });
  }
};

export const rejectRefund = async (req, res) => {
  const adminId = req.user?.userId || req.user?.id;
  const { id } = req.params;
  try {
    const result = await RefundService.rejectRefund(adminId, id, req.body);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      statusCode,
      message: error.message,
    });
  }
};

// Webhook controller action
export const handleRefundWebhook = async (req, res) => {
  const token = req.headers["x-callback-token"];
  try {
    const result = await RefundService.handleWebhook(token, req.body);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      statusCode,
      message: error.message,
    });
  }
};
