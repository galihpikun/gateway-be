# Concert previews and viewing zones

This repository currently uses an existing database without a Prisma migration history. Apply the additive change once to existing databases:

```
npx prisma db execute --file prisma/changes/20261118_concert_previews.sql
npx prisma generate
```

Fresh databases can use the current Prisma schema. Restart the API after generating the client. No new environment variables are needed: video uploads use the existing Cloudinary account. Organizer previews accept MP4/WebM up to 25 MB; cover/venue images remain limited to 5 MB. Uploaded replacement/removal only changes the active URL; old Cloudinary assets are retained.

Viewing zones are optional, organizer-defined FRONT/MIDDLE/REAR/BALCONY values on ticket types. They may be configured on draft/rejected events. Existing passes remain unassigned; public illustrative exploration is explicitly labeled and never assigns seats or changes inventory.

# Venue layouts and e-ticket backgrounds

After the earlier preview SQL, run `npx prisma db execute --file prisma/changes/20261119_venue_layout.sql`
and `npx prisma generate`, then restart the API. Existing published events retain their data. New
events require a layout (THEATER, ARENA, or OUTDOOR), a preview video, e-ticket artwork, and
a compatible zone on every pass. Existing drafts and rejected events must supply the same
information before review. For an older event already pending review, reject it with instructions
to complete its setup before resubmission. OUTDOOR has no BALCONY zone. The optional venue
image remains available for the organizer's official plan.

# Checkout contacts and ticket email

Apply `npx prisma db execute --file prisma/changes/20261119_checkout_contact.sql` and
`npx prisma generate` before starting the new API. Existing orders remain usable. New orders
save their own contact details and only the last four characters of the submitted identity number.
After payment is confirmed and usable tickets are issued, the API queues an email to the checkout
address using the existing RESEND_API_KEY and RESEND_FROM_EMAIL. Delivery failures are retried
independently of payment or ticket issuance. Existing orders without checkout contact data are
not backfilled.
