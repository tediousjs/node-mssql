create procedure [dbo].[__test]
	@in int,
	@in2 int,
	@in3 varchar (10),
	@out int output,
	@out2 int output
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

create table [dbo].[tran_test] (
	data varchar(50) not null
)
