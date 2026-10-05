# Azure SQL Server test VM

A [Bicep](https://learn.microsoft.com/azure/azure-resource-manager/bicep/) template that
provisions a Windows VM with SQL Server Developer edition pre-installed, for integration
testing `node-mssql` against a full SQL Server engine.

> [!WARNING]
> This creates **billable Azure resources** in your own subscription, and it is **not
> exercised by CI** — nobody is alerted when an API version or marketplace SKU goes stale.
> Treat it as a contributor convenience, not supported infrastructure. See
> [Cost and teardown](#cost-and-teardown).

## Why this exists

The [dev container](../../.devcontainer) runs SQL Server for Linux in Docker and covers the
`tedious` driver for most work. Two things it does not cover:

- **`npm run test-msnodesqlv8` on Windows.** On Windows, `node-mssql` defaults to the
  `SQL Server Native Client 11.0` ODBC driver rather than `ODBC Driver 17 for SQL Server`
  (see [`lib/msnodesqlv8/connection-pool.js`](../../lib/msnodesqlv8/connection-pool.js)).
  That is the code path Windows users hit, and CI only exercises it in the `test-windows`
  job — the Linux job's msnodesqlv8 step is commented out.
- **Engine-edition-dependent behaviour.** Features such as CLR and user-defined types depend
  on the SQL Server edition. If your Docker host cannot run Microsoft's SQL Server image and
  you have substituted Azure SQL Edge, that engine reports `EngineEdition` 9 and has no CLR,
  so those tests fail for reasons unrelated to your change.

If neither applies to you, use the dev container — it is faster and free.

## Deploying

Requires the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) and an
authenticated subscription (`az login`).

The template takes two separate passwords: one for the Windows administrator and one for the
SQL login. Read them without echoing, so they do not land in your shell history:

```bash
read -rs -p 'Windows admin password: ' ADMIN_PW; echo
read -rs -p 'SQL login password: ' SQL_PW; echo

az group create -n rg-mssql-test -l uksouth

az deployment group create -g rg-mssql-test -f sqlvm.bicep \
  -p adminPassword="$ADMIN_PW" \
     sqlAdminPassword="$SQL_PW" \
     allowedSourceIp="$(curl -s https://api.ipify.org)"
```

Command-line arguments are still visible to other users of the same machine via the process
list. If that matters, put the parameters in a `chmod 600` JSON file and use
`--parameters @params.json` instead, deleting it afterwards.

By default this opens **RDP only**. The usual workflow is to RDP in and run the suites on the
VM itself against `localhost`, which needs no exposed SQL port. Pass `exposeSqlPort=true` only
if you want to drive the VM from your own machine.

### Parameters

| Parameter | Default | Notes |
| --- | --- | --- |
| `adminPassword` | *(required)* | Windows administrator password, used for RDP. |
| `sqlAdminPassword` | *(required)* | Password for the SQL login. Deliberately separate from `adminPassword`: this one gets written to `test/.mssql.json` in cleartext and crosses the wire, so it should not also unlock RDP as administrator. |
| `allowedSourceIp` | `''` | Single IP allowed to reach the VM. **Empty creates no inbound rules at all**, which is the safe default — pass your own public IP to reach it. |
| `exposeSqlPort` | `false` | Also open SQL (1433) to `allowedSourceIp`, and set the SQL VM connectivity type to `PUBLIC`. Leave off unless you are connecting from outside the VM. |
| `vmSize` | `Standard_B2ms` | Cheapest size that comfortably runs SQL Server. |
| `imageOffer` | `sql2022-ws2022` | Also `sql2019-ws2022`, `sql2017-ws2019`, `sql2016sp3-ws2019`. |
| `imageSku` | `sqldev-gen2` | Use `sqldev` for the older offers. |
| `vmName` | `sqlvm` | Name prefix, and the Windows computer name — ARM caps that at 15 characters, so the template enforces it. Set it when deploying several VMs into one resource group. |
| `adminUsername` | `mssqladmin` | Windows administrator username. |
| `sqlAdminUsername` | `sqladmin` | SQL sysadmin login created via the SQL VM resource provider. |
| `location` | resource group's location | |

Never widen `allowedSourceIp` to `0.0.0.0/0` — with `exposeSqlPort` on, that publishes SQL
Server to the whole internet.

## Two non-obvious steps

**The `Microsoft.SqlVirtualMachine` resource is not optional.** Deploying the marketplace
image as a plain VM leaves you with no usable SQL login: `sa` is disabled,
`NT AUTHORITY\SYSTEM` is not a sysadmin, and the only sysadmin is that disabled `sa`. You
cannot then create a login without single-user-mode recovery. The template registers the VM
with the SQL IaaS agent, which creates a sysadmin login through a supported API. `sa` stays
disabled — use `sqlAdminUsername`.

**Install SQL Server Native Client before running the msnodesqlv8 suite.** The marketplace
image ships only ODBC Driver 17, but `node-mssql` asks for `SQL Server Native Client 11.0` on
Windows, so connections fail until it is present. On the VM:

```
msiexec /i sqlncli.msi IACCEPTSQLNCLILICENSETERMS=YES /qn /norestart
```

The installer is published by Microsoft as
[`sqlncli.msi`](https://download.microsoft.com/download/B/E/D/BED73AAC-3C8A-43F5-AF4F-EB4FEA6C8F3A/ENU/x64/sqlncli.msi).

Setting `driver` in `test/.mssql.json` will **not** let you skip this step. Both harnesses
overwrite that field before it reaches the library — `test/msnodesqlv8/msnodesqlv8.js` sets
`cfg.driver = 'msnodesqlv8'`, which `connection-pool.js` treats as "unspecified" and replaces
with the platform default. The only override that survives is a full `connectionString`, which
bypasses the builder entirely:

```json
{
  "connectionString": "Driver={ODBC Driver 17 for SQL Server};Server=localhost,1433;Database=master;Uid=sqladmin;Pwd=<sqlAdminPassword>;TrustServerCertificate=yes"
}
```

That works, but it stops exercising the default Windows code path — usually the reason for
using this VM at all.

## Running the tests

Point `test/.mssql.json` at the VM, using the shape in
[`.devcontainer/.mssql.json`](../../.devcontainer/.mssql.json). **The two drivers need
different TLS settings**, because the VM presents a self-signed certificate.

For `npm run test-tedious`:

```json
{
  "user": "sqladmin",
  "password": "<sqlAdminPassword>",
  "server": "localhost",
  "port": 1433,
  "database": "master",
  "requestTimeout": 30000,
  "options": {
    "abortTransactionOnError": true,
    "encrypt": true,
    "trustServerCertificate": true
  }
}
```

`tedious` defaults `encrypt` to `true` and `trustServerCertificate` to `false` (see
[`lib/tedious/connection-pool.js`](../../lib/tedious/connection-pool.js)), so without the
explicit trust the handshake fails against a self-signed certificate. This matches what the
Linux CI job does.

For `npm run test-msnodesqlv8`:

```json
{
  "user": "sqladmin",
  "password": "<sqlAdminPassword>",
  "server": "localhost",
  "port": 1433,
  "database": "master",
  "requestTimeout": 30000,
  "options": {
    "abortTransactionOnError": true,
    "encrypt": false
  }
}
```

`trustServerCertificate` has no effect here. The msnodesqlv8 connection string is built from
only `Driver`, `Server`, `Database`, `Uid`, `Pwd`, `Trusted_Connection` and `Encrypt` (see
`lib/msnodesqlv8/connection-pool.js`), so the key is silently dropped and `Encrypt=yes` would
fail certificate validation with no way to override it. Turning encryption off is what the
Windows CI job does for exactly this reason. To test an *encrypted* msnodesqlv8 connection,
use the `connectionString` form above with `TrustServerCertificate=yes`.

If you set `exposeSqlPort=true` and are connecting from your own machine, replace `localhost`
with the deployment's `publicIp` output. Note that a self-signed certificate issued for the
VM's hostname will not match an IP literal, so the `connectionString` form is the only way to
get an encrypted connection in that case.

Then run the suites as described in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Cost and teardown

SQL Server Developer edition carries no SQL licence cost, but the compute rate for a Windows
VM includes a Windows Server licence, so it is higher than the equivalent Linux VM. You pay
for **compute, the OS disk and the static public IP**. Check the
[pricing calculator](https://azure.microsoft.com/pricing/calculator/) for your region rather
than relying on a figure quoted here.

Deallocating stops the **compute** charge only — the disk and the public IP keep billing:

```bash
az vm deallocate -g rg-mssql-test -n sqlvm
```

Deleting the resource group is the only thing that stops all charges. It is the single unit of
teardown, so this removes the VM, disk, IP, network and the SQL VM registration together:

```bash
az group delete -n rg-mssql-test --yes --no-wait
```
