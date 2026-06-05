# Security Policy

The `node-mssql` maintainers take the security of this library seriously, and we appreciate the efforts of security researchers and users who responsibly report vulnerabilities to us. This document explains which versions are supported, how to report a vulnerability, and what you can expect from us in return.

## Supported Versions

Security fixes are only provided for the latest major release line. We strongly recommend always running the most recent release.

| Version | Supported          |
| ------- | ------------------ |
| 12.x    | :white_check_mark: |
| < 12.0  | :x:                |

If you are on an older major version, please upgrade to the latest `12.x` release to receive security fixes. The [changelog](https://github.com/tediousjs/node-mssql/releases) documents any breaking changes to help you upgrade.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, pull requests, or discussions.**

Instead, report them privately through GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):

1. Go to the **[Security](https://github.com/tediousjs/node-mssql/security)** tab of the repository.
2. Click **Report a vulnerability** to open the advisory form ([direct link](https://github.com/tediousjs/node-mssql/security/advisories/new)).
3. Fill in as much detail as you can (see below) and submit.

This creates a private channel between you and the maintainers where we can discuss, triage, and fix the issue before any public disclosure.

If you are unable to use GitHub's private reporting for any reason, you may open a regular issue that contains **no vulnerability details** and simply asks a maintainer to get in touch about a security matter.

### What to include

A good report helps us validate and fix the issue quickly. Where possible, please include:

- A description of the vulnerability and its impact (e.g. SQL injection, denial of service, information disclosure).
- The affected version(s) of `node-mssql`, and the driver in use (`tedious` or `msnodesqlv8`) if relevant.
- Step-by-step instructions to reproduce, ideally with a minimal code sample.
- Any proof-of-concept code, logs, or screenshots that demonstrate the issue.
- Any known mitigations or workarounds.

You do not need a complete analysis to report — if you have found something concerning but are unsure of its full impact, please still reach out.

## What to Expect

`node-mssql` is a community-maintained open source project. We will do our best to respond promptly, but please understand that response times depend on maintainer availability.

- **Acknowledgement:** We aim to acknowledge your report within **3 business days**.
- **Assessment:** We aim to provide an initial assessment, including whether we accept the report and a rough severity, within **10 business days**.
- **Updates:** We will keep you informed of our progress toward a fix and may ask for additional information or guidance.
- **Resolution:** Once a fix is ready, we will coordinate a release and public disclosure with you (see below).

If you do not receive a response within a reasonable time, please send a gentle reminder by commenting on the advisory.

## Coordinated Disclosure

We follow a coordinated disclosure process:

1. We confirm the vulnerability and determine the affected versions.
2. We prepare a fix and, where appropriate, request a [CVE](https://www.cve.org/) and draft a GitHub Security Advisory.
3. We release a patched version and publish the advisory, crediting the reporter (unless you prefer to remain anonymous).

Please give us a reasonable opportunity to release a fix before disclosing the issue publicly. We are happy to agree on a disclosure timeline with you and will work to resolve accepted vulnerabilities as quickly as is practical.

## Scope

This policy covers security issues in the `node-mssql` library itself (the code in this repository, published to npm as [`mssql`](https://www.npmjs.com/package/mssql)).

Vulnerabilities in dependencies (such as [`tedious`](https://github.com/tediousjs/tedious)) or in Microsoft SQL Server itself should be reported to the relevant project. If you are unsure where an issue belongs, report it to us and we will help route it.

The following are generally **out of scope**:

- Vulnerabilities that require a malicious or compromised SQL Server, network position, or operating system that the application already implicitly trusts.
- Reports from automated scanners without a demonstrated, exploitable impact on `node-mssql`.
- Insecure usage patterns in application code that arise from ignoring the documented, parameterised query APIs (e.g. building queries via unsanitised string concatenation when a safe API is available).

When in doubt, report it — we would rather review an out-of-scope report than miss a real issue.

## Recognition

We are grateful to everyone who helps keep `node-mssql` and its users safe. Unless you ask to remain anonymous, we will credit you in the published security advisory and release notes.
