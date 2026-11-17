# Concert previews and viewing zones

This repository currently uses an existing database without a Prisma migration history. Apply the additive change once to existing databases:

```
npx prisma db execute --file prisma/changes/20261118_concert_previews.sql
npx prisma generate
```

Fresh databases can use the current Prisma schema. Restart the API after generating the client. No new environment variables are needed: video uploads use the existing Cloudinary account. Organizer previews accept MP4/WebM up to 25 MB; cover/venue images remain limited to 5 MB. Uploaded replacement/removal only changes the active URL; old Cloudinary assets are retained.

Viewing zones are optional, organizer-defined FRONT/MIDDLE/REAR/BALCONY values on ticket types. They may be configured on draft/rejected events. Existing passes remain unassigned; public illustrative exploration is explicitly labeled and never assigns seats or changes inventory.
