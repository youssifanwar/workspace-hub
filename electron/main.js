/* eslint-disable @typescript-eslint/no-require-imports */

const {
  app,
  BrowserWindow,
  Menu,
  shell,
  dialog,
  ipcMain,
} = require("electron");

const path = require("path");
const fs = require("fs");
const { spawn, execFileSync } = require("child_process");
const crypto = require("crypto");
const waitOn = require("wait-on");

// -----------------------------------------------------------------------------
// WorkSpace Hub — Electron main process
// -----------------------------------------------------------------------------

const PORT = process.env.WSH_PORT
  ? parseInt(process.env.WSH_PORT, 10)
  : 39217;

// LAN access for QR ordering
const BIND_HOST = "0.0.0.0";

// Desktop app uses localhost
const LOCAL_HOST = "127.0.0.1";

const URL = `http://${LOCAL_HOST}:${PORT}`;

// Embedded PostgreSQL
// IMPORTANT: 39229 is the port used by the existing WorkSpace Hub database.
const DB_PORT = process.env.WSH_DB_PORT
  ? parseInt(process.env.WSH_DB_PORT, 10)
  : 39229;

const DB_NAME = "workspace_hub";
const DB_USER = "postgres";

let serverProcess = null;
let mainWindow = null;
let splashWindow = null;

// -----------------------------------------------------------------------------
// RESOURCE HELPERS
// -----------------------------------------------------------------------------

function resolveResource(...segments) {
  const packagedPath = path.join(
    process.resourcesPath || "",
    ...segments,
  );

  if (fs.existsSync(packagedPath)) {
    return packagedPath;
  }

  return path.join(
    app.getAppPath(),
    ...segments,
  );
}

// -----------------------------------------------------------------------------
// ENV FILE HELPERS
// -----------------------------------------------------------------------------

function readEnvFile(envPath) {
  const env = {};

  if (!fs.existsSync(envPath)) {
    return env;
  }

  const raw = fs.readFileSync(
    envPath,
    "utf8",
  );

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const eq = line.indexOf("=");

    if (eq < 0) {
      continue;
    }

    const key = line
      .slice(0, eq)
      .trim();

    let value = line
      .slice(eq + 1)
      .trim();

    if (
      (value.startsWith('"') &&
        value.endsWith('"')) ||
      (value.startsWith("'") &&
        value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function getRuntimeEnv() {
  const bundledEnv = readEnvFile(
    resolveResource(
      "app",
      ".env",
    ),
  );

  const userEnvPath = path.join(
    app.getPath("userData"),
    ".env",
  );

  const userEnv = readEnvFile(
    userEnvPath,
  );

  return {
    ...bundledEnv,
    ...userEnv,
    ...process.env,
  };
}

// -----------------------------------------------------------------------------
// COMMAND EXECUTION
// -----------------------------------------------------------------------------

function run(
  exe,
  args,
  options = {},
) {
  return execFileSync(
    exe,
    args,
    {
      windowsHide: true,
      encoding: "utf8",
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
      ...options,
    },
  );
}

// -----------------------------------------------------------------------------
// SPLASH SCREEN
// -----------------------------------------------------------------------------

function createSplash() {
  splashWindow =
    new BrowserWindow({
      width: 480,
      height: 320,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,

      webPreferences: {
        contextIsolation: true,
      },
    });

  const splashHtml =
    `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
<head>
<meta charset="utf-8">

<style>

html,
body {
  margin: 0;
  height: 100%;
  font-family: 'Segoe UI', system-ui, sans-serif;
  color: #fff;
  overflow: hidden;
}

body {
  display: grid;
  place-items: center;
  background:
    linear-gradient(
      135deg,
      #6366f1 0%,
      #4f46e5 40%,
      #06b6d4 100%
    );
}

.card {
  text-align: center;
  padding: 32px;
}

.logo {
  font-size: 64px;
  margin-bottom: 8px;
}

h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: .3px;
}

p {
  margin: 8px 0 24px;
  opacity: .85;
  font-size: 13px;
}

.bar {
  width: 220px;
  height: 6px;
  background: rgba(255,255,255,.25);
  border-radius: 999px;
  overflow: hidden;
  margin: 0 auto;
}

.bar::after {
  content: '';
  display: block;
  width: 40%;
  height: 100%;
  background: #fff;
  border-radius: 999px;
  animation: l 1.2s ease-in-out infinite;
}

@keyframes l {
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(320%);
  }
}

</style>
</head>

<body>

<div class="card">

  <div class="logo">🏢</div>

  <h1>WorkSpace Hub</h1>

  <p>Starting your workspace…</p>

  <div class="bar"></div>

</div>

</body>
</html>
`)}`;

  splashWindow.loadURL(
    splashHtml,
  );

  splashWindow.on(
    "closed",
    () => {
      splashWindow = null;
    },
  );
}

// -----------------------------------------------------------------------------
// DATABASE PATHS
// -----------------------------------------------------------------------------

function dbPaths() {
  const dataDir =
    path.join(
      app.getPath("userData"),
      "postgres-data",
    );

  const configPath =
    path.join(
      app.getPath("userData"),
      "database.json",
    );

  const pgRoot =
    resolveResource(
      "runtime",
      "postgresql",
    );

  const bin =
    path.join(
      pgRoot,
      "bin",
    );

  return {
    dataDir,

    configPath,

    schemaPath:
      resolveResource(
        "runtime",
        "schema.sql",
      ),

    initdb:
      path.join(
        bin,
        "initdb.exe",
      ),

    pgCtl:
      path.join(
        bin,
        "pg_ctl.exe",
      ),

    psql:
      path.join(
        bin,
        "psql.exe",
      ),

    createdb:
      path.join(
        bin,
        "createdb.exe",
      ),
  };
}

// -----------------------------------------------------------------------------
// DATABASE CONFIG
// -----------------------------------------------------------------------------

function readDbConfig(
  configPath,
) {
  try {
    return JSON.parse(
      fs.readFileSync(
        configPath,
        "utf8",
      ),
    );
  } catch {
    return null;
  }
}

function ensureDbConfig(
  configPath,
) {
  let cfg =
    readDbConfig(
      configPath,
    );

  if (
    !cfg ||
    !cfg.password
  ) {
    cfg = {
      password:
        crypto.randomBytes(
          24,
        ).toString("hex"),
    };

    fs.mkdirSync(
      path.dirname(
        configPath,
      ),
      {
        recursive: true,
      },
    );

    fs.writeFileSync(
      configPath,
      JSON.stringify(
        cfg,
        null,
        2,
      ),
      {
        mode: 0o600,
      },
    );
  }

  return cfg;
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms,
      ),
  );
}

// -----------------------------------------------------------------------------
// WAIT FOR POSTGRESQL
// -----------------------------------------------------------------------------

async function waitForDb(
  psql,
  password,
) {
  const env = {
    ...process.env,
    PGPASSWORD:
      password,
  };

  const deadline =
    Date.now() +
    30_000;

  while (
    Date.now() <
    deadline
  ) {
    try {
      run(
        psql,
        [
          "-h",
          LOCAL_HOST,

          "-p",
          String(
            DB_PORT,
          ),

          "-U",
          DB_USER,

          "-d",
          "postgres",

          "-c",
          "select 1",
        ],
        {
          env,
        },
      );

      return;
    } catch {
      await sleep(300);
    }
  }

  throw new Error(
    `PostgreSQL did not become ready on port ${DB_PORT}`,
  );
}

// -----------------------------------------------------------------------------
// ENSURE EMBEDDED POSTGRESQL
// -----------------------------------------------------------------------------

async function ensurePostgres() {
  const p =
    dbPaths();

  for (
    const file of [
      p.initdb,
      p.pgCtl,
      p.psql,
      p.createdb,
      p.schemaPath,
    ]
  ) {
    if (
      !fs.existsSync(
        file,
      )
    ) {
      throw new Error(
        `WorkSpace Hub runtime file is missing:\n${file}`,
      );
    }
  }

  const cfg =
    ensureDbConfig(
      p.configPath,
    );

  const env = {
    ...process.env,
    PGPASSWORD:
      cfg.password,
  };

  fs.mkdirSync(
    path.dirname(
      p.dataDir,
    ),
    {
      recursive: true,
    },
  );

  const isInitialized =
    fs.existsSync(
      path.join(
        p.dataDir,
        "PG_VERSION",
      ),
    );

  // ---------------------------------------------------------------------------
  // INITIALIZE DATABASE CLUSTER
  // ---------------------------------------------------------------------------

  if (
    !isInitialized
  ) {
    fs.mkdirSync(
      p.dataDir,
      {
        recursive: true,
      },
    );

    const pwFile =
      path.join(
        app.getPath(
          "temp",
        ),
        `wsh-pg-${process.pid}.txt`,
      );

    fs.writeFileSync(
      pwFile,
      cfg.password,
      "utf8",
    );

    try {
      run(
        p.initdb,
        [
          "-D",
          p.dataDir,

          "-U",
          DB_USER,

          "-A",
          "scram-sha-256",

          "-E",
          "UTF8",

          "--pwfile=" +
            pwFile,
        ],
      );
    } finally {
      try {
        fs.unlinkSync(
          pwFile,
        );
      } catch {}
    }
  }

  // ---------------------------------------------------------------------------
  // CHECK WHETHER POSTGRES IS ALREADY RUNNING
  // ---------------------------------------------------------------------------

  try {
    run(
      p.psql,
      [
        "-h",
        LOCAL_HOST,

        "-p",
        String(
          DB_PORT,
        ),

        "-U",
        DB_USER,

        "-d",
        "postgres",

        "-c",
        "select 1",
      ],
      {
        env,
      },
    );
  } catch {
    run(
      p.pgCtl,
      [
        "-D",
        p.dataDir,

        "-o",
        `-p ${DB_PORT} -h ${LOCAL_HOST}`,

        "-w",
        "start",
      ],
      {
        env,
      },
    );
  }

  await waitForDb(
    p.psql,
    cfg.password,
  );

  // ---------------------------------------------------------------------------
  // CREATE DATABASE IF NEEDED
  // ---------------------------------------------------------------------------

  const dbExists =
    run(
      p.psql,
      [
        "-h",
        LOCAL_HOST,

        "-p",
        String(
          DB_PORT,
        ),

        "-U",
        DB_USER,

        "-d",
        "postgres",

        "-tAc",

        `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`,
      ],
      {
        env,
      },
    ).trim() === "1";

  if (!dbExists) {
    run(
      p.createdb,
      [
        "-h",
        LOCAL_HOST,

        "-p",
        String(
          DB_PORT,
        ),

        "-U",
        DB_USER,

        DB_NAME,
      ],
      {
        env,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // CREATE TABLES IF NEEDED
  // ---------------------------------------------------------------------------

  const tableExists =
    run(
      p.psql,
      [
        "-h",
        LOCAL_HOST,

        "-p",
        String(
          DB_PORT,
        ),

        "-U",
        DB_USER,

        "-d",
        DB_NAME,

        "-tAc",

        "SELECT 1 FROM pg_class WHERE relname='users' AND relkind='r'",
      ],
      {
        env,
      },
    ).trim() === "1";

  if (!tableExists) {
    run(
      p.psql,
      [
        "-h",
        LOCAL_HOST,

        "-p",
        String(
          DB_PORT,
        ),

        "-U",
        DB_USER,

        "-d",
        DB_NAME,

        "-v",
        "ON_ERROR_STOP=1",

        "-f",
        p.schemaPath,
      ],
      {
        env,
      },
    );
  }

  return (
    `postgresql://${DB_USER}:` +
    `${encodeURIComponent(
      cfg.password,
    )}` +
    `@${LOCAL_HOST}:` +
    `${DB_PORT}/` +
    `${DB_NAME}`
  );
}

// -----------------------------------------------------------------------------
// STOP POSTGRESQL
// -----------------------------------------------------------------------------

function stopPostgres() {
  try {
    const p =
      dbPaths();

    const pidFile =
      path.join(
        p.dataDir,
        "postmaster.pid",
      );

    if (
      fs.existsSync(
        pidFile,
      )
    ) {
      run(
        p.pgCtl,
        [
          "-D",
          p.dataDir,

          "-m",
          "fast",

          "-w",
          "stop",
        ],
      );
    }
  } catch (err) {
    console.error(
      "[postgres] stop failed",
      err,
    );
  }
}

// -----------------------------------------------------------------------------
// START NEXT.JS SERVER
// -----------------------------------------------------------------------------

function startNextServer(
  databaseUrl,
) {
  return new Promise(
    (resolve, reject) => {
      let serverScript;
      let cwd;

      if (
        app.isPackaged
      ) {
        serverScript =
          resolveResource(
            "app",
            ".next",
            "standalone",
            "server.js",
          );

        cwd =
          resolveResource(
            "app",
          );
      } else {
        serverScript =
          path.join(
            app.getAppPath(),
            ".next",
            "standalone",
            "server.js",
          );

        cwd =
          app.getAppPath();
      }

      if (
        !fs.existsSync(
          serverScript,
        )
      ) {
        return reject(
          new Error(
            `Next.js standalone server not found at:\n${serverScript}\n\nDid you run "npm run electron:build"?`,
          ),
        );
      }

      const runtimeEnv =
        getRuntimeEnv();

      serverProcess =
        spawn(
          process.execPath,
          [
            serverScript,
          ],
          {
            cwd,

            env: {
              ...runtimeEnv,

              DATABASE_URL:
                databaseUrl,

              PORT:
                String(
                  PORT,
                ),

              HOSTNAME:
                BIND_HOST,

              NODE_ENV:
                "production",

              ELECTRON_RUN_AS_NODE:
                "1",
            },

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          },
        );

      serverProcess.stdout.on(
        "data",
        (chunk) => {
          process.stdout.write(
            `[server] ${chunk}`,
          );
        },
      );

      serverProcess.stderr.on(
        "data",
        (chunk) => {
          process.stderr.write(
            `[server] ${chunk}`,
          );
        },
      );

      serverProcess.on(
        "exit",
        (code) => {
          console.log(
            `[server] exited with code ${code}`,
          );

          serverProcess =
            null;
        },
      );

      waitOn({
        resources: [
          `${URL}/api/health`,
        ],

        timeout:
          30_000,

        interval:
          300,

        validateStatus:
          (status) =>
            status === 200,
      })
        .then(
          resolve,
        )
        .catch(
          reject,
        );
    },
  );
}

// -----------------------------------------------------------------------------
// MAIN WINDOW
// -----------------------------------------------------------------------------

function createMainWindow() {
  mainWindow =
    new BrowserWindow({
      width: 1440,
      height: 900,

      minWidth: 1100,
      minHeight: 720,

      show: false,

      backgroundColor:
        "#0b1020",

      autoHideMenuBar:
        true,

      title:
        "WorkSpace Hub",

      icon:
        path.join(
          __dirname,
          "icon.png",
        ),

      webPreferences: {
        contextIsolation:
          true,

        nodeIntegration:
          false,

        sandbox:
          false,

        preload:
          path.join(
            __dirname,
            "preload.js",
          ),
      },
    });

  mainWindow.loadURL(
    URL,
  );

  mainWindow.once(
    "ready-to-show",
    () => {
      if (
        splashWindow
      ) {
        splashWindow.close();
      }

      mainWindow.show();

      if (
        process.env
          .WSH_DEVTOOLS ===
        "1"
      ) {
        mainWindow.webContents.openDevTools();
      }
    },
  );

  mainWindow.webContents.setWindowOpenHandler(
    ({ url }) => {
      shell.openExternal(
        url,
      );

      return {
        action:
          "deny",
      };
    },
  );

  mainWindow.on(
    "closed",
    () => {
      mainWindow =
        null;
    },
  );

  const template = [
    {
      label:
        "&File",

      submenu: [
        {
          label:
            "Reload",

          accelerator:
            "CmdOrCtrl+R",

          click: () =>
            mainWindow?.reload(),
        },

        {
          label:
            "Print current page",

          accelerator:
            "CmdOrCtrl+P",

          click: () =>
            mainWindow?.webContents.print(),
        },

        {
          type:
            "separator",
        },

        {
          role:
            "quit",
        },
      ],
    },

    {
      label:
        "&View",

      submenu: [
        {
          role:
            "togglefullscreen",
        },

        {
          role:
            "zoomIn",
        },

        {
          role:
            "zoomOut",
        },

        {
          role:
            "resetZoom",
        },
      ],
    },

    {
      label:
        "&Help",

      submenu: [
        {
          label:
            "About WorkSpace Hub",

          click: () =>
            dialog.showMessageBox(
              {
                type:
                  "info",

                title:
                  "About",

                message:
                  "WorkSpace Hub",

                detail:
                  "Modern coworking / workspace management system.\nVersion 1.1.0",
              },
            ),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      template,
    ),
  );
}

// -----------------------------------------------------------------------------
// PRINTER DISCOVERY
// -----------------------------------------------------------------------------

ipcMain.handle(
  "wsh:list-printers",
  async () => {
    if (!mainWindow) {
      return [];
    }

    try {
      const printers =
        await mainWindow.webContents.getPrintersAsync();

      return printers.map(
        (p) => p.name,
      );
    } catch (err) {
      console.error(
        "listPrinters error",
        err,
      );

      return [];
    }
  },
);

// -----------------------------------------------------------------------------
// SILENT PRINTING
// -----------------------------------------------------------------------------

ipcMain.handle(
  "wsh:silent-print",
  async (
    _evt,
    opts,
  ) => {
    const {
      html,
      printerName,
      copies,
    } = opts || {};

    if (!html) {
      return {
        ok: false,
        error:
          "No HTML",
      };
    }

    const printWindow =
      new BrowserWindow({
        show: false,

        webPreferences: {
          contextIsolation:
            true,

          sandbox:
            true,
        },
      });

    try {
      const dataUrl =
        `data:text/html;charset=utf-8,${encodeURIComponent(
          html,
        )}`;

      await printWindow.loadURL(
        dataUrl,
      );

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            200,
          ),
      );

      const result =
        await new Promise(
          (resolve) => {
            printWindow.webContents.print(
              {
                silent:
                  true,

                printBackground:
                  true,

                deviceName:
                  printerName ||
                  undefined,

                copies:
                  Math.max(
                    1,
                    Number(
                      copies,
                    ) || 1,
                  ),

                margins: {
                  marginType:
                    "none",
                },
              },

              (
                success,
                failureReason,
              ) => {
                resolve({
                  ok:
                    !!success,

                  error:
                    failureReason ||
                    null,
                });
              },
            );
          },
        );

      return result;
    } catch (err) {
      return {
        ok: false,

        error:
          String(
            err?.message ||
              err,
          ),
      };
    } finally {
      setTimeout(
        () => {
          try {
            printWindow.destroy();
          } catch {}
        },
        500,
      );
    }
  },
);

// -----------------------------------------------------------------------------
// BOOTSTRAP
// -----------------------------------------------------------------------------

async function bootstrap() {
  try {
    createSplash();

    // Start embedded PostgreSQL
    const databaseUrl =
      await ensurePostgres();

    // Start Next.js with generated DATABASE_URL
    await startNextServer(
      databaseUrl,
    );

    // Open desktop application
    createMainWindow();
  } catch (err) {
    console.error(
      err,
    );

    if (
      splashWindow
    ) {
      splashWindow.close();
    }

    dialog.showErrorBox(
      "Could not start WorkSpace Hub",
      String(
        err?.message ||
          err,
      ),
    );

    stopPostgres();

    app.quit();
  }
}

// -----------------------------------------------------------------------------
// SINGLE INSTANCE
// -----------------------------------------------------------------------------

const gotLock =
  app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on(
    "second-instance",
    () => {
      if (mainWindow) {
        if (
          mainWindow.isMinimized()
        ) {
          mainWindow.restore();
        }

        mainWindow.focus();
      }
    },
  );

  app.whenReady().then(
    bootstrap,
  );

  app.on(
    "before-quit",
    () => {
      if (
        serverProcess
      ) {
        try {
          serverProcess.kill();
        } catch {}
      }

      stopPostgres();
    },
  );

  app.on(
    "window-all-closed",
    () => {
      if (
        serverProcess
      ) {
        try {
          serverProcess.kill();
        } catch {}
      }

      stopPostgres();

      app.quit();
    },
  );
}