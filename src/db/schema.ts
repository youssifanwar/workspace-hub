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
  pgEnum,
} from "drizzle-orm/pg-core";

// -----------------------------------------------------------------------------
// ENUMS
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// USERS
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// SETTINGS
// -----------------------------------------------------------------------------

export const settings = pgTable(
  "settings",
  {
    key: varchar("key", {
      length: 100,
    }).primaryKey(),

    value: text("value").notNull(),
  },
);

// -----------------------------------------------------------------------------
// SHIFTS
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// CUSTOMERS
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// DESKS
// -----------------------------------------------------------------------------

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
// -----------------------------------------------------------------------------
// GOOGLE CALENDAR MAPPING FOR MEETING ROOMS
// -----------------------------------------------------------------------------

export const meetingRoomCalendars = pgTable(
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

// -----------------------------------------------------------------------------
// FUTURE MEETING ROOM RESERVATIONS
// -----------------------------------------------------------------------------

export const meetingRoomReservations =
  pgTable(
    "meeting_room_reservations",
    {
      id: serial("id").primaryKey(),

      deskId: integer(
        "desk_id",
      )
        .notNull()
        .references(
          () => desks.id,
          {
            onDelete: "cascade",
          },
        ),

      customerId: integer(
        "customer_id",
      ).references(
        () => customers.id,
        {
          onDelete: "set null",
        },
      ),

      userId: integer(
        "user_id",
      )
        .notNull()
        .references(
          () => users.id,
        ),

      startAt: timestamp(
        "start_at",
        {
          withTimezone: true,
        },
      ).notNull(),

      endAt: timestamp(
        "end_at",
        {
          withTimezone: true,
        },
      ).notNull(),

      recurrenceRule: text(
        "recurrence_rule",
      ),

      recurrenceCount: integer(
        "recurrence_count",
      ),

      googleEventId: varchar(
        "google_event_id",
        {
          length: 1024,
        },
      ).unique(),

      status: varchar(
        "status",
        {
          length: 30,
        },
      )
        .notNull()
        .default("confirmed"),

      notes: text(
        "notes",
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
// -----------------------------------------------------------------------------
// CATEGORIES
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// PRODUCTS
// -----------------------------------------------------------------------------

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

    price: numeric("price", {
      precision: 12,
      scale: 2,
    })
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

    active: boolean("active")
      .notNull()
      .default(true),
  },
);

// -----------------------------------------------------------------------------
// BOOKINGS
// -----------------------------------------------------------------------------

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

    deskId: integer(
      "desk_id",
    )
      .notNull()
      .references(
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

    hourlyRateSnapshot: numeric(
      "hourly_rate_snapshot",
      {
        precision: 12,
        scale: 2,
      },
    ).notNull(),

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

    status: bookingStatusEnum(
      "status",
    )
      .notNull()
      .default("active"),
  },
);

// -----------------------------------------------------------------------------
// ORDER TICKETS
// -----------------------------------------------------------------------------

export const orderTickets = pgTable(
  "order_tickets",
  {
    id: serial("id").primaryKey(),

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

// -----------------------------------------------------------------------------
// ORDER REQUESTS
//
// Prevents duplicate QR orders when the same request is submitted more than
// once because of double clicks, retries, or unstable network conditions.
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// BOOKING ITEMS
// -----------------------------------------------------------------------------

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

    // Links this item to the exact order ticket.
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

// -----------------------------------------------------------------------------
// BANK TRANSACTIONS
// -----------------------------------------------------------------------------

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

      note: text("note"),

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

// -----------------------------------------------------------------------------
// EXPENSES
// -----------------------------------------------------------------------------

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

    note: text("note"),

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

// -----------------------------------------------------------------------------
// SESSIONS
// -----------------------------------------------------------------------------

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