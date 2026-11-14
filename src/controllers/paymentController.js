import PaymentService from "../service/paymentService.js";

export const handleWebhook = async (req, res) => {
  const token = req.headers["x-callback-token"];
  try {
    const result = await PaymentService.handleWebhook(token, req.body);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ statusCode, message: error.message });
  }
};
