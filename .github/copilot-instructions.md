# Copilot Instructions for node-mssql

## Build, Test, and Lint

```bash
npm test              # Lint (standard) + unit tests
npm run lint          # StandardJS linter only (no config file — uses standard directly)
npm run test-unit     # Unit tests only (no database required)
npm run test-tedious  # Integration tests against a live SQL Server (tedious driver)
npm run test-cli      # CLI tool tests
```

Run a single unit test:

```bash
npx mocha --exit -t 15000 --grep "test name" test/common/unit.js
```

Integration tests require a running SQL Server instance configured in `test/.mssql.json` (see `.devcontainer/.mssql.json` for the expected shape). The devcontainer sets up both Node.js and SQL Server via Docker Compose.

## Architecture

This is a **driver-agnostic SQL Server client** for Node.js. The core abstraction is:

- **`lib/base/`** — Abstract base classes (`ConnectionPool`, `Request`, `Transaction`, `PreparedStatement`) that define the public API. All extend `EventEmitter`.
- **`lib/tedious/`** — Tedious driver implementation. Each file extends the corresponding base class and overrides private methods like `_poolCreate()`, `_executeQuery()`, etc.
- **`lib/msnodesqlv8/`** — MSNodeSQLv8 (native ODBC) driver implementation. Same pattern.
- **Entry points**: `index.js` and `tedious.js` both export `lib/tedious`; `msnodesqlv8.js` exports `lib/msnodesqlv8`.

Driver index files use `Object.assign()` to merge base exports with driver-specific class overrides, then register the driver on the shared `driver` object in `lib/shared.js`.

### Other key modules

- **`lib/shared.js`** — Global mutable state: the active `driver`, configurable `Promise` library, and `map` (JS type → SQL type registry with `getTypeByValue()` auto-detection).
- **`lib/global-connection.js`** — Singleton global connection pool with pre-connect handler registration.
- **`lib/datatypes.js`** — SQL type definitions. Parameterized types are factory functions: `sql.VarChar(50)`, `sql.Numeric(18, 4)`.
- **`lib/table.js`** — `Table` class for bulk inserts and TVPs. Parses qualified names like `[db].[schema].[table]`.
- **`lib/error/`** — Error hierarchy: `MSSQLError` → `ConnectionError`, `RequestError`, `TransactionError`, `PreparedStatementError`. Each has a `code` property (e.g., `EINJECT`, `EARGS`, `EREQINPROG`).

## Conventions

- **Private methods** use a leading underscore (`_poolCreate`, `_executeQuery`). These are the driver-specific hooks that implementations override.
- **Dual API**: All async methods support both Promises and callbacks.
- **Streaming**: `Request` supports a `stream` mode where results are emitted as `row`, `recordset`, and `done` events.
- **Linting**: StandardJS — no semicolons, 2-space indent, single quotes. No config overrides.
- **Commit messages:** Follow [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint. Semantic-release uses these to generate automated releases and changelogs, so correct commit types are critical.
  - `fix` — Bug fixes or behavioural corrections that don't change public interfaces. Triggers a **patch** release.
  - `feat` — New backwards-compatible functionality. Triggers a **minor** release.
  - `feat!` (or any type with `!`) — Breaking changes where consumers would need to update their code. Triggers a **major** release.
  - `chore` — Dependency updates, tooling changes, or housekeeping. **Does not trigger a release.**
  - `ci` — Changes to CI pipelines or workflow configuration. **Does not trigger a release.**
  - `style` — Refactoring or stylistic changes that do not change functionality. **Does not trigger a release.**
  - `test` — Changes that only touch test files. **Does not trigger a release.**
  - Only `fix` and `feat` trigger releases. If a change doesn't neatly fit `fix` or `feat` but still needs to be released, use whichever is most appropriate to ensure a release is created.
- **Commits and merges:**
  - Commits should be atomic and ideally deployable in isolation — all tests, linting, and commitlinting should pass on each individual commit.
  - PRs are merged using a **merge commit** (no squash-merge or rebase-merge). Each commit in the PR history is preserved.
  - To keep branches up to date with the base branch, **rebase** onto it rather than merging it in.
  - All changes must go through a **pull request** — no direct commits to master.
- **Debug logging**: Uses the `debug` library with `mssql:*` namespaces (`mssql:base`, `mssql:tedi`, etc.).
- **Instance tracking**: `lib/utils.js` uses a `WeakMap` (`IDS`) to assign unique IDs to class instances.
- **SQL injection guard**: Parameter names are validated against patterns like `--`, `/*`, `'` — throws `RequestError` with code `EINJECT`.

### Test patterns

- **Unit tests** (`test/common/unit.js`): No database needed. Tests type mapping, table parsing, error construction.
- **Integration tests** (`test/common/tests.js`): Exported as a factory `(sql, driver) => { ... }` — called by each driver's test file. Many tests exercise three execution styles: callback, promise, and streaming.
- **Framework**: Mocha + Node.js built-in `assert` (no chai/sinon).
- **Keeping this file up to date:** If a change affects the architecture, conventions, build process, or any other information documented here, update this file as part of the same PR.
