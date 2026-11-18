# End-to-end fixture: writes its arguments, joined by spaces, to py-out.txt beside itself, then waits a
# moment so that the console window Windows shows for python stays up longer than a flash.
import pathlib
import sys
import time

pathlib.Path(sys.argv[0]).with_name("py-out.txt").write_text(" ".join(sys.argv[1:]))
time.sleep(0.5)
