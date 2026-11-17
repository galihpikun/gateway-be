export const viewPositions = ["FRONT", "MIDDLE", "REAR", "BALCONY"];
export const validViewPosition = value => value == null || value === "" || viewPositions.includes(value);
export function validPreviewVideo(file) {
 if (!file) return true;
 const mp4 = file.mimetype === "video/mp4" && file.buffer?.toString("ascii", 4, 8) === "ftyp";
 const webm = file.mimetype === "video/webm" && file.buffer?.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
 return file.size <= 25 * 1024 * 1024 && (mp4 || webm);
}
