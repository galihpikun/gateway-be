import prisma from '../service/prisma.js';

export const getDashboardData = async (req, res, next) => {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      totalOrganizers,
      totalEvents,
      publishedEvents,
      pendingEvents,
      totalTicketTypes,
      totalOrders,
      paidOrdersCount,
      totalIssuedTickets,
      totalRedeemedTickets,
      eventsByStatusRaw,
      categoriesWithEventCount,
      ordersByStatusRaw,
      paidOrdersAggregate,
      recentPaidOrdersForMonthly,
      ticketsCountRaw,
      recentEvents,
      recentOrders,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.organizerProfile.count(),
      prisma.event.count(),
      prisma.event.count({
        where: {
          status: 'PUBLISHED',
        },
      }),
      prisma.event.count({
        where: {
          status: 'PENDING_REVIEW',
        },
      }),
      prisma.ticketType.count(),
      prisma.order.count(),
      prisma.order.count({
        where: {
          paymentStatus: 'PAID',
        },
      }),
      prisma.issuedTicket.count(),
      prisma.issuedTicket.count({
        where: {
          isRedeemed: true,
        },
      }),
      prisma.event.groupBy({
        by: ['status'],
        _count: {
          _all: true,
        },
      }),
      prisma.category.findMany({
        select: {
          name: true,
          _count: {
            select: {
              events: true,
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      }),
      prisma.order.groupBy({
        by: ['paymentStatus'],
        _count: {
          _all: true,
        },
      }),
      prisma.order.aggregate({
        where: {
          paymentStatus: 'PAID',
        },
        _sum: {
          totalAmount: true,
        },
      }),
      prisma.order.findMany({
        where: {
          paymentStatus: 'PAID',
          createdAt: {
            gte: sixMonthsAgo,
          },
        },
        select: {
          createdAt: true,
          totalAmount: true,
        },
      }),
      Promise.all([
        prisma.issuedTicket.count({
          where: { isRedeemed: true },
        }),
        prisma.issuedTicket.count({
          where: { isRedeemed: false, isCancelled: false },
        }),
        prisma.issuedTicket.count({
          where: { isCancelled: true },
        }),
      ]),
      prisma.event.findMany({
        take: 5,
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          organizer: {
            select: {
              fullName: true,
              organizerProfile: {
                select: {
                  organizationName: true,
                },
              },
            },
          },
          category: {
            select: {
              name: true,
            },
          },
        },
      }),
      prisma.order.findMany({
        take: 5,
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          orderNumber: true,
          totalAmount: true,
          paymentStatus: true,
          createdAt: true,
          user: {
            select: {
              fullName: true,
              email: true,
            },
          },
        },
      }),
    ]);

    const [redeemedTickets, unredeemedTickets, cancelledTickets] = ticketsCountRaw;

    const eventsByStatus = eventsByStatusRaw.map((item) => ({
      status: item.status,
      count: item._count._all,
    }));

    const eventsByCategory = categoriesWithEventCount.map((cat) => ({
      category: cat.name,
      count: cat._count.events,
    }));

    const ordersByStatus = ordersByStatusRaw.map((item) => ({
      status: item.paymentStatus,
      count: item._count._all,
    }));

    const totalRevenue = Number(paidOrdersAggregate._sum.totalAmount ?? 0);

    const monthlyMap = new Map();

    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const key = `${year}-${month}`;
      monthlyMap.set(key, { orders: 0, revenue: 0 });
    }

    for (const order of recentPaidOrdersForMonthly) {
      const year = new Date(order.createdAt).getFullYear();
      const month = String(new Date(order.createdAt).getMonth() + 1).padStart(2, '0');
      const key = `${year}-${month}`;

      const entry = monthlyMap.get(key);
      if (entry) {
        entry.orders += 1;
        entry.revenue += Number(order.totalAmount);
      }
    }

    const monthly = Array.from(monthlyMap.entries()).map(([month, data]) => ({
      month,
      orders: data.orders,
      revenue: data.revenue,
    }));

    const formattedRecentEvents = recentEvents.map((event) => ({
      id: event.id,
      title: event.title,
      status: event.status,
      createdAt: event.createdAt,
      organizerName:
        event.organizer?.organizerProfile?.organizationName ||
        event.organizer?.fullName ||
        null,
      categoryName: event.category?.name || null,
    }));

    const formattedRecentOrders = recentOrders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      totalAmount: Number(order.totalAmount),
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
      purchaserName: order.user?.fullName || null,
      purchaserEmail: order.user?.email || null,
    }));

    return res.status(200).json({
      summary: {
        totalUsers,
        totalOrganizers,
        totalEvents,
        publishedEvents,
        pendingEvents,
        totalTicketTypes,
        totalOrders,
        paidOrders: paidOrdersCount,
        totalIssuedTickets,
        totalRedeemedTickets,
      },
      events: {
        byStatus: eventsByStatus,
        byCategory: eventsByCategory,
      },
      orders: {
        byStatus: ordersByStatus,
        totalRevenue,
        monthly,
      },
      tickets: {
        total: totalIssuedTickets,
        redeemed: redeemedTickets,
        unredeemed: unredeemedTickets,
        cancelled: cancelledTickets,
      },
      recent: {
        events: formattedRecentEvents,
        orders: formattedRecentOrders,
      },
    });
  } catch (err) {
    next(err);
  }
};
