exec('create procedure [dbo].[__test]
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
		
	set nocount on;
	
	declare @table table (a int, b int)
	insert into @table values (1, 2)
	insert into @table values (3, 4)
	
	select * from @table
	
	select 5 as ''c'', 6 as ''d'', @in2 as ''e'', 111 as ''e'', ''asdf'' as ''e'', null as ''f'', @in3 as ''g''
	
	select * from @table where a = 11
	
	set @out = 99
	set @out2 = @in
	set @out3 = @in4
	set @out4 = @in5
	set @out5 = @in3
	
	return 11
	
end')

exec('create procedure [dbo].[__test2]
as
begin
	
	set nocount on

	declare @table table (a int, b int)
	select * from @table

	select ''asdf'' as string

	return 11

end')

exec('create procedure [dbo].[__test3]
as
begin
	
	with n(n) as (select 1 union all select n  +1 from n where n < 1000) select n from n order by n option (maxrecursion 1000) for xml auto;

end')

exec('create procedure [dbo].[__test5]
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

	select CAST( 123456 AS BINARY(4) ) as ''bin'', @in as ''in'', @in2 as ''in2'', @in3 as ''in3'', @in4 as ''in4'', @in5 as ''in5'', @in6 as ''in6''

	set @out = @in
	set @out2 = @in3

	return 0

end')

exec('create procedure [dbo].[__testDuplicateNames]
	@in int,
	@in2 int,
	@out int = NULL OUTPUT,
	@out2 int = NULL OUTPUT
as
begin
		
	set nocount on

	select @in as ''in_value'', @in2 as ''in_value''
	
	set @out = @in2
	set @out2 = @in
	
	return 12
	
end')

exec('create procedure [dbo].[__testInputOutputValue]
	@in int,
	@out int = NULL OUTPUT
as
begin
	set @out = @out + @in
end')

exec('create type [dbo].[MSSQLTestType] as table(
	[a] [varchar](50) null,
	[b] [integer] null
)')

exec('create procedure [dbo].[__test7]
	@tvp MSSQLTestType readonly
as
begin

	select * from @tvp

end')

exec('create table [dbo].[tvp_test] (
	a int not null identity,
	b varchar(50) null,
	c as ''id is '' + cast(a as varchar(10)) persisted
)')

exec('create table [dbo].[prepstm_test] (
	data varchar(50) not null
)')

exec('create table [dbo].[tran_test] (
	data varchar(50) not null
)')

exec('create table [dbo].[bulk_table] (
	a int not null,
	b varchar (50) null,
	c image null
)')

exec('create table [dbo].[rowsaffected_test] (
	a int not null
)')

;with nums as
(
    select 0 AS n
    union all
    select n + 1 from nums where n < 6
)
insert into rowsaffected_test(a)
select n from nums
option (maxrecursion 7);

exec('create table [dbo].[streaming] (
	text varchar(4000)
)')

exec('create procedure [dbo].[__testRowsAffected]
as
begin

	update rowsaffected_test set a = a

end')

;with nums as
(
    select 0 AS n
    union all
    select n + 1 from nums where n < 32767
)
insert into streaming(text)
select 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Cras commodo lacinia turpis, et volutpat magna euismod at. Sed eget interdum enim, sed sagittis augue. Donec aliquet lacinia commodo. Nunc ultricies felis ut ante lobortis consectetur. Etiam dictum elit quis eros fermentum, sed venenatis libero elementum. Cras sed luctus eros. Donec ultrices mauris a velit gravida lobortis. Sed at nulla sit amet eros semper viverra. Pellentesque aliquam accumsan ligula, sed euismod est suscipit ut. Etiam facilisis dapibus viverra. In hac habitasse platea dictumst. Quisque lacinia mattis quam, sit amet lacinia felis convallis id. Interdum et malesuada fames ac ante ipsum primis in faucibus. Proin dapibus auctor lacinia. Nam dictum orci at neque adipiscing sollicitudin. Quisque id enim rutrum, tempor arcu ut, tempor mi. Vivamus fringilla velit vel massa fringilla, a interdum felis pellentesque. Etiam faucibus felis nec elit sodales molestie. Quisque sit amet porta nisi. Nunc tellus diam, sagittis eu porta vel, sagittis eu urna. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur quis scelerisque nisl. Nulla egestas blandit felis id condimentum. Sed eleifend neque sit amet nisl vehicula molestie. Nulla ut mi dignissim, faucibus nulla quis, hendrerit neque. Maecenas luctus urna urna, eget placerat metus tempor nec. Aenean accumsan nunc at leo tempus vehicula. In hac habitasse platea dictumst. Vestibulum faucibus scelerisque nisi, et adipiscing justo. Praesent posuere placerat nibh aliquet suscipit. Morbi eget consectetur sem. Nulla erat ipsum, dapibus sit amet nulla in, dictum malesuada felis. Sed eu blandit est. Etiam suscipit lacus elit, quis pretium diam ultricies ac. Sed tincidunt mollis accumsan. Donec scelerisque sapien ac tincidunt eleifend. Quisque nec sem dolor. Suspendisse imperdiet facilisis velit, non faucibus justo consequat elementum. Sed id purus mauris. Nunc id tortor rutrum, ornare leo at, ultrices urna. Nam dolor augue, fermentum sed condimentum et, pulvinar interdum augue. Sed arcu nibh, tincidunt id bibendum ut, placerat eu odio. Phasellus viverra nisi sagittis auctor tristique. Phasellus ullamcorper mauris eget ipsum faucibus accumsan. Mauris non quam orci.' from nums
option (maxrecursion 32767);
