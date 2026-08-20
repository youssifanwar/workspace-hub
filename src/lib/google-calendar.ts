import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { exec } from "node:child_process";
import { google } from "googleapis";

const APP_DATA_DIR = path.join(
  process.env.APPDATA ||
    path.join(
      os.homedir(),
      "AppData",
      "Roaming",
    ),
  "WorkSpace Hub",
);

const TOKEN_PATH = path.join(
  APP_DATA_DIR,
  "google-token.json",
);

type ElectronProcess = NodeJS.Process & {
  resourcesPath?: string;
};

function getCredentialsPath(): string {
  const electronProcess =
    process as ElectronProcess;

  const candidates = [
    process.env
      .GOOGLE_CREDENTIALS_PATH,

    path.join(
      process.cwd(),
      "credentials.json",
    ),

    electronProcess.resourcesPath
      ? path.join(
          electronProcess.resourcesPath,
          "credentials.json",
        )
      : null,
  ].filter(
    (
      value,
    ): value is string =>
      Boolean(value),
  );

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate)
    ) {
      return candidate;
    }
  }

  throw new Error(
    "Google credentials.json not found.",
  );
}

function ensureAppDataDir() {
  fs.mkdirSync(
    APP_DATA_DIR,
    {
      recursive: true,
    },
  );
}

function loadCredentials() {
  const credentialsPath =
    getCredentialsPath();

  const raw =
    fs.readFileSync(
      credentialsPath,
      "utf8",
    );

  const json = JSON.parse(raw);

  const config =
    json.installed ||
    json.web;

  if (!config) {
    throw new Error(
      "Invalid Google OAuth credentials.json",
    );
  }

  if (
    !config.client_id ||
    !config.client_secret
  ) {
    throw new Error(
      "Google OAuth client credentials are incomplete.",
    );
  }

  return {
    clientId: config.client_id as string,
    clientSecret:
      config.client_secret as string,
  };
}

// -----------------------------------------------------------------------------
// CREATE OAUTH CLIENT
//
// We intentionally do NOT import OAuth2Client from google-auth-library.
// This avoids the duplicate google-auth-library type conflict.
// -----------------------------------------------------------------------------

export function createOAuthClient(
  redirectUri: string,
) {
  const {
    clientId,
    clientSecret,
  } = loadCredentials();

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri,
  );
}

// -----------------------------------------------------------------------------
// TOKEN
// -----------------------------------------------------------------------------

export function hasGoogleToken(): boolean {
  return fs.existsSync(
    TOKEN_PATH,
  );
}

export function loadGoogleToken(): Record<
  string,
  unknown
> | null {
  if (
    !fs.existsSync(TOKEN_PATH)
  ) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        TOKEN_PATH,
        "utf8",
      ),
    ) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function saveGoogleToken(
  tokens: Record<string, unknown>,
) {
  ensureAppDataDir();

  fs.writeFileSync(
    TOKEN_PATH,
    JSON.stringify(
      tokens,
      null,
      2,
    ),
    "utf8",
  );
}

export function disconnectGoogleCalendar() {
  try {
    if (
      fs.existsSync(TOKEN_PATH)
    ) {
      fs.unlinkSync(
        TOKEN_PATH,
      );
    }
  } catch {
    // Ignore cleanup errors.
  }
}

// -----------------------------------------------------------------------------
// AUTHENTICATED CLIENT
// -----------------------------------------------------------------------------

export function getAuthenticatedClient() {
  const token =
    loadGoogleToken();

  if (!token) {
    return null;
  }

  const client =
    createOAuthClient(
      "http://127.0.0.1",
    );

  client.setCredentials(token);

  return client;
}

// -----------------------------------------------------------------------------
// STATUS
// -----------------------------------------------------------------------------

export async function getGoogleCalendarStatus() {
  const client =
    getAuthenticatedClient();

  if (!client) {
    return {
      connected: false,
      email: null,
    };
  }

  try {
    const calendar =
      google.calendar({
        version: "v3",
        auth: client,
      });

    const primary =
      await calendar.calendarList.get(
        {
          calendarId: "primary",
        },
      );

    return {
      connected: true,
      email:
        primary.data.id ??
        null,
    };
  } catch (error) {
    console.error(
      "Google Calendar status check failed:",
      error,
    );

    return {
      connected: false,
      email: null,
    };
  }
}

// -----------------------------------------------------------------------------
// OPEN BROWSER
// -----------------------------------------------------------------------------

function openBrowser(
  url: string,
) {
  const command =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform ===
          "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  exec(command);
}

// -----------------------------------------------------------------------------
// OAUTH STATE
// -----------------------------------------------------------------------------

let activeOAuthServer:
  | http.Server
  | null = null;

let activeOAuthState:
  | string
  | null = null;

// -----------------------------------------------------------------------------
// START GOOGLE AUTHORIZATION
// -----------------------------------------------------------------------------

export async function startGoogleAuthorization() {
  // Prevent two login windows at the same time.
  if (activeOAuthServer) {
    throw new Error(
      "Google authorization is already in progress.",
    );
  }

  const state =
    crypto.randomUUID();

  activeOAuthState =
    state;

  const server =
    http.createServer();

  activeOAuthServer =
    server;

  await new Promise<void>(
    (
      resolve,
      reject,
    ) => {
      server.once(
        "error",
        reject,
      );

      server.listen(
        0,
        "127.0.0.1",
        () => resolve(),
      );
    },
  );

  const address =
    server.address();

  if (
    !address ||
    typeof address ===
      "string"
  ) {
    server.close();

    activeOAuthServer =
      null;

    activeOAuthState =
      null;

    throw new Error(
      "Could not start local OAuth server.",
    );
  }

  const port =
    address.port;

  const redirectUri =
    `http://127.0.0.1:${port}`;

  const client =
    createOAuthClient(
      redirectUri,
    );

  const authUrl =
    client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/calendar",
      ],
      state,
    });

  server.on(
    "request",
    async (
      req,
      res,
    ) => {
      try {
        const requestUrl =
          new URL(
            req.url || "/",
            `http://127.0.0.1:${port}`,
          );

        const code =
          requestUrl.searchParams.get(
            "code",
          );

        const returnedState =
          requestUrl.searchParams.get(
            "state",
          );

        const oauthError =
          requestUrl.searchParams.get(
            "error",
          );

        // ---------------------------------------------------------------
        // USER CANCELLED
        // ---------------------------------------------------------------

        if (oauthError) {
          res.writeHead(
            400,
            {
              "Content-Type":
                "text/html; charset=utf-8",
            },
          );

          res.end(`
            <!doctype html>
            <html>
              <body style="
                font-family:Segoe UI,Arial,sans-serif;
                text-align:center;
                padding:60px;
              ">
                <h1>
                  ❌ Google Calendar connection cancelled
                </h1>

                <p>
                  You can close this window.
                </p>
              </body>
            </html>
          `);

          setTimeout(
            () => {
              server.close();

              activeOAuthServer =
                null;

              activeOAuthState =
                null;
            },
            300,
          );

          return;
        }

        // ---------------------------------------------------------------
        // STATE / CODE VALIDATION
        // ---------------------------------------------------------------

        if (
          !code ||
          !returnedState ||
          returnedState !==
            activeOAuthState
        ) {
          res.writeHead(
            400,
            {
              "Content-Type":
                "text/plain; charset=utf-8",
            },
          );

          res.end(
            "Invalid Google OAuth callback.",
          );

          setTimeout(
            () => {
              server.close();

              activeOAuthServer =
                null;

              activeOAuthState =
                null;
            },
            300,
          );

          return;
        }

        // ---------------------------------------------------------------
        // EXCHANGE CODE FOR TOKENS
        // ---------------------------------------------------------------

        const {
          tokens,
        } =
          await client.getToken(
            code,
          );

        client.setCredentials(
          tokens,
        );

        saveGoogleToken(
          tokens as Record<
            string,
            unknown
          >,
        );

        // ---------------------------------------------------------------
        // SUCCESS PAGE
        // ---------------------------------------------------------------

        res.writeHead(
          200,
          {
            "Content-Type":
              "text/html; charset=utf-8",
          },
        );

        res.end(`
          <!doctype html>
          <html>
            <head>
              <meta charset="utf-8">
              <title>WorkSpace Hub</title>
            </head>

            <body style="
              font-family:Segoe UI,Arial,sans-serif;
              display:grid;
              place-items:center;
              min-height:100vh;
              margin:0;
              background:#f8fafc;
            ">
              <div style="
                text-align:center;
                padding:40px;
              ">
                <div style="
                  font-size:64px;
                  margin-bottom:15px;
                ">
                  ✅
                </div>

                <h1>
                  Google Calendar connected
                </h1>

                <p>
                  You can close this window.
                </p>
              </div>
            </body>
          </html>
        `);

        setTimeout(
          () => {
            server.close();

            activeOAuthServer =
              null;

            activeOAuthState =
              null;
          },
          300,
        );
      } catch (error) {
        console.error(
          "Google OAuth callback error:",
          error,
        );

        res.writeHead(
          500,
          {
            "Content-Type":
              "text/html; charset=utf-8",
          },
        );

        res.end(`
          <!doctype html>
          <html>
            <body style="
              font-family:Segoe UI,Arial,sans-serif;
              text-align:center;
              padding:60px;
            ">
              <h1>
                ❌ Google Calendar connection failed
              </h1>

              <p>
                Please close this window and try again.
              </p>
            </body>
          </html>
        `);

        setTimeout(
          () => {
            server.close();

            activeOAuthServer =
              null;

            activeOAuthState =
              null;
          },
          300,
        );
      }
    },
  );

  openBrowser(authUrl);

  return {
    url: authUrl,
    port,
  };
}
// -----------------------------------------------------------------------------
// CALENDAR AVAILABILITY
// -----------------------------------------------------------------------------

export type BusyPeriod = {
  start: string;
  end: string;
};

export async function getCalendarBusyPeriods(
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<BusyPeriod[]> {
  const client =
    getAuthenticatedClient();

  if (!client) {
    throw new Error(
      "Google Calendar is not connected.",
    );
  }

  const calendar =
    google.calendar({
      version: "v3",
      auth: client,
    });

  const result =
    await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [
          {
            id: calendarId,
          },
        ],
      },
    });

  return (
    result.data.calendars?.[
      calendarId
    ]?.busy?.map(
      (period) => ({
        start:
          period.start!,
        end:
          period.end!,
      }),
    ) || []
  );
}

// -----------------------------------------------------------------------------
// CREATE EVENT
// -----------------------------------------------------------------------------

export async function createGoogleCalendarEvent(
  calendarId: string,
  input: {
    summary: string;
    description?: string;
    start: string;
    end: string;
    recurrenceRule?: string;
    recurrenceCount?: number;
  },
) {
  const client =
    getAuthenticatedClient();

  if (!client) {
    throw new Error(
      "Google Calendar is not connected.",
    );
  }

  const calendar =
    google.calendar({
      version: "v3",
      auth: client,
    });

  const event: {
    summary: string;
    description?: string;
    start: {
      dateTime: string;
      timeZone: string;
    };
    end: {
      dateTime: string;
      timeZone: string;
    };
    recurrence?: string[];
  } = {
    summary:
      input.summary,

    description:
      input.description,

    start: {
      dateTime:
        input.start,
      timeZone:
        "Africa/Cairo",
    },

    end: {
      dateTime:
        input.end,
      timeZone:
        "Africa/Cairo",
    },
  };

  if (
    input.recurrenceRule
  ) {
    event.recurrence = [
      input.recurrenceRule,
    ];
  }

  const result =
    await calendar.events.insert({
      calendarId,
      requestBody: event,
    });

  return {
    id:
      result.data.id || null,

    htmlLink:
      result.data.htmlLink ||
      null,
  };
}

// -----------------------------------------------------------------------------
// DELETE EVENT
// -----------------------------------------------------------------------------

export async function deleteGoogleCalendarEvent(
  calendarId: string,
  eventId: string,
) {
  const client =
    getAuthenticatedClient();

  if (!client) {
    throw new Error(
      "Google Calendar is not connected.",
    );
  }

  const calendar =
    google.calendar({
      version: "v3",
      auth: client,
    });

  await calendar.events.delete({
    calendarId,
    eventId,
  });
}