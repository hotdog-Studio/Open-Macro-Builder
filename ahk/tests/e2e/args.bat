@echo off
rem End-to-end fixture: writes its first three arguments, joined by |, to bat-out-<4th argument>.txt
rem beside itself, then waits a moment so that its console window stays up longer than a flash.
>"%~dp0bat-out-%4.txt" echo %1^|%2^|%3
ping -n 2 127.0.0.1 >nul
