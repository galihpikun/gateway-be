import prisma from "../service/prisma";
import bcrypt from "bcrypt";

export const register = async (req, res) => {
  const { email, password, fullName } = req.body;

  try {
    if (!fullName || !email || !password) {
      return res.status(400).json({
        code: 400,
        message: "Belum diisi inputnya",
      });
    }

    const emailExists = await prisma.user.findUnique({
      where: { email },
    });

    if (emailExists) {
      return res.status(400).json({
        code: 400,
        success: false,
        message: "Email sudah terdaftar",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPw = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: {
        fullName,
        email,
        password: hashedPw,
      },
    });

    return res.status(201).json({
      code: 201,
      success: true,
      message: "Berhasil register",
      data: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      code: 400,
      message: "Belum diisi inputnya",
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(400).json({
        code: 400,
        success: false,
        message: "Email or password is incorrect",
      });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);

    if (!isPasswordCorrect) {
      return res.status(400).json({
        code: 400,
        success: false,
        message: "Email or password is incorrect",
      });
    }

    const token = generateToken(
      {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      res,
    );

    return res.status(200).json({
      code: 200,
      success: true,
      message: "Berhasil Login",
      data: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
};

export const logout = async (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  return res.status(200).json({
    code: 200,
    success: true,
    message: "Berhasil logout",
  });
};

export const getMe = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatar: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        code: 404,
        success: false,
        message: "User tidak ditemukan",
      });
    }

    return res.status(200).json({
      code: 200,
      success: true,
      message: "Berhasil mendapatkan data user",
      data: user,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
};

export const updateMe = async (req, res) => {
  const userId = req.user.id;
  const { fullName, email, avatar } = req.body;

  if (!fullName || !email) {
    return res.status(400).json({
      code: 400,
      message: "Nama lengkap dan email wajib diisi",
    });
  }

  try {
    const updatedUser = await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        fullName,
        email,
        ...(avatar && { avatar }),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatar: true,
        role: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      code: 200,
      success: true,
      message: "Berhasil update data user",
      data: updatedUser,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      code: 500,
      message: error.message,
    });
  }
};