# Security

This repository is public. Never commit real credentials, `digital_twin/vault/.env`,
SQLite databases, private user data, or service tokens. The vault is ignored by
Git; verify changes in the GitHub diff before publishing. If a secret is exposed,
revoke it at its provider immediately and replace it.

## Trust boundaries

`website/` is a public, untrusted browser client. It contains no secrets and must
not be given service credentials. Configure the API origin in the browser; the
backend must separately allow that exact origin with `PUBLIC_UI_ORIGIN`. GitHub
Pages cannot host the backend or protect secrets. The Codespace backend is
private infrastructure; keep its forwarded port private and use HTTPS when
accessing it remotely.

The backend is a broker, not a general-purpose shell or remote administration
server. It does not expose Windows, PowerShell, arbitrary shell, filesystem
editing, Git mutations, network scanning, system administration, or arbitrary
LLM proxy operations. Its terminal endpoint accepts only fixed, read-only
Codespace status/version commands. Do not extend this endpoint to accept
unvalidated commands or pass input to a shell.

## Genesis account

`GENESIS_ADMIN_PASSWORD` is required at startup and must be kept only in the
private Codespace vault. The reserved `RFOF-NETWORK` account starts unregistered.
Its one-time claim requires this password and a separate account password;
successful claim marks the account registered and permanently locks further
claims. Keep the genesis password private and rotate it by controlled
administrative migration, not through the public UI.

## Secrets and encryption

`MASTER_ENCRYPTION_KEY`, `JWT_SECRET`, `GITHUB_SERVICE_TOKEN`, `LLM_API_KEY`,
and `GENESIS_ADMIN_PASSWORD` are mandatory backend settings. Use unique,
high-entropy values, restrict token scopes, and rotate exposed credentials.
The encryption key is reserved for future encrypted connector credentials;
this scaffold does not persist connector secrets. AES-256 requires a 32-byte
key and authenticated encryption; do not implement custom cryptography.

GitHub Actions secrets are for workflows and are not available to a static
GitHub Pages client. Never inject backend secrets into a Pages build. Do not
make the Codespace port public. Authentication uses short-lived bearer JWTs,
rate limits, password hashing, exact-origin CORS, and a private SQLite database.

## Reporting

Do not publish vulnerability details or credentials in a public issue. Contact
the repository maintainers privately through GitHub's security reporting flow.
