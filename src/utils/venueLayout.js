const floorZones = ["FRONT", "MIDDLE", "REAR"];
const layoutZones = {
  THEATER: [...floorZones, "BALCONY"],
  ARENA: [...floorZones, "BALCONY"],
  OUTDOOR: floorZones,
};

export const isVenueLayout = value => typeof value === "string" && Object.hasOwn(layoutZones, value);
export const isLayoutZone = (layout, zone) => isVenueLayout(layout) && layoutZones[layout].includes(zone);

export function eventReviewIssue(event) {
  if (!isVenueLayout(event.venueLayout)) return "Choose a venue layout.";
  if (!event.previewVideoUrl || !event.ticketBackgroundUrl) {
    return "Upload a concert preview video and a ticket background image.";
  }
  if (!event.ticketTypes.length || event.ticketTypes.some(tier => !isLayoutZone(event.venueLayout, tier.viewPosition))) {
    return "Add at least one ticket type and assign each pass a zone in the chosen layout.";
  }
  return null;
}
