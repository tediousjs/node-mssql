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

if exists (select * from sys.procedures where name = '__testDuplicateNames')
	exec('drop procedure [dbo].[__testDuplicateNames]')

if exists (select * from sys.procedures where name = '__testInputOutputValue')
	exec('drop procedure [dbo].[__testInputOutputValue]')

if exists (select * from sys.procedures where name = '__testRowsAffected')
	exec('drop procedure [dbo].[__testRowsAffected]')

if exists (select * from sys.types where is_user_defined = 1 and name = 'MSSQLTestType')
	exec('drop type [dbo].[MSSQLTestType]')

if exists (select * from sys.tables where name = 'prepstm_test')
	exec('drop table [dbo].[tvp_test]')
	
if exists (select * from sys.tables where name = 'prepstm_test')
	exec('drop table [dbo].[prepstm_test]')
	
if exists (select * from sys.tables where name = 'tran_test')
	exec('drop table [dbo].[tran_test]')
	
if exists (select * from sys.tables where name = 'bulk_table')
	exec('drop table [dbo].[bulk_table]')

if exists (select * from sys.tables where name = 'bulk_table2')
	exec('drop table [dbo].[bulk_table2]')

if exists (select * from sys.tables where name = 'bulk_table3')
	exec('drop table [dbo].[bulk_table3]')

if exists (select * from sys.tables where name = 'bulk_table4')
	exec('drop table [dbo].[bulk_table4]')

if exists (select * from sys.tables where name = 'bulk_table5')
	exec('drop table [dbo].[bulk_table5]')

if exists (select * from sys.tables where name = 'rowsaffected_test')
	exec('drop table [dbo].[rowsaffected_test]')

if exists (select * from sys.tables where name = 'streaming')
	exec('drop table [dbo].[streaming]')


if exists (select * from sys.tables where name = 'tick_canary')
	exec('drop table [dbo].[tick_canary]')

if exists (select * from sys.tables where name = 'tvp_canary')
	exec('drop table [dbo].[tvp_canary]')

if exists (select * from sys.tables where name = 'bulk_table_unsafe')
	exec('drop table [dbo].[bulk_table_unsafe]')

if exists (select * from sys.tables where name = 'bulk_table_mutated')
	exec('drop table [dbo].[bulk_table_mutated]')

if object_id('dbo.query_canary') is not null
	exec('drop table [dbo].[query_canary]')

if object_id('dbo.exec_canary') is not null
	exec('drop table [dbo].[exec_canary]')

if object_id('dbo.bulk_size_canary') is not null
	exec('drop table [dbo].[bulk_size_canary]')

if object_id('dbo.bulk_table_size') is not null
	exec('drop table [dbo].[bulk_table_size]')

if object_id('dbo.proc_canary') is not null
	exec('drop table [dbo].[proc_canary]')

if object_id('dbo.bulk_table_order') is not null
	exec('drop table [dbo].[bulk_table_order]')

