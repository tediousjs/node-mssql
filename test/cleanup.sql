if exists (select * from sys.procedures where name = '__test')
	exec('drop procedure [dbo].[__test]')

if exists (select * from sys.procedures where name = '__test2')
	exec('drop procedure [dbo].[__test2]')

if exists (select * from sys.procedures where name = '__test3')
	exec('drop procedure [dbo].[__test3]')

if exists (select * from sys.procedures where name = '__test5')
	exec('drop procedure [dbo].[__test5]')

if exists (select * from sys.procedures where name = '__test7')
	exec('drop procedure [dbo].[__test7]')

if exists (select * from sys.types where is_user_defined = 1 and name = 'MSSQLTestType')
	exec('drop type [dbo].[MSSQLTestType]')
	
if exists (select * from sys.tables where name = 'prepstm_test')
	exec('drop table [dbo].[prepstm_test]')
	
if exists (select * from sys.tables where name = 'tran_test')
	exec('drop table [dbo].[tran_test]')
	
if exists (select * from sys.tables where name = 'bulk_table')
	exec('drop table [dbo].[bulk_table]')
	
/*
if exists (select * from sys.tables where name = 'streaming')
	exec('drop table [dbo].[streaming]')
*/
