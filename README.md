# eAI

eAI is a public browser UI with a separate, private Codespace API broker. The
website is only a renderer: it never contains service credentials. This starter
intentionally does **not** provide arbitrary shell access, Windows/PowerShell
connectors, filesystem editing, Git writes, or an unrestricted LLM proxy.

## Run in GitHub Codespaces

1. Copy `.env.example` to `digital_twin/vault/.env` in the Codespace using the
   editor. Set all five required secrets to unique values. Use at least 32 bytes
   for `MASTER_ENCRYPTION_KEY` and `JWT_SECRET`, and at least 16 characters for
   `GENESIS_ADMIN_PASSWORD`. Keep the Codespace port private.
2. In the terminal, run:

   ```sh
   cd digital_twin
   npm install
   npm start
   ```

   The backend checks the vault and required settings before opening SQLite.
   The optional `SYSTEM_DB_BACKUP_PATH` restores a trusted local SQLite backup
   only when the database is absent; the restored database is integrity-checked.
3. Serve `website/` on port 8080 (for example `python -m http.server 8080` from
   the repository root) and open it in the browser.
4. Enter the backend origin in the UI, including the forwarded Codespace HTTPS
   URL when using a Codespace. Set `PUBLIC_UI_ORIGIN` in the private vault to
   the exact website origin and restart the backend. Do not make the backend
   port public.
5. Claim the reserved `RFOF-NETWORK` account once with the Genesis password
   and a new account password. Other users can register with their own account
   passwords.

For static GitHub Pages deployment, configure Pages to publish `website/` using
GitHub Actions or a branch. Pages does not run the backend. GitHub Actions
secrets are not delivered to the browser or a Codespace; backend secrets belong
only in the private Codespace vault. Never commit that vault.

## Current functionality

The browser UI supports account registration/login, account display, and a
small authenticated read-only terminal. The broker allows only `git --version`
and fixed Node/npm/Python version checks. Commands run without a shell in a
per-user workspace directory. This is a
security-conscious foundation, not a fully featured multi-user IDE: repository
management, token minting, extensions, Windows/PowerShell, and LLM connectors
are not implemented.

The backend requires Node.js 22.5 or newer for the built-in SQLite module.

Run backend tests with `cd digital_twin && npm test`.
