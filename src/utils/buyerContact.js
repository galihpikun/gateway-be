const identityTypes = new Set(["KTP", "NPWP", "STUDENT_CARD", "SIM", "PASSPORT", "KITAS", "OTHER"]);
const field = (value) => typeof value === "string" ? value.trim() : "";

export function parseBuyerContact(buyer) {
  const fullName = field(buyer?.fullName).replace(/\s+/g, " ");
  const email = field(buyer?.email).toLowerCase();
  const phone = field(buyer?.phone).replace(/[\s().-]/g, "");
  const identityType = field(buyer?.identityType);
  const identity = field(buyer?.identityNumber).toUpperCase().replace(/[ .-]/g, "");

  if (fullName.length < 2 || fullName.length > 120) return { error: "Enter a valid buyer name." };
  if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) {
    return { error: "Enter a valid email address for your tickets." };
  }
  if (!/^\+?\d{8,15}$/.test(phone)) return { error: "Enter a valid phone number (8 to 15 digits)." };

  let validIdentity = /^[A-Z0-9]{4,32}$/.test(identity);
  if (identityType === "KTP") validIdentity = /^\d{16}$/.test(identity);
  if (identityType === "NPWP") validIdentity = /^\d{15,16}$/.test(identity);
  if (!identityTypes.has(identityType) || !validIdentity) {
    return { error: "Choose an identity type and enter a valid identity number." };
  }

  return { contact: {
    fullName, email, phone, identityType,
    identityLastFour: identity.slice(-4),
    language: buyer.language === "en" ? "en" : "id",
  } };
}
