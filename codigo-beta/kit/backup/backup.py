#!/usr/bin/python3
"""Daily host backup. All configuration, logs and state are root-only.

Desde 28/10/2026 também é configurado pela tela (Configurações › Segurança › Esta VPS › Backup fora da VPS): o
gateway grava um pedido (RATOEIRA_BACKUP_PEDIDO) e liga ratoeira-backup-tela.service, que roda `tela` como root.
O que a tela pode ver (sem segredo) fica em TELA/estado.json, do grupo do gateway.
"""
import argparse
import grp
import re
import fcntl
import json
import os
import shutil
import socket
import sqlite3
import stat
import subprocess
import sys
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from sqlite_snapshot import sha256, snapshot_roots

STATE = Path('/var/lib/ratoeira-backup')
CACHE = Path('/var/cache/ratoeira-backup')
LOGS = Path('/var/log/ratoeira-backup')
CONFIG = Path('/etc/ratoeira-backup')
TELA = Path(os.environ.get('RATOEIRA_BACKUP_TELA', '/var/lib/ratoeira/backup'))
PEDIDO = Path(os.environ.get('RATOEIRA_BACKUP_PEDIDO', '/var/lib/ratoeira/gateway-estado/backup-pedido.json'))
TIMER = 'ratoeira-backup.timer'
TAG = 'ratoeira-full'
COMPLETE_TAG = 'backup-complete'
EXCLUDES = ['/proc', '/sys', '/dev', '/run', '/tmp', '/var/tmp', '/swapfile',
            '/swap.img', str(CACHE), str(LOGS), str(STATE / 'restore-tests'),
            str(STATE / '.preparing'), str(STATE / 'staging-old'),
            # Docker: camadas de imagem e contêiner se refazem do Dockerfile. Os dados dos apps em Docker
            # (ex.: Pipeline) ficam em pasta montada no disco, que entra no backup com cópia consistente do SQLite.
            '/var/lib/docker', '/var/lib/containerd']
PERSISTENT = {'ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'vfat', 'zfs', 'f2fs'}
VOLATILE = {'proc', 'sysfs', 'tmpfs', 'devtmpfs', 'devpts', 'cgroup', 'cgroup2',
            'securityfs', 'pstore', 'bpf', 'debugfs', 'tracefs', 'fusectl',
            'configfs', 'mqueue', 'hugetlbfs', 'autofs', 'binfmt_misc', 'efivarfs',
            'squashfs', 'nsfs', 'overlay'}


def now():
    return datetime.now(timezone.utc).isoformat()


def private_json(path, data):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.new')
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as stream:
        json.dump(data, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def write_status(path, **fields):
    path = Path(path)
    data = json.loads(path.read_text()) if path.exists() else {}
    data.update(fields, updated_at=now())
    private_json(path, data)
    try:
        estado_tela()
    except Exception as error:
        print(f'Aviso: não atualizei o estado da tela: {error}', flush=True)


# ── Tela (Configurações › Segurança) ─────────────────────────────────────────────────────────────────────────────
ENDPOINT = re.compile(r'^https://[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:[0-9]{2,5})?$')
BUCKET = re.compile(r'^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$')
PREFIXO = re.compile(r'^[A-Za-z0-9._-]{1,60}(/[A-Za-z0-9._-]{1,60}){0,3}$')
CHAVE_ID = re.compile(r'^[A-Za-z0-9_+/=.-]{8,200}$')
SEGREDO = re.compile(r'^[\x21-\x7e]{8,300}$')
REGIAO = re.compile(r'^[a-z0-9-]{2,40}$')


class Recusa(Exception):
    pass


def destino_publico():
    """Onde o backup vai, sem chave: s3:https://host/bucket/prefixo → host e caminho."""
    try:
        repo = json.loads((CONFIG / 'restic-env.json').read_text()).get('RESTIC_REPOSITORY', '')
    except (OSError, ValueError):
        return None
    m = re.match(r'^s3:https?://([^/]+)/(.+)$', repo)
    return {'tipo': 's3', 'host': m.group(1), 'caminho': m.group(2)} if m else {'tipo': repo.split(':', 1)[0] or 'local'}


def timer_ligado():
    r = subprocess.run(['systemctl', 'is-enabled', TIMER], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    return r.stdout.strip() == 'enabled'


def estado_tela(pedido=None):
    """Grava TELA/estado.json (grupo do gateway, 640) se a pasta existe. Só o que a tela pode ver."""
    if not TELA.is_dir() or TELA.is_symlink():
        return
    status = STATE / 'status.json'
    data = json.loads(status.read_text()) if status.exists() else {'status': 'never-ran'}
    configurado = (CONFIG / 'restic-env.json').exists() and (CONFIG / 'password').exists()
    try:
        cfg = json.loads((CONFIG / 'config.json').read_text())
    except (OSError, ValueError):
        cfg = {}
    anterior = {}
    arq = TELA / 'estado.json'
    try:
        anterior = json.loads(arq.read_text())
    except (OSError, ValueError):
        pass
    saida = {
        'configurado': configurado, 'pela_tela': cfg.get('origem') == 'tela', 'destino': destino_publico() if configurado else None,
        'timer': timer_ligado(), 'status': data.get('status'), 'ultimo_ok': data.get('last_success'),
        'comecou': data.get('started_at'), 'erro': data.get('error'), 'snapshot': data.get('snapshot'),
        'atualizado': now(), 'pedido': pedido if pedido is not None else anterior.get('pedido'),
    }
    gid = TELA.stat().st_gid
    tmp = TELA / ('.estado.' + str(os.getpid()))
    with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o640), 'w') as stream:
        json.dump(saida, stream, ensure_ascii=False, indent=1)
        stream.write('\n')
    if os.geteuid() == 0:
        os.chown(tmp, 0, gid)
    os.chmod(tmp, 0o640)
    os.replace(tmp, arq)


def ler_pedido():
    """O pedido do gateway: arquivo comum, pequeno, não segue symlink. Lido e apagado na hora (leva a chave)."""
    try:
        fd = os.open(PEDIDO, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return None
    except OSError:
        PEDIDO.unlink(missing_ok=True)
        raise Recusa('pedido inválido')
    try:
        meta = os.fstat(fd)
        if not stat.S_ISREG(meta.st_mode) or meta.st_size > 8192:
            raise Recusa('pedido inválido')
        with os.fdopen(fd, 'r') as stream:
            fd = None
            return json.load(stream)
    finally:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(PEDIDO)
        except FileNotFoundError:
            pass


def validar_destino(d):
    if not isinstance(d, dict):
        raise Recusa('Destino inválido.')
    endpoint = str(d.get('endpoint', '')).strip().rstrip('/').lower()
    bucket = str(d.get('bucket', '')).strip().lower()
    prefixo = str(d.get('prefixo', '') or '').strip().strip('/')
    regiao = str(d.get('regiao', '') or 'auto').strip().lower()
    chave_id, segredo = str(d.get('chave_id', '')).strip(), str(d.get('segredo', '')).strip()
    if not ENDPOINT.match(endpoint):
        raise Recusa('Endereço (endpoint) inválido: começa com https:// e não leva o bucket.')
    if not BUCKET.match(bucket):
        raise Recusa('Nome do bucket inválido.')
    if prefixo and (not PREFIXO.match(prefixo) or '..' in prefixo):
        raise Recusa('Pasta dentro do bucket inválida.')
    if not REGIAO.match(regiao):
        raise Recusa('Região inválida.')
    if not CHAVE_ID.match(chave_id) or not SEGREDO.match(segredo):
        raise Recusa('Chave de acesso inválida: confira o ID e o segredo.')
    repo = f's3:{endpoint}/{bucket}' + (f'/{prefixo}' if prefixo else '')
    return {'RESTIC_REPOSITORY': repo, 'AWS_ACCESS_KEY_ID': chave_id, 'AWS_SECRET_ACCESS_KEY': segredo, 'AWS_DEFAULT_REGION': regiao}


def explicar(erro, padrao):
    """Erro do restic (0.16 não tem código de saída por tipo) em português pra quem configurou."""
    e = erro.lower()
    if 'wrong password' in e or 'no key found' in e:
        return 'Já tem um backup nesse lugar, com outra senha. Use outro bucket (ou outra pasta dentro dele).'
    if 'no such host' in e or 'server misbehaving' in e or 'connection refused' in e or 'i/o timeout' in e or 'remote error' in e or 'tls:' in e:
        return 'Não achei esse endereço (endpoint). Confira se copiou inteiro, começando com https://.'
    if any(x in e for x in ['access denied', 'accessdenied', 'forbidden', '403', 'invalidaccesskeyid', 'signaturedoesnotmatch', '400 bad request', 'unauthorized', '401']):
        return 'O destino recusou a chave: confira o ID, o segredo, a região e se ela pode ler e gravar nesse bucket.'
    if 'nosuchbucket' in e or 'bucket does not exist' in e or 'bucket not found' in e:
        return 'Esse bucket não existe nesse destino. Crie ele antes (ou confira o nome).'
    linhas = [l for l in erro.strip().splitlines() if l.strip()]
    return padrao + (': ' + linhas[-1][:160] if linhas else '.')


def gravar_privado(path, texto):
    tmp = Path(str(path) + '.new')
    with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600), 'w') as stream:
        stream.write(texto)
    if os.geteuid() == 0:
        os.chown(tmp, 0, 0)
    os.replace(tmp, path)


def configurar(pedido):
    """Destino novo: grava, confere o repositório (cria se não existe; senha errada recusa) e liga o timer."""
    env_novo = validar_destino(pedido.get('destino'))
    senha = str(pedido.get('senha', ''))
    if not re.match(r'^[\x21-\x7e]{20,200}$', senha):
        raise Recusa('Senha do backup inválida.')
    if not shutil.which('restic'):
        r = subprocess.run(['apt-get', 'install', '-y', '-q', 'restic'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                           env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'})
        if r.returncode or not shutil.which('restic'):
            raise Recusa('Não consegui instalar o restic (apt).')
    guardado = {}
    for nome in ['restic-env.json', 'password', 'config.json']:
        try:
            guardado[nome] = (CONFIG / nome).read_text()
        except FileNotFoundError:
            guardado[nome] = None
    try:
        cfg = json.loads(guardado['config.json']) if guardado['config.json'] else {}
    except ValueError:
        cfg = {}
    if guardado['restic-env.json'] and cfg.get('origem') != 'tela':
        raise Recusa('O backup desta VPS foi montado à mão. A tela não mexe nele: peça pra quem montou.')
    cfg.setdefault('upload_kib_per_second', 4096)
    cfg.update(bancos='avisar', origem='tela')
    gravar_privado(CONFIG / 'restic-env.json', json.dumps(env_novo, indent=2) + '\n')
    gravar_privado(CONFIG / 'password', senha + '\n')
    gravar_privado(CONFIG / 'config.json', json.dumps(cfg, indent=2) + '\n')
    try:
        env = environment()
        r = subprocess.run(['restic', 'cat', 'config'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=120)
        if r.returncode:
            erro = r.stderr.lower()
            # sem repositório ainda (ou o restic 0.16 não sabe dizer por quê): tenta criar; a resposta do init explica
            if 'is there a repository' in erro or 'unable to open config file' in erro or 'does not exist' in erro:
                i = subprocess.run(['restic', 'init', '--repository-version', '2'], env=env, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.PIPE, text=True, timeout=180)
                if i.returncode:
                    raise Recusa(explicar(i.stderr, 'O destino recusou criar o backup'))
            else:
                raise Recusa(explicar(r.stderr, 'Não consegui falar com o destino'))
    except BaseException:
        for nome, texto in guardado.items():
            if texto is None:
                (CONFIG / nome).unlink(missing_ok=True)
            else:
                gravar_privado(CONFIG / nome, texto)
        raise
    subprocess.run(['systemctl', 'enable', '--now', TIMER], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    # o primeiro já sai agora, em segundo plano
    subprocess.run(['systemctl', 'start', '--no-block', 'ratoeira-backup.service'], check=False)


def tela(grupo):
    """Atende o pedido da tela (se tiver) e atualiza o estado que ela lê."""
    if not TELA.exists():
        gid = grp.getgrnam(grupo).gr_gid
        TELA.mkdir(parents=True)
        os.chown(TELA, 0 if os.geteuid() == 0 else -1, gid)
    if not TELA.is_symlink():
        os.chmod(TELA, 0o750)   # o umask 077 do backup cortaria o grupo do gateway
    try:
        pedido = ler_pedido()
    except (Recusa, ValueError) as error:
        pedido, problema = {'acao': '?'}, str(error)
    else:
        problema = None
    resultado = None
    if pedido is not None:
        acao = pedido.get('acao')
        resultado = {'acao': acao, 'ok': False, 'em': now()}
        try:
            if problema:
                raise Recusa(problema)
            if acao == 'configurar':
                configurar(pedido)
            elif acao in ('agora', 'ligar', 'desligar'):
                if not (CONFIG / 'restic-env.json').exists():
                    raise Recusa('O backup ainda não foi configurado.')
                if acao == 'agora':
                    subprocess.run(['systemctl', 'start', '--no-block', 'ratoeira-backup.service'], check=True)
                else:
                    subprocess.run(['systemctl', 'enable' if acao == 'ligar' else 'disable', '--now', TIMER], check=True,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            else:
                raise Recusa('Pedido desconhecido.')
            resultado['ok'] = True
        except Recusa as error:
            resultado['erro'] = str(error)
        except Exception as error:
            resultado['erro'] = 'Falhou: ' + str(error)[:200]
    estado_tela(resultado)
    return 0 if resultado is None or resultado['ok'] else 1


def healthy(data):
    if data.get('status') != 'ok' or not data.get('last_success'):
        return False
    age = datetime.now(timezone.utc) - datetime.fromisoformat(data['last_success'])
    return 0 <= age.total_seconds() <= 30 * 3600


def persistent_roots(mounts):
    result = []
    def visit(entries):
        for entry in entries:
            fs = entry['fstype']
            if fs in PERSISTENT:
                result.append(entry['target'])
            elif fs not in VOLATILE:
                raise RuntimeError(f'Filesystem requires explicit backup integration: {entry["target"]} ({fs})')
            visit(entry.get('children', []))
    visit(mounts['filesystems'])
    return sorted(set(result))


def command(args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout


def guard_databases(modo='parar'):
    # Current host only has SQLite. Do not silently call raw server data a DB backup.
    # modo 'avisar' (o que a tela grava, pros alunos): segue o backup e deixa o aviso no estado. Banco em Docker com
    # volume nomeado fica fora (está em /var/lib/docker); em pasta montada, a cópia pode sair inconsistente.
    processes = set(command(['ps', '-eo', 'comm=']).split())
    unsupported = processes & {'postgres', 'postmaster', 'mysqld', 'mariadbd',
                               'mongod', 'redis-server', 'cockroach', 'valkey-server'}
    if unsupported and modo != 'avisar':
        raise RuntimeError('Configure consistent database dumps before backing up: ' + ', '.join(sorted(unsupported)))
    if unsupported:
        print('Aviso: bancos sem cópia consistente: ' + ', '.join(sorted(unsupported)), flush=True)
    # Contêiner ligado não trava mais o backup (12/10/2026): servidor de banco dentro dele aparece no ps acima
    # e trava; volume nomeado do Docker não entra (está em /var/lib/docker), então app em Docker guarda dado
    # em pasta montada.
    if shutil.which('docker'):
        volumes = command(['docker', 'volume', 'ls', '-q']).split()
        if volumes:
            print('Aviso: volumes do Docker ficam fora do backup: ' + ', '.join(volumes), flush=True)


def prepare(config=None):
    guard_databases((config or {}).get('bancos', 'parar'))
    mounts = json.loads(command(['findmnt', '--json', '-o', 'TARGET,SOURCE,FSTYPE,OPTIONS']))
    roots = persistent_roots(mounts)
    if '/' not in roots:
        raise RuntimeError('Root filesystem missing from backup')
    preparing = STATE / '.preparing'
    if preparing.exists():
        shutil.rmtree(preparing)
    preparing.mkdir(mode=0o700)
    inventory = preparing / 'inventory'
    inventory.mkdir(mode=0o700)
    commands = {
        'packages.txt': ['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\n'],
        'kernel.txt': ['uname', '-a'],
        'disks.json': ['lsblk', '--json', '-o', 'NAME,SIZE,FSTYPE,UUID,MOUNTPOINTS'],
        'services.txt': ['systemctl', 'list-unit-files', '--no-pager'],
        'timers.txt': ['systemctl', 'list-timers', '--all', '--no-pager'],
        'addresses.json': ['ip', '-json', 'address'],
        'routes.json': ['ip', '-json', 'route'],
        'restic.txt': ['restic', 'version'],
    }
    for filename, args in commands.items():
        (inventory / filename).write_text(command(args))
    private_json(inventory / 'mounts.json', mounts)
    private_json(inventory / 'host.json', {'hostname': socket.gethostname(), 'created_at': now(),
                                          'roots': roots, 'excludes': EXCLUDES})
    sqlite = snapshot_roots(roots, preparing / 'sqlite', EXCLUDES + [STATE])
    private_json(inventory / 'checksums.json', {
        str(path): sha256(path) for path in [Path('/etc/os-release'), Path('/etc/passwd')]
    })
    old = STATE / 'staging-old'
    if old.exists():
        shutil.rmtree(old)
    stage = STATE / 'staging'
    if stage.exists():
        stage.rename(old)
    preparing.rename(stage)
    if old.exists():
        shutil.rmtree(old)
    print(f'Prepared {len(sqlite)} consistent SQLite copies; filesystems: {roots}', flush=True)
    return roots, len(sqlite)


def environment():
    path = CONFIG / 'restic-env.json'
    for secret in [path, CONFIG / 'password']:
        meta = secret.stat()
        if meta.st_uid != 0 or stat.S_IMODE(meta.st_mode) & 0o077 or not stat.S_ISREG(meta.st_mode):
            raise RuntimeError(f'Secret must be a root-owned private file: {secret}')
    settings = json.loads(path.read_text())
    allowed = {'RESTIC_REPOSITORY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_DEFAULT_REGION'}
    if set(settings) - allowed or not settings.get('RESTIC_REPOSITORY'):
        raise RuntimeError('Invalid restic-env.json keys or missing repository')
    env = os.environ.copy()
    # Do not inherit credentials or restic options from an interactive caller.
    for key in list(env):
        if key.startswith(('RESTIC_', 'AWS_')):
            del env[key]
    env.update(settings, RESTIC_PASSWORD_FILE=str(CONFIG / 'password'),
               RESTIC_CACHE_DIR=str(CACHE), RESTIC_COMPRESSION='auto', GOMAXPROCS='2')
    return env


def restic(config, env, args, log):
    executable = ['restic', '--retry-lock', '5m', '--cache-dir', str(CACHE)]
    if config.get('upload_kib_per_second', 0):
        executable += ['--limit-upload', str(config['upload_kib_per_second'])]
    with Path(log).open('ab') as stream:
        stream.write(('\nCOMMAND ' + args[0] + ' ' + now() + '\n').encode())
        result = subprocess.run(executable + args, env=env, stdout=subprocess.PIPE, stderr=stream)
        stream.write(result.stdout)
    if result.returncode:
        raise RuntimeError(f'restic {args[0]} failed ({result.returncode}); see {log}')
    return result.stdout.decode()


def upload_and_maintain(config, env, roots, log):
    args = ['backup', '--json', '--one-file-system', '--host', socket.gethostname(), '--tag', TAG]
    for path in EXCLUDES:
        args += ['--exclude', path]
    output = restic(config, env, args + roots, log)
    summaries = [json.loads(line) for line in output.splitlines() if line.strip()]
    summary = next(item for item in summaries if item.get('message_type') == 'summary')
    snapshot = summary['snapshot_id']
    check_args = ['check']
    today = datetime.now(timezone.utc)
    if today.weekday() == 6:
        check_args += ['--read-data-subset', f'{today.isocalendar().week % 4 + 1}/4']
    restic(config, env, check_args, log)
    # Incomplete uploads remain unmarked and cannot displace good retention points.
    restic(config, env, ['tag', '--add', COMPLETE_TAG, snapshot], log)
    snapshots = json.loads(restic(config, env, ['snapshots', '--json', '--host', socket.gethostname(),
                                               '--tag', f'{TAG},{COMPLETE_TAG}', '--latest', '1'], log))
    completed = max(snapshots, key=lambda item: item['time'])
    args = ['forget', '--host', socket.gethostname(), '--tag', f'{TAG},{COMPLETE_TAG}',
            '--group-by', 'host,paths', '--keep-daily', '14', '--keep-weekly', '8', '--keep-monthly', '6']
    if today.weekday() == 6:
        args += ['--prune']
    restic(config, env, args, log)
    return completed['id'], summary


def verify_restore(config, env, snapshot):
    target = STATE / 'restore-tests' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
    target.mkdir(mode=0o700, parents=True, exist_ok=False)
    stage = STATE / 'staging'
    args = ['restore', snapshot, '--target', str(target), '--verify',
            '--include', str(stage), '--include', '/etc/os-release', '--include', '/etc/passwd',
            '--include', '/usr/lib/os-release']
    log = LOGS / 'verify-restore.log'
    restic(config, env, args, log)
    restored_stage = target / stage.relative_to('/')
    manifest = json.loads((restored_stage / 'sqlite/manifest.json').read_text())
    for item in manifest:
        copy = restored_stage / 'sqlite' / item['copy']
        if sha256(copy) != item['sha256']:
            raise RuntimeError('Restored SQLite hash mismatch: ' + item['source'])
        with closing(sqlite3.connect(copy.as_uri() + '?mode=ro', uri=True)) as db:
            if [row[0] for row in db.execute('pragma integrity_check')] != ['ok']:
                raise RuntimeError('Restored SQLite integrity check failed: ' + item['source'])
    hashes = json.loads((restored_stage / 'inventory/checksums.json').read_text())
    for original, expected in hashes.items():
        if sha256(target / original.lstrip('/')) != expected:
            raise RuntimeError('Restored file hash mismatch: ' + original)
    result = {'snapshot': snapshot, 'verified_at': now(), 'sqlite_count': len(manifest),
              'sample_files': list(hashes), 'target': str(target)}
    private_json(STATE / 'last-restore-test.json', result)
    print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'init', 'run', 'status', 'verify-restore', 'restic', 'tela'])
    parser.add_argument('rest', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run with sudo')
    os.umask(0o077)
    for folder in [STATE, CACHE, LOGS, CONFIG]:
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    status = STATE / 'status.json'
    if args.action == 'tela':
        # não pega o lock do backup: configurar no meio de um backup rodando só troca o que vale pro próximo
        return tela(os.environ.get('RATOEIRA_GRUPO', 'ratoeira-gw'))
    if args.action == 'status':
        data = json.loads(status.read_text()) if status.exists() else {'status': 'never-ran'}
        print(json.dumps(data, indent=2))
        return 0 if healthy(data) else 1
    with (STATE / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'prepare':
            prepare()
            return 0
        if args.action == 'run':
            write_status(status, status='running', started_at=now(), error=None)
        try:
            config = json.loads((CONFIG / 'config.json').read_text())
            env = environment()
        except Exception as error:
            if args.action == 'run':
                write_status(status, status='failed', error=str(error))
            raise
        log = LOGS / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '.log')
        if args.action == 'restic':
            print(restic(config, env, args.rest, log))
            return 0
        if args.action == 'init':
            print(restic(config, env, ['init', '--repository-version', '2'], log))
            return 0
        if args.action == 'verify-restore':
            snapshot = args.rest[0] if args.rest else json.loads(status.read_text())['snapshot']
            verify_restore(config, env, snapshot)
            return 0
        write_status(status, status='running', started_at=now(), log=str(log), error=None)
        try:
            roots, sqlite_count = prepare(config)
            snapshot, summary = upload_and_maintain(config, env, roots, log)
            write_status(status, status='ok', last_success=now(), snapshot=snapshot,
                         sqlite_count=sqlite_count, roots=roots, summary=summary, error=None)
            print(f'Backup complete: {snapshot}', flush=True)
            # These are only this utility’s old run logs, never backed-up user files.
            for previous in sorted(LOGS.glob('*.log'), key=lambda p: p.stat().st_mtime)[:-60]:
                previous.unlink()
            return 0
        except Exception as error:
            write_status(status, status='failed', error=str(error))
            raise


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(f'Backup failed: {error}', file=sys.stderr)
        sys.exit(1)
