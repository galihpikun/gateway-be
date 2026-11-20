import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export class CloudinaryService {
  static async uploadVideo(file) { return this.uploadImage(file, "ticket-booking/previews", "video"); }
  static async uploadOrganizerDocument(file) {
    return this.uploadImage(file, "ticket-booking/organizer-documents", "image", "authenticated");
  }

  static organizerDocumentUrl(document) {
    const path = new URL(document.fileUrl, "https://legacy.invalid").pathname;
    const deliveryType = path.match(/\/image\/(authenticated|private)\//)?.[1];
    if (!deliveryType) return document.fileUrl;
    const format = path.match(/\.([a-z0-9]+)$/i)?.[1];
    if (!format) throw new Error("Organizer document format is unavailable");
    return cloudinary.utils.private_download_url(document.publicId, format, {
      type: deliveryType,
      resource_type: "image",
      expires_at: Math.floor(Date.now() / 1000) + 600,
    });
  }

  static async uploadImage(file, folder = "ticket-booking", resourceType = "image", deliveryType) {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) throw new Error("Cloudinary credentials are required");

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: resourceType,
          ...(deliveryType && { type: deliveryType }),
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
