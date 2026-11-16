import "dotenv/config";
import bcrypt from "bcrypt";
import prisma from "../src/service/prisma.js";

async function main() {
  console.log("🌱 Starting idempotent database seeding for Festix...");

  const defaultPasswordHash = await bcrypt.hash("Password123!", 10);

  // ==========================================
  // 1. PRE-VERIFIED TEST ACCOUNTS
  // ==========================================
  console.log("👤 Seeding multi-role test users...");

  // 1.1 Administrator
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@festix.id" },
    update: {
      fullName: "System Administrator",
      role: "ADMIN",
      emailVerified: true,
      isSuspended: false,
    },
    create: {
      email: "admin@festix.id",
      fullName: "System Administrator",
      password: defaultPasswordHash,
      role: "ADMIN",
      emailVerified: true,
      isSuspended: false,
    },
  });

  // 1.2 Approved Organizer
  const approvedOrgUser = await prisma.user.upsert({
    where: { email: "organizer@festix.id" },
    update: {
      fullName: "Festival Harmoni Nusantara",
      role: "USER",
      emailVerified: true,
      isSuspended: false,
    },
    create: {
      email: "organizer@festix.id",
      fullName: "Festival Harmoni Nusantara",
      password: defaultPasswordHash,
      role: "USER",
      emailVerified: true,
      isSuspended: false,
    },
  });

  const approvedProfile = await prisma.organizerProfile.upsert({
    where: { userId: approvedOrgUser.id },
    update: {
      organizationName: "PT Harmoni Kreasi Nusantara",
      phoneNumber: "+6281234567890",
      address: "Jl. Senopati No. 45, Kebayoran Baru, Jakarta Selatan",
      identityCardNumber: "3171012345670001",
      bankName: "Bank Central Asia (BCA)",
      bankAccountNumber: "8830192847",
      bankAccountName: "PT Harmoni Kreasi Nusantara",
      status: "APPROVED",
      rejectionReason: null,
    },
    create: {
      userId: approvedOrgUser.id,
      organizationName: "PT Harmoni Kreasi Nusantara",
      phoneNumber: "+6281234567890",
      address: "Jl. Senopati No. 45, Kebayoran Baru, Jakarta Selatan",
      identityCardNumber: "3171012345670001",
      bankName: "Bank Central Asia (BCA)",
      bankAccountNumber: "8830192847",
      bankAccountName: "PT Harmoni Kreasi Nusantara",
      status: "APPROVED",
    },
  });

  // Approved Documents
  const docTypes = [
    { type: "BUSINESS_LICENSE", publicId: "docs/biz_license_01" },
    { type: "GUARANTEE_LETTER", publicId: "docs/guarantee_01" },
    { type: "ORGANIZATION_REGISTRATION", publicId: "docs/org_reg_01" },
    { type: "IDENTITY_CARD", publicId: "docs/ktp_01" },
  ];

  for (const doc of docTypes) {
    await prisma.organizerDocument.upsert({
      where: {
        organizerId_type: {
          organizerId: approvedProfile.id,
          type: doc.type,
        },
      },
      update: {
        status: "APPROVED",
        fileUrl: `https://images.unsplash.com/photo-1568992687947-868a62a9f521?auto=format&fit=crop&w=800&q=80`,
        publicId: doc.publicId,
        rejectionReason: null,
      },
      create: {
        organizerId: approvedProfile.id,
        type: doc.type,
        status: "APPROVED",
        fileUrl: `https://images.unsplash.com/photo-1568992687947-868a62a9f521?auto=format&fit=crop&w=800&q=80`,
        publicId: doc.publicId,
      },
    });
  }

  // 1.3 Pending Organizer (for Admin KYC moderation testing)
  const pendingOrgUser = await prisma.user.upsert({
    where: { email: "pending.org@festix.id" },
    update: {
      fullName: "Bumi Nada Kreasi",
      role: "USER",
      emailVerified: true,
      isSuspended: false,
    },
    create: {
      email: "pending.org@festix.id",
      fullName: "Bumi Nada Kreasi",
      password: defaultPasswordHash,
      role: "USER",
      emailVerified: true,
      isSuspended: false,
    },
  });

  const pendingProfile = await prisma.organizerProfile.upsert({
    where: { userId: pendingOrgUser.id },
    update: {
      organizationName: "CV Nada Kreasi Nusantara",
      phoneNumber: "+6281987654321",
      address: "Jl. Riau No. 88, Bandung, Jawa Barat",
      identityCardNumber: "3273012345670002",
      bankName: "Bank Mandiri",
      bankAccountNumber: "1310098765432",
      bankAccountName: "CV Nada Kreasi Nusantara",
      status: "PENDING",
      rejectionReason: null,
    },
    create: {
      userId: pendingOrgUser.id,
      organizationName: "CV Nada Kreasi Nusantara",
      phoneNumber: "+6281987654321",
      address: "Jl. Riau No. 88, Bandung, Jawa Barat",
      identityCardNumber: "3273012345670002",
      bankName: "Bank Mandiri",
      bankAccountNumber: "1310098765432",
      bankAccountName: "CV Nada Kreasi Nusantara",
      status: "PENDING",
    },
  });

  const pendingDocTypes = [
    { type: "BUSINESS_LICENSE", publicId: "docs/biz_license_pending" },
    { type: "GUARANTEE_LETTER", publicId: "docs/guarantee_pending" },
    { type: "ORGANIZATION_REGISTRATION", publicId: "docs/org_reg_pending" },
    { type: "IDENTITY_CARD", publicId: "docs/ktp_pending" },
  ];

  for (const doc of pendingDocTypes) {
    await prisma.organizerDocument.upsert({
      where: {
        organizerId_type: {
          organizerId: pendingProfile.id,
          type: doc.type,
        },
      },
      update: {
        status: "PENDING",
        fileUrl: `https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=800&q=80`,
        publicId: doc.publicId,
        rejectionReason: null,
      },
      create: {
        organizerId: pendingProfile.id,
        type: doc.type,
        status: "PENDING",
        fileUrl: `https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=800&q=80`,
        publicId: doc.publicId,
      },
    });
  }

  // 1.4 Gate Check-In Staff
  const staffUser = await prisma.user.upsert({
    where: { email: "staff@festix.id" },
    update: {
      fullName: "Rian Adiputra (Field Operations)",
      role: "STAFF",
      emailVerified: true,
      isSuspended: false,
    },
    create: {
      email: "staff@festix.id",
      fullName: "Rian Adiputra (Field Operations)",
      password: defaultPasswordHash,
      role: "STAFF",
      emailVerified: true,
      isSuspended: false,
    },
  });

  // 1.5 Regular Attendee / Buyer
  const buyerUser = await prisma.user.upsert({
    where: { email: "buyer@festix.id" },
    update: {
      fullName: "Amira Dewanti",
      role: "USER",
      emailVerified: true,
      isSuspended: false,
    },
    create: {
      email: "buyer@festix.id",
      fullName: "Amira Dewanti",
      password: defaultPasswordHash,
      role: "USER",
      emailVerified: true,
      isSuspended: false,
    },
  });

  // ==========================================
  // 2. MUSIC CATEGORIES
  // ==========================================
  console.log("🏷️  Seeding music categories...");

  const categoriesData = [
    { name: "Indie & Alternative", slug: "indie-alternative" },
    { name: "Jazz & Soul", slug: "jazz-soul" },
    { name: "Electronic & Club", slug: "electronic-club" },
    { name: "Rock & Metal", slug: "rock-metal" },
    { name: "Music Festival", slug: "music-festival" },
  ];

  const categoryMap = {};
  for (const cat of categoriesData) {
    const record = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name },
      create: { name: cat.name, slug: cat.slug },
    });
    categoryMap[cat.slug] = record;
  }

  // ==========================================
  // 3. 6 CONCERT & FESTIVAL EVENTS
  // ==========================================
  console.log("🎸 Seeding concerts, festival events, and ticket tiers...");

  const eventsData = [
    // 1. Published Jazz & Soul Concert
    {
      title: "Amara Okafor: Kindred Album Tour Jakarta",
      slugKey: "amara-okafor-jakarta",
      categorySlug: "jazz-soul",
      location: "The Lantern Room, Tennis Indoor Senayan, Jakarta",
      startDatetime: new Date("2026-11-20T19:00:00+07:00"),
      endDatetime: new Date("2026-11-20T23:00:00+07:00"),
      description:
        "Archival tenor saxophone tour featuring new original arrangements and live quartet accompaniment. Full album performance with acoustic encore in an intimate acoustic shell.",
      coverImageUrl:
        "https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&w=1600&q=80",
      coverImageId: "events/amara_okafor_cover",
      venueImageUrl:
        "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80",
      venueImageId: "events/senayan_venue",
      status: "PUBLISHED",
      isRefundable: true,
      ticketTiers: [
        { name: "Early Bird Standing", price: 250000, quota: 100, availableQuota: 0 },
        { name: "General Admission", price: 450000, quota: 500, availableQuota: 342 },
        { name: "VIP Mezzanine Pass", price: 850000, quota: 50, availableQuota: 4 },
      ],
    },
    // 2. Published Music Festival
    {
      title: "Nusantara Soundwave Festival 2026",
      slugKey: "nusantara-soundwave-2026",
      categorySlug: "music-festival",
      location: "GWK Cultural Park, Badung, Bali",
      startDatetime: new Date("2026-12-18T14:00:00+08:00"),
      endDatetime: new Date("2026-12-20T23:59:00+08:00"),
      description:
        "Three-day outdoor sonic gathering celebrating Southeast Asian independent music, digital art installations, and collaborative live jam sessions under the monumental cliffs of Ungasan.",
      coverImageUrl:
        "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1600&q=80",
      coverImageId: "events/nusantara_soundwave_cover",
      venueImageUrl:
        "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1200&q=80",
      venueImageId: "events/gwk_venue",
      status: "PUBLISHED",
      isRefundable: true,
      ticketTiers: [
        { name: "Presale 3-Day Pass", price: 750000, quota: 200, availableQuota: 0 },
        { name: "Regular 3-Day Pass", price: 1250000, quota: 800, availableQuota: 415 },
        { name: "VIP Backstage & Soundcheck", price: 2500000, quota: 80, availableQuota: 3 },
      ],
    },
    // 3. Published Electronic & Club Event (Non-Refundable)
    {
      title: "Underground Concrete: Analog Club Night",
      slugKey: "underground-concrete-jakarta",
      categorySlug: "electronic-club",
      location: "Gudang Sarinah Ekosistem Hall B, Jakarta Selatan",
      startDatetime: new Date("2026-11-28T21:00:00+07:00"),
      endDatetime: new Date("2026-11-29T04:00:00+07:00"),
      description:
        "Hypnotic raw techno and modular synthesizer sets inside an industrial warehouse setting. Strictly no flash photography. Funktion-One sound system.",
      coverImageUrl:
        "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1600&q=80",
      coverImageId: "events/analog_club_cover",
      venueImageUrl:
        "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=80",
      venueImageId: "events/sarinah_venue",
      status: "PUBLISHED",
      isRefundable: false, // Testing non-refundable refund policies
      ticketTiers: [
        { name: "Early Entry (Before 22:30)", price: 180000, quota: 150, availableQuota: 0 },
        { name: "General Entry", price: 280000, quota: 400, availableQuota: 188 },
        { name: "Backstage Booth for Four", price: 1200000, quota: 20, availableQuota: 2 },
      ],
    },
    // 4. Published Indie & Alternative Concert
    {
      title: "Distorsi Priangan: Post-Rock & Shoegaze Summit",
      slugKey: "distorsi-priangan-bandung",
      categorySlug: "indie-alternative",
      location: "Eldorado Dome, Lembang, Bandung",
      startDatetime: new Date("2026-12-05T16:00:00+07:00"),
      endDatetime: new Date("2026-12-05T23:00:00+07:00"),
      description:
        "Massive guitar pedal symphonies, soaring crescendos, and visual projection mapping in the misty mountains of North Bandung. Featuring pioneering atmospheric rock collectives.",
      coverImageUrl:
        "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=1600&q=80",
      coverImageId: "events/distorsi_priangan_cover",
      venueImageUrl:
        "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?auto=format&fit=crop&w=1200&q=80",
      venueImageId: "events/eldorado_venue",
      status: "PUBLISHED",
      isRefundable: true,
      ticketTiers: [
        { name: "Festival Pit Standing", price: 320000, quota: 600, availableQuota: 275 },
        { name: "Tribune Seated", price: 420000, quota: 300, availableQuota: 5 },
      ],
    },
    // 5. Pending Review Event (for Admin Moderation testing)
    {
      title: "Cadas Nusantara: Heavy Metal Showcase",
      slugKey: "cadas-nusantara-jogja",
      categorySlug: "rock-metal",
      location: "Stadion Kridosono, Yogyakarta",
      startDatetime: new Date("2027-01-15T15:00:00+07:00"),
      endDatetime: new Date("2027-01-15T23:00:00+07:00"),
      description:
        "Annual high-decibel gathering of underground metal and hardcore bands. Mosh pit protocol strictly enforced with certified medical team on standby.",
      coverImageUrl:
        "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=1600&q=80",
      coverImageId: "events/cadas_nusantara_cover",
      venueImageUrl:
        "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80",
      venueImageId: "events/kridosono_venue",
      status: "PENDING_REVIEW",
      isRefundable: true,
      ticketTiers: [
        { name: "General Admission", price: 200000, quota: 500, availableQuota: 500 },
      ],
    },
    // 6. Draft Event (for Organizer Editing testing)
    {
      title: "Senja Akustik: Intimate Forest Sessions",
      slugKey: "senja-akustik-forest",
      categorySlug: "indie-alternative",
      location: "Hutan Pinus Mangunan, Dlingo, Bantul",
      startDatetime: new Date("2027-02-14T16:00:00+07:00"),
      endDatetime: new Date("2027-02-14T21:00:00+07:00"),
      description:
        "Draft concept for acoustic sunset showcase among the pine trees. Warm tea and reusable mats provided.",
      coverImageUrl:
        "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1600&q=80",
      coverImageId: "events/senja_akustik_cover",
      status: "DRAFT",
      isRefundable: true,
      ticketTiers: [
        { name: "Early Bird Pass", price: 150000, quota: 200, availableQuota: 200 },
      ],
    },
  ];

  const seededEvents = [];
  let amaraGaTicketType = null;
  let amaraEvent = null;

  for (const item of eventsData) {
    const category = categoryMap[item.categorySlug];

    let event = await prisma.event.findFirst({
      where: {
        organizerId: approvedOrgUser.id,
        title: item.title,
      },
    });

    if (event) {
      event = await prisma.event.update({
        where: { id: event.id },
        data: {
          categoryId: category.id,
          location: item.location,
          startDatetime: item.startDatetime,
          endDatetime: item.endDatetime,
          description: item.description,
          coverImageUrl: item.coverImageUrl,
          coverImageId: item.coverImageId,
          venueImageUrl: item.venueImageUrl || null,
          venueImageId: item.venueImageId || null,
          status: item.status,
          isRefundable: item.isRefundable,
        },
      });
    } else {
      event = await prisma.event.create({
        data: {
          organizerId: approvedOrgUser.id,
          categoryId: category.id,
          title: item.title,
          location: item.location,
          startDatetime: item.startDatetime,
          endDatetime: item.endDatetime,
          description: item.description,
          coverImageUrl: item.coverImageUrl,
          coverImageId: item.coverImageId,
          venueImageUrl: item.venueImageUrl || null,
          venueImageId: item.venueImageId || null,
          status: item.status,
          isRefundable: item.isRefundable,
        },
      });
    }

    seededEvents.push(event);

    // Upsert Ticket Types
    for (const tier of item.ticketTiers) {
      const existingTier = await prisma.ticketType.findFirst({
        where: {
          eventId: event.id,
          name: tier.name,
        },
      });

      if (existingTier) {
        const updated = await prisma.ticketType.update({
          where: { id: existingTier.id },
          data: {
            price: tier.price,
            quota: tier.quota,
            availableQuota: tier.availableQuota,
          },
        });
        if (item.title.includes("Amara Okafor") && tier.name === "General Admission") {
          amaraGaTicketType = updated;
          amaraEvent = event;
        }
      } else {
        const created = await prisma.ticketType.create({
          data: {
            eventId: event.id,
            name: tier.name,
            price: tier.price,
            quota: tier.quota,
            availableQuota: tier.availableQuota,
          },
        });
        if (item.title.includes("Amara Okafor") && tier.name === "General Admission") {
          amaraGaTicketType = created;
          amaraEvent = event;
        }
      }
    }

    // Assign check-in staff to published events
    if (item.status === "PUBLISHED") {
      await prisma.eventStaff.upsert({
        where: {
          eventId_userId: {
            eventId: event.id,
            userId: staffUser.id,
          },
        },
        update: {},
        create: {
          eventId: event.id,
          userId: staffUser.id,
        },
      });
    }

    // Assign unactivated staff invitation to pending review event (for staff invitation testing)
    if (item.status === "PENDING_REVIEW") {
      await prisma.staffInvitation.upsert({
        where: {
          eventId_userId: {
            eventId: event.id,
            userId: staffUser.id,
          },
        },
        update: { activated: false },
        create: {
          eventId: event.id,
          userId: staffUser.id,
          activated: false,
        },
      });
    }
  }

  // ==========================================
  // 4. SAMPLE PAID ORDER & ISSUED TICKETS (FOR BUYER)
  // ==========================================
  console.log("🎟️  Seeding sample paid order and QR issued tickets for buyer...");

  if (amaraGaTicketType && amaraEvent) {
    const orderNumber = "ORD-AMARA-2026-001";
    const totalAmount = 900000; // 2 x 450,000

    const order = await prisma.order.upsert({
      where: { orderNumber },
      update: {
        userId: buyerUser.id,
        totalAmount,
        paymentStatus: "PAID",
        paymentMethod: "BCA_VIRTUAL_ACCOUNT",
        paymentUrl: "https://checkout.xendit.co/web/test-amara-2026",
        pgTransactionId: "xnd_sim_amara_001",
        idempotencyKey: "idem_amara_buyer_001",
        expiresAt: new Date("2026-11-20T23:59:00+07:00"),
      },
      create: {
        orderNumber,
        userId: buyerUser.id,
        totalAmount,
        paymentStatus: "PAID",
        paymentMethod: "BCA_VIRTUAL_ACCOUNT",
        paymentUrl: "https://checkout.xendit.co/web/test-amara-2026",
        pgTransactionId: "xnd_sim_amara_001",
        idempotencyKey: "idem_amara_buyer_001",
        expiresAt: new Date("2026-11-20T23:59:00+07:00"),
      },
    });

    let orderItem = await prisma.orderItem.findFirst({
      where: {
        orderId: order.id,
        ticketTypeId: amaraGaTicketType.id,
      },
    });

    if (!orderItem) {
      orderItem = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          ticketTypeId: amaraGaTicketType.id,
          quantity: 2,
          price: 450000,
        },
      });
    }

    // 2 Issued Tickets with realistic tactile ticket codes
    const ticketCodes = ["FSTX-AMARA-GA-8821", "FSTX-AMARA-GA-8822"];

    for (const code of ticketCodes) {
      await prisma.issuedTicket.upsert({
        where: { ticketCode: code },
        update: {
          orderItemId: orderItem.id,
          isRedeemed: false,
          isCancelled: false,
          isRefunded: false,
        },
        create: {
          orderItemId: orderItem.id,
          ticketCode: code,
          isRedeemed: false,
          isCancelled: false,
          isRefunded: false,
        },
      });
    }
  }

  console.log("✅ Festix database seeding completed successfully with zero errors!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed with error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
