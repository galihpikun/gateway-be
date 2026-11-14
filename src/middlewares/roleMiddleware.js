export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        statusCode: 401,
        message: "Unauthorized",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        statusCode: 403,
        message: "You do not have permission to access this resource",
      });
    }

    next();
  };
}

export const requireAdmin = requireRoles("ADMIN");
export const requireStaff = requireRoles("STAFF");
export const requireAdminOrStaff = requireRoles("ADMIN", "STAFF");

export default { requireRoles, requireAdmin, requireStaff, requireAdminOrStaff };
