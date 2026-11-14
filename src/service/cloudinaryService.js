import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export class CloudinaryService {
  static async uploadImage(file, folder = "ticket-booking") {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
      // Mock fallback for test environment without active cloudinary credentials
      const mockId = `mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      return {
        secure_url: `https://res.cloudinary.com/mock/image/upload/${mockId}.jpg`,
        public_id: mockId,
      };
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",
        },
        (error, result) => {
          if (error) {
            return reject(error);
          }
          if (!result) {
            return reject(new Error("Cloudinary upload failed"));
          }
          resolve(result);
        }
      );

      uploadStream.end(file.buffer);
    });
  }
}

export default CloudinaryService;
