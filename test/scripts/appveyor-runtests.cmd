@echo on
SET EXITVAL=0
echo %APPVEYOR_BUILD_WORKER_IMAGE%
CALL npm run-script test-unit || SET EXITVAL=1
IF "%APPVEYOR_BUILD_WORKER_IMAGE%"=="Visual Studio 2015" (
  SET VERSIONS_TO_TEST=SQL2008R2SP2,SQL2012SP1,SQL2014,SQL2016
)
IF "%APPVEYOR_BUILD_WORKER_IMAGE%"=="Visual Studio 2019" (
  SET VERSIONS_TO_TEST=SQL2017,SQL2019
)
IF NOT DEFINED VERSIONS_TO_TEST (
  SET EXITVAL=2
) ELSE (
  FOR %%S IN ( %VERSIONS_TO_TEST% ) DO (
    echo Testing %%S
    CALL powershell %cd%\test\scripts\appveyor-setupsql.ps1 %%S
    CALL npm run-script test-tedious || SET EXITVAL=1
    CALL npm run-script test-msnodesqlv8 || SET EXITVAL=1
    CALL net stop MSSQL$%%S
  )
)
EXIT /B %EXITVAL%