[reflection.assembly]::LoadWithPartialName("Microsoft.SqlServer.Smo") | Out-Null;
[reflection.assembly]::LoadWithPartialName("Microsoft.SqlServer.SqlWmiManagement") | Out-Null;

$instancename = $args[0];

$wmi = New-Object('Microsoft.SqlServer.Management.Smo.Wmi.ManagedComputer');
$tcp = $wmi.GetSmoObject("ManagedComputer[@Name='${env:computername}']/ServerInstance[@Name='${instancename}']/ServerProtocol[@Name='Tcp']");
$tcp.IsEnabled = $true;
$tcp.Alter();

Start-Service -Name "MSSQL`$$instancename";

$wmi = New-Object('Microsoft.SqlServer.Management.Smo.Wmi.ManagedComputer');
$ipall = $wmi.GetSmoObject("ManagedComputer[@Name='${env:computername}']/ServerInstance[@Name='${instancename}']/ServerProtocol[@Name='Tcp']/IPAddress[@Name='IPAll']");
$port = $ipall.IPAddressProperties.Item("TcpDynamicPorts").Value;

$config = @{
	user = "sa";
	password = "Password12!";
	server = "localhost";
	port = $port;
	database = "master";
	requestTimeout = 30000;
	options = @{
		abortTransactionOnError = $true
	}
} | ConvertTo-Json -Depth 3;

[System.IO.File]::WriteAllLines("test\.mssql.json", $config);