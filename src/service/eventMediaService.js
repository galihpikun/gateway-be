import prisma from "./prisma.js";
import CloudinaryService from "./cloudinaryService.js";

const eventMedia = [
  { fileKey: "coverImage", idKey: "coverImageId", resourceType: "image" },
  { fileKey: "venueImage", idKey: "venueImageId", resourceType: "image" },
  { fileKey: "previewVideo", idKey: "previewVideoId", resourceType: "video" },
  { fileKey: "ticketBackground", idKey: "ticketBackgroundId", resourceType: "image" },
];

export async function uploadEventMedia(files, uploaded) {
  const results = await Promise.allSettled(eventMedia.map(async ({ fileKey, resourceType }) => {
    const file = files[fileKey];
    if (!file) return null;
    const asset = resourceType === "video"
      ? await CloudinaryService.uploadVideo(file)
      : await CloudinaryService.uploadImage(file);
    uploaded.push({ publicId: asset.public_id, resourceType });
    return asset;
  }));
  const failure = results.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
  return results.map(result => result.value);
}

export function replacedEventMedia(before, after) {
  return eventMedia
    .filter(({ idKey }) => before[idKey] && before[idKey] !== after[idKey])
    .map(({ idKey, resourceType }) => ({ publicId: before[idKey], resourceType }));
}

export async function removeUnreferencedEventMedia(assets) {
  const unique = new Map();
  for (const asset of assets) {
    if (asset.publicId) unique.set(asset.resourceType + ":" + asset.publicId, asset);
  }
  for (const { publicId, resourceType } of unique.values()) {
    try {
      const event = await prisma.event.findFirst({
        where: { OR: eventMedia.map(({ idKey }) => ({ [idKey]: publicId })) },
        select: { id: true },
      });
      if (event) continue;
      const document = await prisma.organizerDocument.findFirst({
        where: { publicId },
        select: { id: true },
      });
      if (document) continue;
      const avatar = await prisma.user.findFirst({
        where: { OR: [
          { avatar: { contains: publicId } },
          { avatar: { contains: publicId.split("/").map(encodeURIComponent).join("/") } },
        ] },
        select: { id: true },
      });
      if (avatar) continue;
      await CloudinaryService.deleteMedia(publicId, resourceType);
    } catch (error) {
      console.warn("Event media cleanup failed", { publicId, resourceType, error: error.code || error.name });
    }
  }
}
