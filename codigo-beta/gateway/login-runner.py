"""Give only an approved login command a PTY; never run user-provided shell text."""
import os
import pty
import select
import signal
import sys
import termios
import fcntl
import struct

provider, binary = sys.argv[1:]
if provider not in ("claude", "claude-token", "codex", "codex-geral") or not os.path.isabs(binary):
    sys.exit(2)
# claude-token: token de longa duração da conta geral da Ratoeira (o gateway guarda o que sair no fim)
# codex-geral: login do ChatGPT da conta geral, num CODEX_HOME só dele (o gateway lê o auth.json no fim)
args = [binary] + {"claude": ["auth", "login", "--claudeai"], "claude-token": ["setup-token"], "codex": ["login", "--device-auth"], "codex-geral": ["login", "--device-auth"]}[provider]
pid, master = pty.fork()
if pid:
    # Terminal largo: sem isso o CLI quebra a linha em 80 colunas e o token do setup-token sai partido.
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 250, 0, 0))
if pid == 0:
    attrs = termios.tcgetattr(0)
    attrs[3] &= ~termios.ECHO
    termios.tcsetattr(0, termios.TCSANOW, attrs)
    os.execve(binary, args, os.environ.copy())

def stop(_signal=None, _frame=None):
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    while True:
        ready, _, _ = select.select([master, sys.stdin.fileno()], [], [], 1)
        if master in ready:
            try:
                data = os.read(master, 16384)
            except OSError:
                break
            if not data:
                break
            os.write(sys.stdout.fileno(), data)
        if sys.stdin.fileno() in ready:
            data = os.read(sys.stdin.fileno(), 4096)
            if not data:
                stop()
                break
            os.write(master, data)
except (BrokenPipeError, OSError):
    stop()
finally:
    os.close(master)
    _, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
