// A Windows VM running SQL Server Developer edition, for integration testing against a full
// SQL Server engine and for exercising msnodesqlv8 on Windows, where node-mssql defaults to
// the `SQL Server Native Client 11.0` ODBC driver rather than `ODBC Driver 17 for SQL Server`
// (see lib/msnodesqlv8/connection-pool.js). The dev container covers the tedious driver
// against SQL Server on Linux; this covers the cases it cannot.
//
// This template is NOT exercised by CI, and it creates billable Azure resources.
// Read ./README.md before deploying it — it covers cost, teardown, and the two
// non-obvious steps needed before the msnodesqlv8 suite will connect.

@description('Location for all resources.')
param location string = resourceGroup().location

@description('VM size. B2ms is the cheapest that comfortably runs SQL Server.')
param vmSize string = 'Standard_B2ms'

@description('Local administrator username.')
param adminUsername string = 'mssqladmin'

@description('Local administrator password, used for RDP. Not used for SQL — see sqlAdminPassword.')
@secure()
param adminPassword string

@description('SQL Server sysadmin login created via the SQL VM resource provider. `sa` stays disabled.')
param sqlAdminUsername string = 'sqladmin'

@description('Password for sqlAdminUsername. Kept separate from adminPassword because this one is written to test/.mssql.json in cleartext and crosses the wire, and so should not also unlock RDP as administrator.')
@secure()
param sqlAdminPassword string

@description('Single IP allowed to reach the VM. Use your own public IP; empty means no inbound rules at all.')
param allowedSourceIp string = ''

@description('Also open SQL (1433) to allowedSourceIp. Off by default: the usual workflow is to RDP in and run the suites on the VM against localhost, which needs no exposed SQL port. Only turn this on to drive the VM from your own machine.')
param exposeSqlPort bool = false

@description('Resource name prefix. Also the Windows computer name, which ARM limits to 15 characters.')
@minLength(1)
@maxLength(15)
param vmName string = 'sqlvm'

@description('Marketplace offer, e.g. sql2022-ws2022, sql2019-ws2022, sql2017-ws2019, sql2016sp3-ws2019.')
param imageOffer string = 'sql2022-ws2022'

@description('Marketplace SKU, e.g. sqldev-gen2 (2022) or sqldev (older offers).')
param imageSku string = 'sqldev-gen2'

var name = vmName
var hasIp = !empty(allowedSourceIp)

var rdpRule = [
  {
    name: 'AllowRDP'
    properties: {
      priority: 110
      direction: 'Inbound'
      access: 'Allow'
      protocol: 'Tcp'
      sourceAddressPrefix: allowedSourceIp
      sourcePortRange: '*'
      destinationAddressPrefix: '*'
      destinationPortRange: '3389'
    }
  }
]

var sqlRule = [
  {
    name: 'AllowSQL'
    properties: {
      priority: 100
      direction: 'Inbound'
      access: 'Allow'
      protocol: 'Tcp'
      sourceAddressPrefix: allowedSourceIp
      sourcePortRange: '*'
      destinationAddressPrefix: '*'
      destinationPortRange: '1433'
    }
  }
]

resource nsg 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: '${name}-nsg'
  location: location
  properties: {
    securityRules: hasIp ? (exposeSqlPort ? concat(rdpRule, sqlRule) : rdpRule) : []
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: '${name}-vnet'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.0.0.0/16'] }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: '10.0.0.0/24'
          networkSecurityGroup: { id: nsg.id }
        }
      }
    ]
  }
}

resource pip 'Microsoft.Network/publicIPAddresses@2023-11-01' = {
  name: '${name}-pip'
  location: location
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}

resource nic 'Microsoft.Network/networkInterfaces@2023-11-01' = {
  name: '${name}-nic'
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: { id: vnet.properties.subnets[0].id }
          publicIPAddress: { id: pip.id }
          privateIPAllocationMethod: 'Dynamic'
        }
      }
    ]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: name
  location: location
  properties: {
    hardwareProfile: { vmSize: vmSize }
    storageProfile: {
      // SQL Server Developer, pre-installed by Microsoft — no self-install, no SQL licence cost
      imageReference: {
        publisher: 'MicrosoftSQLServer'
        offer: imageOffer
        sku: imageSku
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    osProfile: {
      computerName: name
      adminUsername: adminUsername
      adminPassword: adminPassword
      windowsConfiguration: { provisionVMAgent: true, enableAutomaticUpdates: false }
    }
    networkProfile: { networkInterfaces: [{ id: nic.id }] }
  }
}

// Registers the VM with the SQL IaaS agent and creates a sysadmin login. Without this the
// image has no usable SQL login at all — see the README's "Two non-obvious steps".
resource sqlvm 'Microsoft.SqlVirtualMachine/sqlVirtualMachines@2023-10-01' = {
  name: name
  location: location
  properties: {
    virtualMachineResourceId: vm.id
    sqlManagement: 'Full'
    sqlServerLicenseType: 'PAYG'
    serverConfigurationsManagementSettings: {
      sqlConnectivityUpdateSettings: {
        connectivityType: exposeSqlPort ? 'PUBLIC' : 'PRIVATE'
        port: 1433
        sqlAuthUpdateUserName: sqlAdminUsername
        sqlAuthUpdatePassword: sqlAdminPassword
      }
    }
  }
}

output publicIp string = pip.properties.ipAddress
output rdp string = 'mstsc /v:${pip.properties.ipAddress}'
output sqlLogin string = sqlAdminUsername
