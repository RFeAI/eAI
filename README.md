# eAI

eAI is a public browser UI with a separate, private Codespace API broker. The
website is only a renderer: it never contains service credentials. File
operations are confined to the authenticated user's workspace. The terminal is
limited to fixed read-only version checks; arbitrary shell commands and
Windows/PowerShell execution are not exposed because a Codespace still contains
credentials and private data.

## Run in GitHub Codespaces

1. Copy `.enc.example` to `digital_twin/vault/.env` in the Codespace using the
   editor. Set the three required secrets to unique values. Use at least 32 bytes
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

For static GitHub Pages deployment, publish the repository root; its `index.html`
redirects to the renderer under `website/`. Pages does not run the backend. GitHub Actions
secrets are not delivered to the browser or a Codespace; backend secrets belong
only in the private Codespace vault. Never commit that vault.

## Current functionality

The browser UI supports account registration/login, account display, workspace
file and folder operations, and a small authenticated terminal. Files are
restricted to each user's private workspace; sensitive names and symlinks are
rejected, files have a size limit, and folder deletion is non-recursive. The
broker allows only fixed Git/Node/npm/Python version checks, without a shell.
Windows and PowerShell selections show that they are unavailable in the Linux
Codespace. The dashboard can create one workspace extension per account: the
gateway verifies the user's JWT and proxies existing workspace and terminal
routes to that account's worker. Internal workers listen on randomly assigned
loopback-only ports; stale ports are cleared at restart, and workers are
restarted on demand. A worker is created with a stripped environment and an
internal per-worker authentication key. A maximum of eight can be active at
once, and workers stop when the gateway exits.

The gateway adds ten tokens once when a workspace is created and after each
successful supported terminal version command. The balance is stored in
SQLite. `/api/chat` returns 402 when the balance is empty and otherwise 501:
no LLM provider has been configured, no chat request is sent, and no tokens
are charged. Repository creation, real Git mutations and unrestricted command
execution are not implemented. The worker uses the same fixed allowlist as the
default workspace; there is no user-editable command policy.

**Isolation limit:** workers are ordinary Node processes running as the same
operating-system user. They are not containers or security sandboxes, and other
local processes with that user's privileges may access their files or secrets.
Do not treat this implementation as a secure multi-tenant deployment. Use
properly isolated container/VM workloads and separate identities before running
untrusted extensions or shell commands. The gateway must remain private.

Port 3000 is only the gateway's listening port. It does not create a permanent
internet address or eliminate changing Codespace tunnel URLs. A stable URL
requires separately managed hosting and authenticated network access.

The public `.enc.example` is a placeholder template, not an encrypted secret
file. The backend still reads the actual `.env` only from
`digital_twin/vault/`; `.gitignore` excludes environment files, vault
directories, and SQLite files. Check the Git diff before every public commit.
The renderer calls the private Codespace backend (port 3000); filesystem and
terminal actions do not run on GitHub Pages.

GitHub and LLM service tokens are not used by this restricted implementation;
do not supply them until a reviewed, scoped connector is added.

The backend requires Node.js 22.5 or newer for the built-in SQLite module.

Run backend tests with `cd digital_twin && npm test`.
