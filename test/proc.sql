create procedure [dbo].[__test]
	@in int,
	@in2 int,
	@out int output,
	@out2 int output
as
begin
	
	set nocount on

	declare @table table (a int, b int)
	insert into @table values (1, 2)
	insert into @table values (3, 4)

	select * from @table

	select 5 as 'c', 6 as 'd', @in2 as 'e', 111 as 'e', 'asdf' as 'e'

	select * from @table where a = 11

	set @out = 99
	set @out2 = @in

	return 11

end