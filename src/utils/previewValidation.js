export const viewPositions = ["FRONT", "MIDDLE", "REAR", "BALCONY"];
export const validViewPosition = value => value == null || value === "" || viewPositions.includes(value);
export function validPreviewVideo(file) {
 if (!file) return true;
 const mp4 = file.mimetype === "video/mp4" && file.buffer?.toString("ascii", 4, 8) === "ftyp";
 const webm = file.mimetype === "video/webm" && file.buffer?.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
 return file.size <= 25 * 1024 * 1024 && (mp4 || webm);
}

export function validTicketBackground(file) {
  if (!file) return true;
  const { buffer, mimetype, size } = file;
  if (!buffer || size > 5 * 1024 * 1024) return false;
  const jpeg = mimetype === "image/jpeg" && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const png = mimetype === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = mimetype === "image/webp" && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return jpeg || png || webp;
}
