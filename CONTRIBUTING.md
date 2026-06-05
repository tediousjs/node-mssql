# Contributing to node-mssql

Thanks for your interest in contributing to `node-mssql`! This project is community-maintained, and contributions of all kinds — bug reports, documentation, and code — are welcome.

This guide covers how to report issues, set up a development environment, and submit changes that fit the project's conventions.

## Reporting Issues

### Security vulnerabilities

**Do not** open public issues for security vulnerabilities. Please follow our [Security Policy](SECURITY.md) and report them privately instead.

### Bugs

Before opening a bug report, please search [existing issues](https://github.com/tediousjs/node-mssql/issues) to avoid duplicates. When you open a new issue, the issue template will ask for the information maintainers need to triage it effectively, including:

- Expected and actual behaviour, with relevant SQL and schema where possible.
- A minimal, reproducible example.
- Software versions: Node.js, `mssql`, and SQL Server.

### Feature requests

Feature requests are welcome — please open an issue describing the use case and the problem you are trying to solve, rather than only a proposed implementation.

## Development Setup

1. Fork and clone the repository.
2. Ensure you are running a supported Node.js version. The project requires **Node.js >= 18.19.0** (see the `engines` field in `package.json`).
3. Install dependencies:

   ```bash
   npm install
   ```

### Running the tests

| Command | Description |
| ------- | ----------- |
| `npm test` | Runs the linter (StandardJS) followed by the unit tests. This is the baseline check that must pass. |
| `npm run lint` | Runs StandardJS only. |
| `npm run test-unit` | Runs the unit tests only. No database required. |
| `npm run test-tedious` | Runs the integration tests against a live SQL Server using the `tedious` driver. |
| `npm run test-msnodesqlv8` | Runs the integration tests using the `msnodesqlv8` driver. |
| `npm run test-cli` | Runs the CLI tool tests. |

To run a single unit test by name:

```bash
npx mocha --exit -t 15000 --grep "test name" test/common/unit.js
```

### Integration tests

The integration tests require a running SQL Server instance configured in `test/.mssql.json` (see `.devcontainer/.mssql.json` for the expected shape). The included [dev container](https://containers.dev/) sets up both Node.js and SQL Server via Docker Compose, which is the easiest way to run the full suite locally.

Unit tests (`npm run test-unit`) do **not** require a database, so you can develop and validate most changes without a SQL Server instance.

## Coding Standards

- **Style:** The project uses [StandardJS](https://standardjs.com/) — no semicolons, 2-space indentation, single quotes. There is no config file or override; run `npm run lint` to check your work, and `npx standard --fix` to auto-fix many issues.
- **Driver-agnostic design:** Shared, public API lives in `lib/base/`; driver-specific implementations live in `lib/tedious/` and `lib/msnodesqlv8/` and override private methods prefixed with an underscore (e.g. `_poolCreate`, `_executeQuery`).
- **Dual API:** Async methods should support both Promises and callbacks.
- **Tests:** Add or update tests for any behavioural change. Unit tests go in `test/common/unit.js`; integration tests are added to the shared factory in `test/common/tests.js` so they run against every driver.

## Commit Messages

Commit messages **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. This is enforced by commitlint, and [semantic-release](https://semantic-release.gitbook.io/) uses these messages to automate versioning and changelog generation — so using the correct type matters.

| Type | When to use it | Release impact |
| ---- | -------------- | -------------- |
| `fix` | Bug fixes or behavioural corrections that don't change the public interface | **patch** |
| `feat` | New backwards-compatible functionality | **minor** |
| `feat!` (or any type with `!`, or a `BREAKING CHANGE:` footer) | Changes that require consumers to update their code | **major** |
| `chore` | Dependency updates, tooling, housekeeping | none |
| `ci` | CI pipeline or workflow configuration changes | none |
| `docs` | Documentation-only changes | none |
| `style` | Formatting or stylistic changes that don't affect behaviour | none |
| `refactor` | Code changes that neither fix a bug nor add a feature | none |
| `test` | Changes that only touch tests | none |

Only `fix` and `feat` trigger a release. If a change needs to be released but doesn't neatly fit either, choose whichever is most appropriate to ensure a release is created.

## Pull Requests

- **Branch from an up-to-date `master`.** All changes go through a pull request — there are no direct commits to `master`.
- **Keep commits atomic.** Each commit should be a self-contained, deployable change with linting, commitlint, and tests passing. Don't mix unrelated changes (e.g. a bug fix and a documentation tweak) in one commit.
- **Keep your branch current by rebasing** onto `master` rather than merging `master` into your branch.
- **PRs are merged with a merge commit** (no squash or rebase merge), so each commit in your PR is preserved in history. Please keep that history clean.
- Fill out the pull request template, link any related issues, and update the changelog where applicable.
- Make sure `npm test` passes before requesting review.

For additional background, see the [Contributing page on the project wiki](https://github.com/tediousjs/node-mssql/wiki/Contributing).

Thanks again for contributing!
