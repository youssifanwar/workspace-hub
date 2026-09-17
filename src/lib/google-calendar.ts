import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { exec } from "node:child_process";

import { google } from "googleapis";

/* -------------------------------------------------------------------------- */
/* PATHS                                                                      */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* TYPES                                                                      */
/* -------------------------------------------------------------------------- */

type ElectronProcess =
  NodeJS.Process & {
    resourcesPath?: string;
  };

type GoogleToken =
  Record<string, unknown>;

type GoogleAuthorizationResult = {
  url: string;
  port: number;
};

/* -------------------------------------------------------------------------- */
/* GOOGLE CREDENTIALS                                                         */
/* -------------------------------------------------------------------------- */

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

  for (
    const candidate of candidates
  ) {
    if (
      fs.existsSync(
        candidate,
      )
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

function loadCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const credentialsPath =
    getCredentialsPath();

  const raw =
    fs.readFileSync(
      credentialsPath,
      "utf8",
    );

  let json: unknown;

  try {
    json =
      JSON.parse(
        raw,
      );
  } catch {
    throw new Error(
      "Google credentials.json contains invalid JSON.",
    );
  }

  if (
    !json ||
    typeof json !==
      "object"
  ) {
    throw new Error(
      "Invalid Google OAuth credentials.json.",
    );
  }

  const root =
    json as Record<
      string,
      unknown
    >;

  const config =
    (
      root.installed ??
      root.web
    ) as
      | Record<
          string,
          unknown
        >
      | undefined;

  if (!config) {
    throw new Error(
      "Invalid Google OAuth credentials.json.",
    );
  }

  const clientId =
    config.client_id;

  const clientSecret =
    config.client_secret;

  if (
    typeof clientId !==
      "string" ||
    !clientId ||
    typeof clientSecret !==
      "string" ||
    !clientSecret
  ) {
    throw new Error(
      "Google OAuth client credentials are incomplete.",
    );
  }

  return {
    clientId,
    clientSecret,
  };
}

/* -------------------------------------------------------------------------- */
/* OAUTH CLIENT                                                               */
/* -------------------------------------------------------------------------- */

export function createOAuthClient(
  redirectUri: string,
) {
  const {
    clientId,
    clientSecret,
  } =
    loadCredentials();

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri,
  );
}

/* -------------------------------------------------------------------------- */
/* TOKEN STORAGE                                                              */
/* -------------------------------------------------------------------------- */

export function hasGoogleToken(): boolean {
  return fs.existsSync(
    TOKEN_PATH,
  );
}

export function loadGoogleToken(): GoogleToken | null {
  if (
    !fs.existsSync(
      TOKEN_PATH,
    )
  ) {
    return null;
  }

  try {
    const raw =
      fs.readFileSync(
        TOKEN_PATH,
        "utf8",
      );

    const parsed =
      JSON.parse(
        raw,
      ) as unknown;

    if (
      !parsed ||
      typeof parsed !==
        "object"
    ) {
      return null;
    }

    return parsed as GoogleToken;
  } catch {
    return null;
  }
}

export function saveGoogleToken(
  tokens: GoogleToken,
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

function clearGoogleToken() {
  try {
    if (
      fs.existsSync(
        TOKEN_PATH,
      )
    ) {
      fs.unlinkSync(
        TOKEN_PATH,
      );
    }
  } catch (error) {
    console.error(
      "Could not clear Google token:",
      error,
    );
  }
}

export function disconnectGoogleCalendar() {
  clearGoogleToken();
}

/* -------------------------------------------------------------------------- */
/* TOKEN ERROR DETECTION                                                      */
/* -------------------------------------------------------------------------- */

function isInvalidGrantError(
  error: unknown,
): boolean {
  if (
    !error ||
    typeof error !==
      "object"
  ) {
    return false;
  }

  const candidate =
    error as {
      code?: unknown;
      message?: unknown;
      response?: {
        data?: {
          error?: unknown;
          error_description?: unknown;
        };
      };
    };

  if (
    candidate.code ===
    400
  ) {
    const responseError =
      candidate.response
        ?.data?.error;

    if (
      responseError ===
      "invalid_grant"
    ) {
      return true;
    }
  }

  const message =
    typeof candidate.message ===
    "string"
      ? candidate.message
      : "";

  if (
    message
      .toLowerCase()
      .includes(
        "invalid_grant",
      )
  ) {
    return true;
  }

  const responseError =
    candidate.response
      ?.data?.error;

  return (
    responseError ===
    "invalid_grant"
  );
}

/* -------------------------------------------------------------------------- */
/* AUTHENTICATED CLIENT                                                       */
/* -------------------------------------------------------------------------- */

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

  client.setCredentials(
    token,
  );

  /*
   * Google can return a new access token using the refresh token.
   * Persist it so subsequent requests use the newest credentials.
   */
  client.on(
    "tokens",
    (newTokens) => {
      try {
        const currentToken =
          loadGoogleToken() ??
          {};

        saveGoogleToken({
          ...currentToken,
          ...newTokens,
        });
      } catch (error) {
        console.error(
          "Could not persist refreshed Google tokens:",
          error,
        );
      }
    },
  );

  return client;
}

/* -------------------------------------------------------------------------- */
/* STATUS                                                                     */
/* -------------------------------------------------------------------------- */

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
          calendarId:
            "primary",
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

    /*
     * invalid_grant means the saved OAuth credentials are no longer valid.
     * Remove them so the next connection starts a completely fresh OAuth flow.
     */
    if (
      isInvalidGrantError(
        error,
      )
    ) {
      clearGoogleToken();
    }

    return {
      connected: false,
      email: null,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* OPEN BROWSER                                                               */
/* -------------------------------------------------------------------------- */

function openBrowser(
  url: string,
) {
  const command =
    process.platform ===
    "win32"
      ? `start "" "${url}"`
      : process.platform ===
          "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  exec(
    command,
    (error) => {
      if (error) {
        console.error(
          "Could not open browser automatically:",
          error,
        );
      }
    },
  );
}

/* -------------------------------------------------------------------------- */
/* OAUTH STATE                                                                */
/* -------------------------------------------------------------------------- */

let activeOAuthServer:
  | http.Server
  | null = null;

let activeOAuthState:
  | string
  | null = null;

/* -------------------------------------------------------------------------- */
/* CLEANUP OAUTH SERVER                                                       */
/* -------------------------------------------------------------------------- */

function cleanupOAuthServer(
  server: http.Server,
) {
  try {
    server.close();
  } catch {
    // Ignore cleanup errors.
  }

  if (
    activeOAuthServer ===
    server
  ) {
    activeOAuthServer =
      null;
  }

  activeOAuthState =
    null;
}

/* -------------------------------------------------------------------------- */
/* START GOOGLE AUTHORIZATION                                                 */
/* -------------------------------------------------------------------------- */

export async function startGoogleAuthorization(): Promise<GoogleAuthorizationResult> {
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

  try {
    await new Promise<void>(
      (
        resolve,
        reject,
      ) => {
        const onError =
          (
            error: Error,
          ) => {
            server.off(
              "listening",
              onListening,
            );

            reject(error);
          };

        const onListening =
          () => {
            server.off(
              "error",
              onError,
            );

            resolve();
          };

        server.once(
          "error",
          onError,
        );

        server.once(
          "listening",
          onListening,
        );

        server.listen(
          0,
          "127.0.0.1",
        );
      },
    );
  } catch (error) {
    cleanupOAuthServer(
      server,
    );

    throw error;
  }

  const address =
    server.address();

  if (
    !address ||
    typeof address ===
      "string"
  ) {
    cleanupOAuthServer(
      server,
    );

    throw new Error(
      "Could not start local OAuth server.",
    );
  }

  const port =
    address.port;

  const redirectUri =
    `http://127.0.0.1:${port}`;

  let client;

  try {
    client =
      createOAuthClient(
        redirectUri,
      );
  } catch (error) {
    cleanupOAuthServer(
      server,
    );

    throw error;
  }

  const authUrl =
    client.generateAuthUrl({
      access_type:
        "offline",

      prompt:
        "consent",

      include_granted_scopes:
        true,

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
            req.url ||
              "/",
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

        /* -------------------------------------------------------------- */
        /* USER CANCELLED                                                  */
        /* -------------------------------------------------------------- */

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
              <head>
                <meta charset="utf-8">
                <title>WorkSpace Hub</title>
              </head>
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

          cleanupOAuthServer(
            server,
          );

          return;
        }

        /* -------------------------------------------------------------- */
        /* STATE / CODE VALIDATION                                        */
        /* -------------------------------------------------------------- */

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

          cleanupOAuthServer(
            server,
          );

          return;
        }

        /* -------------------------------------------------------------- */
        /* EXCHANGE CODE FOR TOKENS                                      */
        /* -------------------------------------------------------------- */

        const {
          tokens,
        } =
          await client.getToken(
            code,
          );

        if (
          !tokens ||
          !tokens.access_token
        ) {
          throw new Error(
            "Google OAuth did not return a valid access token.",
          );
        }

        client.setCredentials(
          tokens,
        );

        saveGoogleToken(
          tokens as GoogleToken,
        );

        /* -------------------------------------------------------------- */
        /* SUCCESS PAGE                                                   */
        /* -------------------------------------------------------------- */

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

        cleanupOAuthServer(
          server,
        );
      } catch (error) {
        console.error(
          "Google OAuth callback error:",
          error,
        );

        if (
          isInvalidGrantError(
            error,
          )
        ) {
          clearGoogleToken();
        }

        try {
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
              <head>
                <meta charset="utf-8">
                <title>WorkSpace Hub</title>
              </head>

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
        } catch {
          // Ignore response errors.
        }

        cleanupOAuthServer(
          server,
        );
      }
    },
  );

  openBrowser(
    authUrl,
  );

  return {
    url: authUrl,
    port,
  };
}

/* -------------------------------------------------------------------------- */
/* CALENDAR AVAILABILITY                                                       */
/* -------------------------------------------------------------------------- */

export type BusyPeriod = {
  start: string;
  end: string;
};

export async function getCalendarBusyPeriods(
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<BusyPeriod[]> {
  if (
    !calendarId ||
    !timeMin ||
    !timeMax
  ) {
    throw new Error(
      "calendarId, timeMin and timeMax are required.",
    );
  }

  const start =
    new Date(
      timeMin,
    );

  const end =
    new Date(
      timeMax,
    );

  if (
    Number.isNaN(
      start.getTime(),
    ) ||
    Number.isNaN(
      end.getTime(),
    )
  ) {
    throw new Error(
      "Invalid calendar time range.",
    );
  }

  if (
    start >= end
  ) {
    throw new Error(
      "timeMin must be before timeMax.",
    );
  }

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

  try {
    const result =
      await calendar.freebusy.query({
        requestBody: {
          timeMin:
            start.toISOString(),

          timeMax:
            end.toISOString(),

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
      ]?.busy?.flatMap(
        (
          period,
        ) => {
          if (
            !period.start ||
            !period.end
          ) {
            return [];
          }

          return [
            {
              start:
                period.start,
              end:
                period.end,
            },
          ];
        },
      ) ?? []
    );
  } catch (error) {
    if (
      isInvalidGrantError(
        error,
      )
    ) {
      clearGoogleToken();
    }

    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* CREATE EVENT                                                               */
/* -------------------------------------------------------------------------- */

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
  if (
    !calendarId
  ) {
    throw new Error(
      "calendarId is required.",
    );
  }

  const summary =
    input.summary.trim();

  if (!summary) {
    throw new Error(
      "Calendar event summary is required.",
    );
  }

  const start =
    new Date(
      input.start,
    );

  const end =
    new Date(
      input.end,
    );

  if (
    Number.isNaN(
      start.getTime(),
    ) ||
    Number.isNaN(
      end.getTime(),
    )
  ) {
    throw new Error(
      "Invalid calendar event time.",
    );
  }

  if (
    start >= end
  ) {
    throw new Error(
      "Calendar event start must be before end.",
    );
  }

  if (
    input.recurrenceCount !==
      undefined &&
    (
      !Number.isSafeInteger(
        input.recurrenceCount,
      ) ||
      input.recurrenceCount <=
        0
    )
  ) {
    throw new Error(
      "Invalid recurrence count.",
    );
  }

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
    summary,

    description:
      input.description?.trim() ||
      undefined,

    start: {
      dateTime:
        start.toISOString(),

      timeZone:
        "Africa/Cairo",
    },

    end: {
      dateTime:
        end.toISOString(),

      timeZone:
        "Africa/Cairo",
    },
  };

  if (
    input.recurrenceRule
  ) {
    const rule =
      input.recurrenceRule.trim();

    if (!rule) {
      throw new Error(
        "Invalid recurrence rule.",
      );
    }

    event.recurrence = [
      rule,
    ];
  }

  try {
    const result =
      await calendar.events.insert({
        calendarId,

        requestBody:
          event,
      });

    return {
      id:
        result.data.id ??
        null,

      htmlLink:
        result.data.htmlLink ??
        null,
    };
  } catch (error) {
    if (
      isInvalidGrantError(
        error,
      )
    ) {
      clearGoogleToken();
    }

    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* DELETE EVENT                                                               */
/* -------------------------------------------------------------------------- */

export async function deleteGoogleCalendarEvent(
  calendarId: string,
  eventId: string,
) {
  if (
    !calendarId
  ) {
    throw new Error(
      "calendarId is required.",
    );
  }

  if (
    !eventId
  ) {
    throw new Error(
      "eventId is required.",
    );
  }

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

  try {
    await calendar.events.delete(
      {
        calendarId,
        eventId,
      },
    );
  } catch (error) {
    if (
      isInvalidGrantError(
        error,
      )
    ) {
      clearGoogleToken();
    }

    throw error;
  }
}