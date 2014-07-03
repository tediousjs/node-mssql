create procedure [dbo].[__test]
	@in int,
	@in2 int,
	@in3 varchar (10),
	@in4 uniqueidentifier = null,
	@in5 datetime = null,
	@out int output,
	@out2 int output,
	@out3 uniqueidentifier = null output,
	@out4 datetime = null output,
	@out5 char(10) = null output
as
begin
	
	set nocount on

	declare @table table (a int, b int)
	insert into @table values (1, 2)
	insert into @table values (3, 4)

	select * from @table

	select 5 as 'c', 6 as 'd', @in2 as 'e', 111 as 'e', 'asdf' as 'e', null as 'f', @in3 as 'g'

	select * from @table where a = 11

	set @out = 99
	set @out2 = @in
	set @out3 = @in4
	set @out4 = @in5
	set @out5 = @in3

	return 11

end

go

create procedure [dbo].[__test2]
as
begin
	
	set nocount on

	declare @table table (a int, b int)
	select * from @table

	select 'asdf' as string

	return 11

end

go

create procedure [dbo].[__test5]
	@in BINARY(4),
	@in2 BINARY(4) = NULL,
	@in3 VARBINARY(MAX),
	@in4 VARBINARY(MAX) = NULL,
	@in5 IMAGE,
	@in6 IMAGE = NULL,
	@out BINARY(4) = NULL OUTPUT,
	@out2 VARBINARY(MAX) = NULL OUTPUT
as
begin
	
	set nocount on

	select CAST( 123456 AS BINARY(4) ) as 'bin', @in as 'in', @in2 as 'in2', @in3 as 'in3', @in4 as 'in4', @in5 as 'in5', @in6 as 'in6'

	set @out = @in
	set @out2 = @in3

	return 0

end

go

create type [dbo].[MSSQLTestType] as table(
	[a] [varchar](50) null,
	[b] [integer] null
)

go

create procedure [dbo].[__test7]
	@tvp MSSQLTestType readonly
as
begin

	select * from @tvp

end

go

create table [dbo].[tran_test] (
	data varchar(50) not null
)