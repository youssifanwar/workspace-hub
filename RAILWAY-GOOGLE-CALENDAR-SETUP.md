# Railway Google Calendar OAuth fix

## Why this patch is needed

The current Google Calendar implementation treats a deployment as a web OAuth runtime only when `VERCEL_*` variables exist. Railway does not set those variables, so it falls back to the desktop/local `credentials.json` lookup and logs `Google credentials.json not found`.

This patch detects Railway and other deployments configured with `GOOGLE_REDIRECT_URI`, uses the web OAuth callback, and reads OAuth client credentials from environment variables. OAuth tokens continue to be stored encrypted in the existing `settings` table in Neon.

## Apply the patch

1. Stop any local server.
2. Extract this ZIP into the project root (the folder containing `package.json`). Merge `src/` and overwrite `src/lib/google-calendar.ts` when prompted.
3. Do not add `credentials.json`, `google-token.json`, or `.env.local` to Git.
4. Set the following variables in Railway → your `workspace-hub` service → Variables:

   - `GOOGLE_CLIENT_ID`: client ID from a Google OAuth **Web application** credential.
   - `GOOGLE_CLIENT_SECRET`: client secret from the same Web application credential.
   - `GOOGLE_REDIRECT_URI`: `https://workspace-hub-production.up.railway.app/api/google-calendar/auth`

   Optional but useful:

   - `APP_URL`: `https://workspace-hub-production.up.railway.app`

5. In Google Cloud Console → APIs & Services → Credentials → the same OAuth client, add this exact URI under **Authorized redirect URIs**:

   `https://workspace-hub-production.up.railway.app/api/google-calendar/auth`

6. Deploy/redeploy the service on Railway.
7. Open Settings on the deployed site and click **Connect Google Calendar**. Finish Google's consent screen. Then refresh Settings and confirm it says Connected.

## Security

- Do not paste `GOOGLE_CLIENT_SECRET`, `credentials.json`, or refresh tokens into chat or commit them to GitHub.
- Use a Web application OAuth client for the HTTPS callback, not a desktop/installed client.
- If the actual Railway domain changes, update both `GOOGLE_REDIRECT_URI` and the authorized redirect URI in Google Cloud to match exactly.

## Verification

After deploy, the auth logs should no longer say `Google credentials.json not found`. If it still fails, check the next error for missing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` or a Google `redirect_uri_mismatch`. Never share secret values when sharing logs.
