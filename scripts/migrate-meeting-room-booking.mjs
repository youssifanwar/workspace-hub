import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Pool } from "pg";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const result = {};
  const text = fs.readFileSync(
    filePath,
    "utf8",
  );

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/,
    );

    if (!match) {
      continue;
    }

    let value = match[2].trim();

    if (
      (value.startsWith('"') &&
        value.endsWith('"')) ||
      (value.startsWith("'") &&
        value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[match[1]] = value;
  }

  return result;
}

const projectRoot =
  process.cwd();

const env = {
  ...parseEnvFile(
    path.join(
      projectRoot,
      ".env",
    ),
  ),
  ...parseEnvFile(
    path.join(
      projectRoot,
      ".env.local",
    ),
  ),
  ...process.env,
};

const databaseUrl =
  env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "DATABASE_URL is missing. Put it in .env.local (or .env) and run this script again.",
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString:
    databaseUrl,
});

try {
  await pool.query("BEGIN");

  await pool.query(`
    ALTER TABLE meeting_room_reservations
    ADD COLUMN IF NOT EXISTS booking_id INTEGER
    REFERENCES bookings(id)
    ON DELETE SET NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS meeting_room_reservations_booking_id_idx
    ON meeting_room_reservations(booking_id)
  `);

  await pool.query("COMMIT");

  console.log(
    "Meeting-room booking link migration completed successfully.",
  );
} catch (error) {
  await pool
    .query("ROLLBACK")
    .catch(() => {});

  console.error(
    "Meeting-room booking link migration failed:",
    error,
  );

  process.exitCode = 1;
} finally {
  await pool.end();
}