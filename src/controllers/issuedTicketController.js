import IssuedTicketService from "../service/issuedTicketService.js";

export const getMyTickets = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  try {
    const result = await IssuedTicketService.getMyTickets(userId, req.query);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ statusCode, message: error.message });
  }
};

export const getTicketDetail = async (req, res) => {
  const userId = req.user?.userId || req.user?.id;
  const { id } = req.params;
  try {
    const result = await IssuedTicketService.getTicketDetail(userId, id);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ statusCode, message: error.message });
  }
};

export const getAdminTickets = async (req, res) => {
  try {
    const result = await IssuedTicketService.getAdminTickets(req.query);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ statusCode, message: error.message });
  }
};

export const getAdminTicketDetail = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await IssuedTicketService.getAdminTicketDetail(id);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ statusCode, message: error.message });
  }
};
