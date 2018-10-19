
# try to create test database until 
for  i in $(seq 30); do
  echo 'Waiting for SQL Server to wake up';
  docker-compose exec mssql /opt/mssql-tools/bin/sqlcmd -S mssql -U sa -P S0meVeryHardPassword -d master -Q 'CREATE DATABASE mssql_test_db' 2> /dev/null && break;
  sleep 5;
done