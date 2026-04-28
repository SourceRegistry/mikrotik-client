# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x (stable, when released) | Yes |
| 1.0.0-alpha.x | Best-effort |
| < 1.0.0-alpha | No |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: a.p.a.slaa@projectsource.nl

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Any known mitigations

You will receive an acknowledgement within 5 business days. We aim to release a fix within 30 days of a confirmed vulnerability.

## Security model

- This library communicates directly with MikroTik devices. It does not make outbound calls to any third-party services.
- TLS certificate verification is on by default. Disabling it (`insecureSkipVerify: true`) must be done explicitly and is logged at warn level.
- SSH host key checking is on by default (`StrictHostKeyChecking=accept-new`). Disabling it requires explicit opt-in.
- Credentials are never logged or included in error messages.
- No telemetry. No phone-home.

## Scope

Vulnerabilities in this library's transport, auth, or codec layers are in scope. Vulnerabilities in RouterOS firmware or MikroTik infrastructure are out of scope — report those to MikroTik directly.
