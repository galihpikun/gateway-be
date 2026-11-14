import prisma from "../service/prisma.js";
import AuditLogService from "../service/auditLogService.js";
import slugify from "slugify";

export const getCategories = async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        _count: {
          select: { events: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const result = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      eventCount: cat._count.events,
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt,
    }));

    return res.status(200).json(result);
  } catch (error) {
    console.error("Get categories error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const createCategory = async (req, res) => {
  const { name } = req.body;
  const actorId = req.user?.userId || req.user?.id;

  if (!name || !name.trim()) {
    return res.status(400).json({
      statusCode: 400,
      message: "Category name is required",
    });
  }

  const slugName = slugify(name, { lower: true, strict: true });

  try {
    const category = await prisma.$transaction(async (tx) => {
      const cat = await tx.category.create({
        data: {
          name: name.trim(),
          slug: slugName,
        },
      });

      await AuditLogService.log(
        actorId ?? null,
        "CREATE",
        "Category",
        cat.id,
        { name: cat.name, slug: cat.slug },
        tx
      );

      return cat;
    });

    return res.status(201).json({
      message: "Category created successfully",
      data: category,
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        statusCode: 409,
        message: "Category with this name or slug already exists",
      });
    }
    console.error("Create category error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const editCategory = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const actorId = req.user?.userId || req.user?.id;

  if (!name || !name.trim()) {
    return res.status(400).json({
      statusCode: 400,
      message: "Category name is required",
    });
  }

  try {
    const existing = await prisma.category.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        statusCode: 404,
        message: "Category not found",
      });
    }

    const slugName = slugify(name, { lower: true, strict: true });

    const category = await prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id },
        data: {
          name: name.trim(),
          slug: slugName,
        },
      });

      await AuditLogService.log(
        actorId ?? null,
        "UPDATE",
        "Category",
        id,
        {
          before: { name: existing.name, slug: existing.slug },
          after: { name: updated.name, slug: updated.slug },
        },
        tx
      );

      return updated;
    });

    return res.status(200).json({
      message: "Category successfully updated",
      data: category,
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        statusCode: 409,
        message: "Category with this name or slug already exists",
      });
    }
    console.error("Edit category error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};

export const deleteCategory = async (req, res) => {
  const { id } = req.params;
  const actorId = req.user?.userId || req.user?.id;

  try {
    const catExist = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { events: true },
        },
      },
    });

    if (!catExist) {
      return res.status(404).json({
        statusCode: 404,
        message: "Category not found",
      });
    }

    if (catExist._count.events > 0) {
      return res.status(409).json({
        statusCode: 409,
        message: `Cannot delete category. It is referenced by ${catExist._count.events} event(s).`,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.category.delete({
        where: { id },
      });

      await AuditLogService.log(
        actorId ?? null,
        "DELETE",
        "Category",
        id,
        { name: catExist.name, slug: catExist.slug },
        tx
      );
    });

    return res.status(200).json({
      message: "Category successfully deleted",
    });
  } catch (error) {
    console.error("Delete category error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: error.message,
    });
  }
};
