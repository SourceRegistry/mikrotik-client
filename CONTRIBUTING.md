# Contributing

## Prerequisites

- Node.js ≥ 20
- npm ≥ 10

## Setup

```sh
git clone https://github.com/SourceRegistry/mikrotik-client.git
cd mikrotik-client
npm install
```

## Development workflow

```sh
npm run lint          # ESLint + tsc type check
npm run format        # Prettier format
npm test              # Unit tests
npm run build         # Build dist/
npm run docs:build    # Build TypeDoc
```

Before submitting a PR, run:

```sh
npm run lint && npm test && npm run build
```

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(routeros): add connection pool
fix(switchos): handle digest nonce rotation
chore(ci): add lint step
docs: update README feature matrix
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`.

## Pull requests

- One logical change per PR.
- Include tests for new behaviour.
- Update `README.md` feature matrix if a public API surface changes.
- Target the `alpha` branch for new features; `main` for critical fixes.

## Scope

Read `CLAUDE.md` §1 before proposing features. Controller concerns (fleet, persistence, multi-device orchestration) belong in `mikrotik-network-controller`, not here.

## Code style

- No `any` in published code. Use `unknown` at boundaries and narrow before use.
- All public exports need TSDoc with `@example`.
- Enums as string-literal unions + runtime const arrays — not TypeScript `enum`.
- Errors must extend `MikrotikError` with a `code` from `MikrotikErrorCode`.
