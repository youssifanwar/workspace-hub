import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { exec } from "node:child_process";
import { google } from "googleapis";

const ROOT = process.cwd();
const CREDENTIALS_PATH = path.join(
  ROOT,
  "credentials.json",
);

const TOKEN_PATH = path.join(
  ROOT,
  "google-token.json",
);

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
];

function openBrowser(url) {
  const command =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  exec(command);
}

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `credentials.json not found:\n${CREDENTIALS_PATH}`,
    );
  }

  const credentials = JSON.parse(
    fs.readFileSync(
      CREDENTIALS_PATH,
      "utf8",
    ),
  );

  const desktop =
    credentials.installed ||
    credentials.web;

  if (!desktop) {
    throw new Error(
      "Invalid Google OAuth credentials.json",
    );
  }

  const {
    client_id,
    client_secret,
    redirect_uris,
  } = desktop;

  const redirectUri =
    redirect_uris?.[0];

  if (
    !client_id ||
    !client_secret ||
    !redirectUri
  ) {
    throw new Error(
      "Google OAuth credentials are incomplete.",
    );
  }

  const oauth2Client =
    new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri,
    );

  // -------------------------------------------------------------------------
  // USE EXISTING TOKEN
  // -------------------------------------------------------------------------

  if (
    fs.existsSync(TOKEN_PATH)
  ) {
    const tokens = JSON.parse(
      fs.readFileSync(
        TOKEN_PATH,
        "utf8",
      ),
    );

    oauth2Client.setCredentials(
      tokens,
    );

    console.log(
      "Existing Google authorization found.",
    );
  } else {
    // -----------------------------------------------------------------------
    // FIRST AUTHORIZATION
    // -----------------------------------------------------------------------

    const server =
      http.createServer(
        async (
          req,
          res,
        ) => {
          try {
            const url =
              new URL(
                req.url,
                `http://${req.headers.host}`,
              );

            const code =
              url.searchParams.get(
                "code",
              );

            if (!code) {
              res.writeHead(
                400,
                {
                  "Content-Type":
                    "text/plain; charset=utf-8",
                },
              );

              res.end(
                "Authorization code is missing.",
              );

              return;
            }

            const {
              tokens,
            } =
              await oauth2Client.getToken(
                code,
              );

            oauth2Client.setCredentials(
              tokens,
            );

            fs.writeFileSync(
              TOKEN_PATH,
              JSON.stringify(
                tokens,
                null,
                2,
              ),
              "utf8",
            );

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
                ">
                  <div style="text-align:center">
                    <h1>✅ Google Calendar connected</h1>
                    <p>You can close this window.</p>
                  </div>
                </body>
              </html>
            `);

            server.close();
          } catch (error) {
            console.error(
              "OAuth callback failed:",
              error,
            );

            res.writeHead(
              500,
              {
                "Content-Type":
                  "text/plain; charset=utf-8",
              },
            );

            res.end(
              "Google authorization failed. Check the terminal.",
            );
          }
        },
      );

    await new Promise(
      (resolve) =>
        server.listen(
          0,
          "127.0.0.1",
          resolve,
        ),
    );

    const address =
      server.address();

    if (
      !address ||
      typeof address ===
        "string"
    ) {
      throw new Error(
        "Could not start local OAuth server.",
      );
    }

    const port =
      address.port;

    // We override the desktop redirect URI
    // with our temporary local callback.
    oauth2Client.redirectUri =
      `http://127.0.0.1:${port}`;

    const authUrl =
      oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
      });

    console.log("");
    console.log(
      "Opening Google authorization...",
    );
    console.log("");
    console.log(
      authUrl,
    );
    console.log("");

    openBrowser(authUrl);

    await new Promise(
      (resolve) => {
        const timer =
          setInterval(
            () => {
              if (
                server.listening ===
                false
              ) {
                clearInterval(
                  timer,
                );

                resolve();
              }
            },
            250,
          );
      },
    );
  }

  // -------------------------------------------------------------------------
  // TEST GOOGLE CALENDAR ACCESS
  // -------------------------------------------------------------------------

  const calendar =
    google.calendar({
      version: "v3",
      auth: oauth2Client,
    });

  const result =
    await calendar.calendarList.list();

  const calendars =
    result.data.items ||
    [];

  console.log("");
  console.log(
    "Google Calendar connection works.",
  );
  console.log("");

  if (
    calendars.length ===
    0
  ) {
    console.log(
      "No calendars were found.",
    );
  } else {
    console.log(
      "Available calendars:",
    );

    for (const calendar of calendars) {
      console.log(
        `- ${calendar.summary || "(no name)"}`,
      );

      console.log(
        `  ID: ${calendar.id}`,
      );

      console.log("");
    }
  }
}

main().catch((error) => {
  console.error("");
  console.error(
    "Google Calendar test failed:",
  );
  console.error(
    error?.message ||
      error,
  );

  process.exit(1);
});