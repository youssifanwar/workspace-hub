import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  bigint,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

// =============================================================================
// ENUMS
// =============================================================================

export const roleEnum = pgEnum("user_role", [
  "admin",
  "manager",
  "employee",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "visa",
  "instapay",
]);

export const deskTypeEnum = pgEnum("desk_type", [
  "desk",
  "meeting_room",
]);

export const meetingRoomPackageStatusEnum = pgEnum(
  "meeting_room_package_status",
  ["active", "inactive"],
);

export const meetingRoomPackagePurchaseStatusEnum = pgEnum(
  "meeting_room_package_purchase_status",
  ["active", "exhausted", "expired", "cancelled"],
);

export const meetingRoomPackageUsageTypeEnum = pgEnum(
  "meeting_room_package_usage_type",
  ["purchase", "usage", "adjustment", "refund", "reversal"],
);

export const bookingStatusEnum = pgEnum(
  "booking_status",
  ["active", "closed"],
);

export const bankTypeEnum = pgEnum(
  "bank_type",
  ["deposit", "withdraw"],
);

export const orderSourceEnum = pgEnum(
  "order_source",
  ["staff", "qr"],
);

export const orderStatusEnum = pgEnum(
  "order_status",
  [
    "pending",
    "printed",
    "served",
    "cancelled",
  ],
);

// =============================================================================
// USERS
// =============================================================================

export const users = pgTable("users", {
  id: serial("id").primaryKey(),

  username: varchar("username", {
    length: 100,
  })
    .notNull()
    .unique(),

  passwordHash: text(
    "password_hash",
  ).notNull(),

  fullName: varchar("full_name", {
    length: 200,
  }).notNull(),

  role: roleEnum("role")
    .notNull()
    .default("employee"),

  active: boolean("active")
    .notNull()
    .default(true),

  createdAt: timestamp(
    "created_at",
    {
      withTimezone: true,
    },
  )
    .notNull()
    .defaultNow(),
});

// =============================================================================
// SETTINGS
// =============================================================================

export const settings = pgTable(
  "settings",
  {
    key: varchar("key", {
      length: 100,
    }).primaryKey(),

    value: text("value").notNull(),
  },
);

// =============================================================================
// SHIFTS
// =============================================================================

export const shifts = pgTable(
  "shifts",
  {
    id: serial("id").primaryKey(),

    userId: integer("user_id")
      .notNull()
      .references(
        () => users.id,
      ),

    openedAt: timestamp(
      "opened_at",
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),

    closedAt: timestamp(
      "closed_at",
      {
        withTimezone: true,
      },
    ),

    openingCash: numeric(
      "opening_cash",
      {
        precision: 12,
        scale: 2,
      },
    )
      .notNull()
      .default("0"),

    closingCash: numeric(
      "closing_cash",
      {
        precision: 12,
        scale: 2,
      },
    ),

    note: text("note"),
  },
);

// =============================================================================
// CUSTOMERS
// =============================================================================

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),

    name: varchar("name", {
      length: 200,
    }).notNull(),

    phone: varchar("phone", {
      length: 40,
    }).notNull(),

    // Canonical searchable phone value.
    // Example:
    // 01012345678 -> 201012345678
    // +201012345678 -> 201012345678
    // 00201012345678 -> 201012345678
    phoneNormalized: varchar(
      "phone_normalized",
      {
        length: 40,
      },
    ),

    email: varchar(
      "email",
      {
        length: 255,
      },
    ),

    notes: text("notes"),

    createdAt: timestamp(
      "created_at",
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),

    updatedAt: timestamp(
      "updated_at",
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex(
      "customers_phone_normalized_uq",
    ).on(
      table.phoneNormalized,
    ),

    index(
      "customers_phone_idx",
    ).on(
      table.phone,
    ),

    index(
      "customers_name_idx",
    ).on(
      table.name,
    ),
  ],
);

// =============================================================================
// DESKS / PHYSICAL LOCATIONS
// =============================================================================

export const desks = pgTable(
  "desks",
  {
    id: serial("id").primaryKey(),

    name: varchar("name", {
      length: 100,
    }).notNull(),

    type: deskTypeEnum("type")
      .notNull()
      .default("desk"),

    hourlyRate: numeric(
      "hourly_rate",
      {
        precision: 12,
        scale: 2,
      },
    )
      .notNull()
      .default("0"),

    capacity: integer("capacity")
      .notNull()
      .default(1),

    active: boolean("active")
      .notNull()
      .default(true),

    sortOrder: integer(
      "sort_order",
    )
      .notNull()
      .default(0),
  },
);

// =============================================================================
// MEETING ROOM PRICING
// =============================================================================

export const meetingRoomPricing = pgTable(
  "meeting_room_pricing",
  {
    id: serial("id").primaryKey(),

    deskId: integer("desk_id")
      .notNull()
      .references(() => desks.id, {
        onDelete: "cascade",
      }),

    minPeople: integer("min_people")
      .notNull(),

    maxPeople: integer("max_people")
      .notNull(),

    hourlyRate: numeric("hourly_rate", {
      precision: 12,
      scale: 2,
    }).notNull(),

    active: boolean("active")
      .notNull()
      .default(true),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("meeting_room_pricing_desk_idx").on(table.deskId),
    uniqueIndex("meeting_room_pricing_desk_range_uq").on(
      table.deskId,
      table.minPeople,
      table.maxPeople,
    ),
  ],
);

// =============================================================================
// SUBSCRIPTION PACKAGE DEFINITIONS
// =============================================================================
//
// These are package templates.
//
// Example:
// 60 hours / 1500 EGP / 30 days
// 90 hours / 2200 EGP / 60 days
//
// They can be edited/deactivated from the application.
// Existing customer purchases are NOT changed when a template changes.
// =============================================================================

export const subscriptionPackages =
  pgTable(
    "subscription_packages",
    {
      id: serial("id").primaryKey(),

      name: varchar("name", {
        length: 200,
      }).notNull(),

      totalHours: numeric(
        "total_hours",
        {
          precision: 10,
          scale: 2,
        },
      ).notNull(),

      price: numeric(
        "price",
        {
          precision: 12,
          scale: 2,
        },
      ).notNull(),

      validityDays: integer(
        "validity_days",
      ),

      description: text(
        "description",
      ),

      active: boolean(
        "active",
      )
        .notNull()
        .default(true),

      createdAt: timestamp(
        "created_at",
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),

      updatedAt: timestamp(
        "updated_at",
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index(
        "subscription_packages_active_idx",
      ).on(
        table.active,
      ),
    ],
  );

// =============================================================================
// MEETING ROOM PACKAGE DEFINITIONS
// =============================================================================

export const meetingRoomPackages = pgTable(
  "meeting_room_packages",
  {
    id: serial("id").primaryKey(),

    name: varchar("name", {
      length: 200,
    }).notNull(),

    totalHours: numeric("total_hours", {
      precision: 10,
      scale: 2,
    }).notNull(),

    discountPercent: numeric("discount_percent", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("0"),

    price: numeric("price", {
      precision: 12,
      scale: 2,
    }).notNull(),

    validityDays: integer("validity_days"),

    description: text("description"),

    status: meetingRoomPackageStatusEnum("status")
      .notNull()
      .default("active"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("meeting_room_packages_status_idx").on(table.status),
    index("meeting_room_packages_total_hours_idx").on(table.totalHours),
  ],
);

// =============================================================================
// CUSTOMER SUBSCRIPTIONS
// =============================================================================
//
// This is an actual package purchase by a customer.
//
// IMPORTANT:
// packageNameSnapshot / totalHoursSnapshot / priceSnapshot /
// validityDaysSnapshot preserve what the customer actually bought.
// Changing subscriptionPackages later will NOT rewrite old subscriptions.
// =============================================================================

export const customerSubscriptions =
  pgTable(
    "customer_subscriptions",
    {
      id: serial("id").primaryKey(),

      customerId: integer(
        "customer_id",
      )
        .notNull()
        .references(
          () => customers.id,
          {
            onDelete: "restrict",
          },
        ),

      packageId: integer(
        "package_id",
      )
        .notNull()
        .references(
          () => subscriptionPackages.id,
          {
            onDelete: "restrict",
          },
        ),

      packageNameSnapshot: varchar(
        "package_name_snapshot",
        {
          length: 200,
        },
      ).notNull(),

      totalHoursSnapshot: numeric(
        "total_hours_snapshot",
        {
          precision: 10,
          scale: 2,
        },
      ).notNull(),

      priceSnapshot: numeric(
        "price_snapshot",
        {
          precision: 12,
          scale: 2,
        },
      ).notNull(),

      validityDaysSnapshot: integer(
        "validity_days_snapshot",
      ),

      purchasedAt: timestamp(
        "purchased_at",
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),

      startsAt: timestamp(
        "starts_at",
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),

      expiresAt: timestamp(
        "expires_at",
        {
          withTimezone: true,
        },
      ),

      status: varchar(
        "status",
        {
          length: 30,
        },
      )
        .notNull()
        .default("active"),

      note: text("note"),

      createdByUserId: integer(
        "created_by_user_id",
      ).references(
        () => users.id,
        {
          onDelete: "set null",
        },
      ),

      createdAt: timestamp(
        "created_at",
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),

      updatedAt: timestamp(
        "updated_at",
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index(
        "customer_subscriptions_customer_idx",
      ).on(
        table.customerId,
      ),

      index(
        "customer_subscriptions_status_idx",
      ).on(
        table.status,
      ),

      index(
        "customer_subscriptions_expiry_idx",
      ).on(
        table.expiresAt,
      ),
    ],
  );

// =============================================================================
// CUSTOMER MEETING ROOM PACKAGE PURCHASES
// =============================================================================

export const customerMeetingRoomPackages = pgTable(
  "customer_meeting_room_packages",
  {
    id: serial("id").primaryKey(),

    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, {
        onDelete: "restrict",
      }),

    packageId: integer("package_id")
      .notNull()
      .references(() => meetingRoomPackages.id, {
        onDelete: "restrict",
      }),

    packageNameSnapshot: varchar("package_name_snapshot", {
      length: 200,
    }).notNull(),

    totalHoursSnapshot: numeric("total_hours_snapshot", {
      precision: 10,
      scale: 2,
    }).notNull(),

    discountPercentSnapshot: numeric("discount_percent_snapshot", {
      precision: 5,
      scale: 2,
    }).notNull(),

    priceSnapshot: numeric("price_snapshot", {
      precision: 12,
      scale: 2,
    }).notNull(),

    validityDaysSnapshot: integer("validity_days_snapshot"),

    purchasedAt: timestamp("purchased_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    startsAt: timestamp("starts_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    expiresAt: timestamp("expires_at", {
      withTimezone: true,
    }),

    status: meetingRoomPackagePurchaseStatusEnum("status")
      .notNull()
      .default("active"),

    note: text("note"),

    createdByUserId: integer("created_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("customer_meeting_room_packages_customer_idx").on(table.customerId),
    index("customer_meeting_room_packages_status_idx").on(table.status),
    index("customer_meeting_room_packages_expiry_idx").on(table.expiresAt),
  ],
);

// =============================================================================
// GOOGLE CALENDAR MAPPING FOR MEETING ROOMS
// =============================================================================

export const meetingRoomCalendars =
  pgTable(
    "meeting_room_calendars",
    {
      id: serial("id").primaryKey(),

      deskId: integer(
        "desk_id",
      )
        .notNull()
        .unique()
        .references(
          () => desks.id,
          {
            onDelete: "cascade",
          },
        ),

      calendarId: text(
        "calendar_id",
      )
        .notNull()
        .unique(),

      calendarName: varchar(
        "calendar_name",
        {
          length: 200,
        },
      ),

      createdAt: timestamp(
        "created_at",
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),

      updatedAt: timestamp(
        "updated_at",
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),
    },
  );

// =============================================================================
// FUTURE MEETING ROOM RESERVATIONS
// =============================================================================

export const meetingRoomReservations =
  pgTable(
    "meeting_room_reservations",
    {
      id: serial("id").primaryKey(),

      deskId: integer("desk_id")
        .notNull()
        .references(() => desks.id, {
          onDelete: "cascade",
        }),

      customerId: integer("customer_id").references(() => customers.id, {
        onDelete: "set null",
      }),

      /**
       * Links the meeting-room reservation to the customer session used by
       * the existing QR / F&B ordering flow.
       */
      bookingId: integer("booking_id").references(() => bookings.id, {
        onDelete: "set null",
      }),

      userId: integer("user_id")
        .notNull()
        .references(() => users.id),

      startAt: timestamp("start_at", {
        withTimezone: true,
      }).notNull(),

      endAt: timestamp("end_at", {
        withTimezone: true,
      }).notNull(),

      attendeeCount: integer("attendee_count").notNull(),

      hourlyRateSnapshot: numeric("hourly_rate_snapshot", {
        precision: 12,
        scale: 2,
      }).notNull(),

      durationHours: numeric("duration_hours", {
        precision: 10,
        scale: 2,
      }).notNull(),

      subtotalAmount: numeric("subtotal_amount", {
        precision: 12,
        scale: 2,
      }).notNull(),

      discountPercentSnapshot: numeric("discount_percent_snapshot", {
        precision: 5,
        scale: 2,
      })
        .notNull()
        .default("0"),

      discountAmount: numeric("discount_amount", {
        precision: 12,
        scale: 2,
      })
        .notNull()
        .default("0"),

      totalAmount: numeric("total_amount", {
        precision: 12,
        scale: 2,
      }).notNull(),

      packagePurchaseId: integer("package_purchase_id").references(
        () => customerMeetingRoomPackages.id,
        {
          onDelete: "restrict",
        },
      ),

      packageHoursUsed: numeric("package_hours_used", {
        precision: 10,
        scale: 2,
      }),

      recurrenceRule: text("recurrence_rule"),

      recurrenceCount: integer("recurrence_count"),

      googleEventId: varchar("google_event_id", {
        length: 1024,
      }).unique(),

      status: varchar("status", {
        length: 30,
      })
        .notNull()
        .default("confirmed"),

      notes: text("notes"),

      createdAt: timestamp("created_at", {
        withTimezone: true,
      })
        .notNull()
        .defaultNow(),

      updatedAt: timestamp("updated_at", {
        withTimezone: true,
      })
        .notNull()
        .defaultNow(),
    },
  );

// =============================================================================
// MEETING ROOM PACKAGE USAGE LEDGER
// =============================================================================

export const meetingRoomPackageUsageLedger = pgTable(
  "meeting_room_package_usage_ledger",
  {
    id: serial("id").primaryKey(),

    packagePurchaseId: integer("package_purchase_id")
      .notNull()
      .references(() => customerMeetingRoomPackages.id, {
        onDelete: "restrict",
      }),

    reservationId: integer("reservation_id").references(
      () => meetingRoomReservations.id,
      {
        onDelete: "set null",
      },
    ),

    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    entryType: meetingRoomPackageUsageTypeEnum("entry_type").notNull(),

    hoursDelta: numeric("hours_delta", {
      precision: 10,
      scale: 2,
    }).notNull(),

    reason: text("reason"),

    idempotencyKey: varchar("idempotency_key", {
      length: 200,
    })
      .notNull()
      .unique(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("meeting_room_package_usage_purchase_idx").on(table.packagePurchaseId),
    index("meeting_room_package_usage_reservation_idx").on(table.reservationId),
    index("meeting_room_package_usage_created_idx").on(table.createdAt),
  ],
);

// =============================================================================
// CATEGORIES
// =============================================================================

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),

    name: varchar("name", {
      length: 100,
    }).notNull(),

    icon: varchar("icon", {
      length: 20,
    })
      .notNull()
      .default("🍽️"),

    sortOrder: integer(
      "sort_order",
    )
      .notNull()
      .default(0),
  },
);

// =============================================================================
// PRODUCTS
// =============================================================================

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),

    categoryId: integer(
      "category_id",
    )
      .notNull()
      .references(
        () => categories.id,
        {
          onDelete: "cascade",
        },
      ),

    name: varchar("name", {
      length: 200,
    }).notNull(),

    price: numeric(
      "price",
      {
        precision: 12,
        scale: 2,
      },
    )
      .notNull()
      .default("0"),

    imageUrl: text(
      "image_url",
    ),

    icon: varchar("icon", {
      length: 20,
    })
      .notNull()
      .default("🍔"),

    active: boolean(
      "active",
    )
      .notNull()
      .default(true),
  },
);

// =============================================================================
// BOOKINGS / CUSTOMER SESSIONS
// =============================================================================
//
// IMPORTANT:
// The session is NOT tied to a physical desk.
// deskId is nullable because it may only represent the physical QR source.
// The customer's session and billing live here.
// =============================================================================

export const bookings = pgTable(
  "bookings",
  {
    id: serial("id").primaryKey(),

    customerId: integer(
      "customer_id",
    )
      .notNull()
      .references(
        () => customers.id,
      ),

    // Physical location / QR source only.
    deskId: integer(
      "desk_id",
    ).references(
      () => desks.id,
    ),

    shiftId: integer(
      "shift_id",
    )
      .notNull()
      .references(
        () => shifts.id,
      ),

    userId: integer(
      "user_id",
    )
      .notNull()
      .references(
        () => users.id,
      ),

    // -------------------------------------------------------------------------
    // CUSTOMER SESSION / QR ACCESS
    // -------------------------------------------------------------------------

    accessCode: varchar(
      "access_code",
      {
        length: 4,
      },
    ),

    accessTokenHash: text(
      "access_token_hash",
    ),

    accessTokenCreatedAt: timestamp(
      "access_token_created_at",
      {
        withTimezone: true,
      },
    ),

    // -------------------------------------------------------------------------
    // TIME
    // -------------------------------------------------------------------------

    checkedInAt: timestamp(
      "checked_in_at",
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),

    checkedOutAt: timestamp(
      "checked_out_at",
      {
        withTimezone: true,
      },
    ),

    // -------------------------------------------------------------------------
    // LEGACY / SNAPSHOT RATE
    //
    // Kept for compatibility and historical data.
    // Regular session pricing is handled by application pricing rules.
    // -------------------------------------------------------------------------

    hourlyRateSnapshot: numeric(
      "hourly_rate_snapshot",
      {
        precision: 12,
        scale: 2,
      },
    ).notNull(),

    // -------------------------------------------------------------------------
    // BILLING
    // -------------------------------------------------------------------------

    seatCharge: numeric(
      "seat_charge",
      {
        precision: 12,
        scale: 2,
      },
    ),

    ordersTotal: numeric(
      "orders_total",
      {
        precision: 12,
        scale: 2,
      },
    )
      .notNull()
      .default("0"),

    discount: numeric(
      "discount",
      {
        precision: 12,
        scale: 2,
      },
    )
      .notNull()
      .default("0"),

    total: numeric(
      "total",
      {
        precision: 12,
        scale: 2,
      },
    ),

    paidAmount: numeric(
      "paid_amount",
      {
        precision: 12,
        scale: 2,
      },
    ),

    changeAmount: numeric(
      "change_amount",
      {
        precision: 12,
        scale: 2,
      },
    ),

    paymentMethod: paymentMethodEnum(
      "payment_method",
    ),

    // -------------------------------------------------------------------------
    // SUBSCRIPTION BILLING
    // -------------------------------------------------------------------------

    billingMode: varchar(
      "billing_mode",
      {
        length: 20,
      },
    )
      .notNull()
      .default("regular"),

    subscriptionId: integer(
      "subscription_id",
    ).references(
      () => customerSubscriptions.id,
      {
        onDelete: "restrict",
      },
    ),

    subscriptionHoursUsed: numeric(
      "subscription_hours_used",
      {
        precision: 10,
        scale: 2,
      },
    ),

    billingNote: text(
      "billing_note",
    ),

    // -------------------------------------------------------------------------
    // STATUS
    // -------------------------------------------------------------------------

    status: bookingStatusEnum(
      "status",
    )
      .notNull()
      .default("active"),
  },
);

// =============================================================================
// SUBSCRIPTION USAGE LEDGER
// =============================================================================
//
// Source of truth for package balance.
//
// Positive hours = credit
// Negative hours = usage
//
// Example:
//
// +60 purchase
//  -3 session
//  -2 session
//  +5 adjustment
//
// Current balance = SUM(hours_delta)
// =============================================================================

export const subscriptionUsageLedger =
  pgTable(
    "subscription_usage_ledger",
    {
      id: serial("id").primaryKey(),

      subscriptionId: integer(
        "subscription_id",
      )
        .notNull()
        .references(
          () => customerSubscriptions.id,
          {
            onDelete: "restrict",
          },
        ),

      bookingId: integer(
        "booking_id",
      ).references(
        () => bookings.id,
        {
          onDelete: "set null",
        },
      ),

      userId: integer(
        "user_id",
      ).references(
        () => users.id,
        {
          onDelete: "set null",
        },
      ),

      entryType: varchar(
        "entry_type",
        {
          length: 30,
        },
      ).notNull(),

      hoursDelta: numeric(
        "hours_delta",
        {
          precision: 10,
          scale: 2,
        },
      ).notNull(),

      reason: text(
        "reason",
      ),

      // Prevents duplicate accounting actions.
      idempotencyKey: varchar(
        "idempotency_key",
        {
          length: 200,
        },
      ).unique(),

      createdAt: timestamp(
        "created_at",
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index(
        "subscription_usage_ledger_subscription_idx",
      ).on(
        table.subscriptionId,
      ),

      index(
        "subscription_usage_ledger_booking_idx",
      ).on(
        table.bookingId,
      ),

      index(
        "subscription_usage_ledger_created_idx",
      ).on(
        table.createdAt,
      ),
    ],
  );

// =============================================================================
// ORDER TICKETS
// =============================================================================

export const orderTickets = pgTable(
  "order_tickets",
  {
    id: serial("id").primaryKey(),

    // Internal ticket number.
    // requestId below is the duplicate-protection identifier.
    ticketNumber: integer(
      "ticket_number",
    ).notNull(),

    bookingId: integer(
      "booking_id",
    )
      .notNull()
      .references(
        () => bookings.id,
        {
          onDelete: "cascade",
        },
      ),

    // Physical location where order was placed.
    deskId: integer(
      "desk_id",
    )
      .notNull()
      .references(
        () => desks.id,
      ),

    source: orderSourceEnum(
      "source",
    )
      .notNull()
      .default("qr"),

    status: orderStatusEnum(
      "status",
    )
      .notNull()
      .default("pending"),

    customerNote: text(
      "customer_note",
    ),

    printedAt: timestamp(
      "printed_at",
      {
        withTimezone: true,
      },
    ),

    servedAt: timestamp(
      "served_at",
      {
        withTimezone: true,
      },
    ),

    createdAt: timestamp(
      "created_at",
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),
  },
);

// =============================================================================
// ORDER REQUESTS
// =============================================================================
//
// Prevents duplicate QR orders.
//
// requestId is intentionally unique and is generated by the application.
// It is NOT a sequential ticket number.
// =============================================================================

export const orderRequests = pgTable(
  "order_requests",
  {
    requestId: varchar(
      "request_id",
      {
        length: 128,
      },
    ).primaryKey(),

    ticketId: integer(
      "ticket_id",
    )
      .notNull()
      .references(
        () => orderTickets.id,
        {
          onDelete: "cascade",
        },
      ),

    createdAt: timestamp(
      "created_at",
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),
  },
);

// =============================================================================
// BOOKING ITEMS
// =============================================================================

export const bookingItems = pgTable(
  "booking_items",
  {
    id: serial("id").primaryKey(),

    bookingId: integer(
      "booking_id",
    )
      .notNull()
      .references(
        () => bookings.id,
        {
          onDelete: "cascade",
        },
      ),

    ticketId: integer(
      "ticket_id",
    ).references(
      () => orderTickets.id,
      {
        onDelete: "cascade",
      },
    ),

    productId: integer(
      "product_id",
    ).references(
      () => products.id,
    ),

    // Snapshot of product data at time of ordering.
    // Product can be changed later without changing historical orders.
    nameSnapshot: varchar(
      "name_snapshot",
      {
        length: 200,
      },
    ).notNull(),

    unitPrice: numeric(
      "unit_price",
      {
        precision: 12,
        scale: 2,
      },
    ).notNull(),

    quantity: integer(
      "quantity",
    )
      .notNull()
      .default(1),

    source: orderSourceEnum(
      "source",
    )
      .notNull()
      .default("staff"),

    itemNote: text(
      "item_note",
    ),

    createdAt: timestamp(
      "created_at",
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),
  },
);

// =============================================================================
// AUDIT LOGS
// =============================================================================
//
// Important business actions are recorded here.
//
// Examples:
// - customer_created
// - customer_merged
// - package_created
// - package_updated
// - subscription_purchased
// - subscription_cancelled
// - subscription_adjusted
// - package_hours_used
// - session_checkout
// =============================================================================

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),

    userId: integer(
      "user_id",
    ).references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),

    action: varchar(
      "action",
      {
        length: 100,
      },
    ).notNull(),

    entityType: varchar(
      "entity_type",
      {
        length: 100,
      },
    ),

    entityId: integer(
      "entity_id",
    ),

    details: jsonb(
      "details",
    ),

    createdAt: timestamp(
      "created_at",
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index(
      "audit_logs_user_idx",
    ).on(
      table.userId,
    ),

    index(
      "audit_logs_action_idx",
    ).on(
      table.action,
    ),

    index(
      "audit_logs_entity_idx",
    ).on(
      table.entityType,
      table.entityId,
    ),
  ],
);

// =============================================================================
// BANK TRANSACTIONS
// =============================================================================

export const bankTransactions =
  pgTable(
    "bank_transactions",
    {
      id: serial("id").primaryKey(),

      shiftId: integer(
        "shift_id",
      )
        .notNull()
        .references(
          () => shifts.id,
        ),

      userId: integer(
        "user_id",
      )
        .notNull()
        .references(
          () => users.id,
        ),

      type: bankTypeEnum(
        "type",
      ).notNull(),

      amount: numeric(
        "amount",
        {
          precision: 12,
          scale: 2,
        },
      ).notNull(),

      note: text(
        "note",
      ),

      createdAt: timestamp(
        "created_at",
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),
    },
  );

// =============================================================================
// EXPENSES
// =============================================================================

export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),

    shiftId: integer(
      "shift_id",
    )
      .notNull()
      .references(
        () => shifts.id,
      ),

    userId: integer(
      "user_id",
    )
      .notNull()
      .references(
        () => users.id,
      ),

    amount: numeric(
      "amount",
      {
        precision: 12,
        scale: 2,
      },
    ).notNull(),

    category: varchar(
      "category",
      {
        length: 100,
      },
    )
      .notNull()
      .default("General"),

    note: text(
      "note",
    ),

    createdAt: timestamp(
      "created_at",
      {
        withTimezone: true,
      },
    )
      .notNull()
      .defaultNow(),
  },
);

// =============================================================================
// STAFF SESSIONS
// =============================================================================

export const sessionsTable =
  pgTable(
    "sessions",
    {
      token: varchar(
        "token",
        {
          length: 128,
        },
      ).primaryKey(),

      userId: integer(
        "user_id",
      )
        .notNull()
        .references(
          () => users.id,
          {
            onDelete: "cascade",
          },
        ),

      expiresAt: bigint(
        "expires_at",
        {
          mode: "number",
        },
      ).notNull(),

      createdAt: timestamp(
        "created_at",
        {
          withTimezone: true,
        },
      )
        .notNull()
        .defaultNow(),
    },
  );