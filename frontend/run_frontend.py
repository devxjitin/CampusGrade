import pty
import os
import sys

pid, fd = pty.fork()
if pid == 0:
    os.chdir('/run/media/devxjitin/GitHub/CanvasGrade/frontend')
    os.environ['NEXT_DISABLE_SWC'] = '1'
    os.environ['PATH'] = '/home/devxjitin/.nvm/versions/node/v22.23.1/bin:' + os.environ.get('PATH', '')
    os.execvp('npx', ['npx', 'next', 'dev', '--webpack', '-p', '3000'])
else:
    while True:
        try:
            data = os.read(fd, 1024)
            if not data:
                break
            sys.stdout.write(data.decode('utf-8', 'ignore'))
            sys.stdout.flush()
        except Exception:
            break
