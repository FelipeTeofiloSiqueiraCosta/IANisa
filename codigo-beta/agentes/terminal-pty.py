"""Terminal da Ratoeira: abre o shell da pessoa num PTY e repassa os bytes.

Roda como a pessoa, filho do servidor de agentes dela (servidor.mjs). Nada aqui interpreta texto:
o que chega pelo stdin vai pro PTY como se fosse teclado, e o que sai do PTY vai pro stdout.
O tamanho da tela chega pelo fd 3, uma linha "linhas colunas" por mudança.

Uso: terminal-pty.py <shell absoluto> <pasta absoluta> <linhas> <colunas>
"""
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

shell, pasta, linhas, colunas = sys.argv[1:]
if not os.path.isabs(shell) or not os.path.isabs(pasta):
    sys.exit(2)


def tamanho(fd, l, c):
    l, c = max(2, min(int(l), 500)), max(10, min(int(c), 1000))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", l, c, 0, 0))


pid, master = pty.fork()
if pid == 0:
    try:
        os.chdir(pasta)
    except OSError:
        os.chdir(os.environ.get("HOME", "/"))
    # "-" na frente do nome = shell de login (lê o .profile, como no SSH)
    os.execve(shell, ["-" + os.path.basename(shell)], os.environ.copy())

tamanho(master, linhas, colunas)


def parar(_sinal=None, _frame=None):
    try:
        os.killpg(pid, signal.SIGHUP)
    except ProcessLookupError:
        pass


signal.signal(signal.SIGTERM, parar)
signal.signal(signal.SIGINT, parar)
entrada, controle = sys.stdin.fileno(), 3
resto = b""
abertos = [master, entrada, controle]
try:
    while True:
        prontos, _, _ = select.select(abertos, [], [], 5)
        if master in prontos:
            try:
                dados = os.read(master, 65536)
            except OSError:
                break
            if not dados:
                break
            os.write(sys.stdout.fileno(), dados)
        if entrada in prontos:
            dados = os.read(entrada, 65536)
            if not dados:
                parar()
                break
            os.write(master, dados)
        if controle in prontos:
            dados = os.read(controle, 4096)
            if not dados:
                abertos.remove(controle)
                continue
            resto += dados
            *linhas_ctl, resto = resto.split(b"\n")
            # só a última vale; o kernel avisa o programa da frente (SIGWINCH) sozinho
            for l in linhas_ctl[-1:]:
                try:
                    tamanho(master, *l.split())
                except (ValueError, TypeError, OSError):
                    pass
except (BrokenPipeError, OSError):
    parar()
finally:
    os.close(master)
    _, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
