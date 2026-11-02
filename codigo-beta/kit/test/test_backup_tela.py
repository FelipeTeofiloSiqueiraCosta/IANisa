"""Backup pela tela de Segurança (kit/backup/backup.py, comando `tela`), sem root: o restic e o systemctl são de
mentira. Confere destino, pedido do gateway, configuração (cria, recusa e devolve a anterior) e o estado que a tela lê.
Rodar: python3 -m unittest discover -s kit/test"""
import grp, importlib.util, json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

AQUI = os.path.dirname(os.path.abspath(__file__))
BACKUP = os.path.join(AQUI, "..", "backup")

DESTINO = {"endpoint": "https://abc.r2.cloudflarestorage.com/", "bucket": "Ratoeira-Backup", "prefixo": "minha-vps",
           "regiao": "", "chave_id": "AKIA12345678", "segredo": "segredo/Muito+secreto"}
SENHA = "x" * 32


def carregar(dir):
    sys.path.insert(0, BACKUP)
    spec = importlib.util.spec_from_file_location("backup_tela", os.path.join(BACKUP, "backup.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.path.remove(BACKUP)
    d = Path(dir)
    for nome, pasta in [("STATE", "state"), ("CACHE", "cache"), ("LOGS", "logs"), ("CONFIG", "config")]:
        (d / pasta).mkdir(mode=0o700)
        setattr(mod, nome, d / pasta)
    mod.TELA = d / "tela"
    mod.PEDIDO = d / "gateway" / "backup-pedido.json"
    (d / "gateway").mkdir()
    mod.environment = lambda: {"RESTIC_REPOSITORY": "x"}
    return mod


class Falso:
    """subprocess.run de mentira: guarda os comandos e responde o restic como mandarem."""
    def __init__(self, cat=(0, ""), init=(0, "")):
        self.cmds, self.cat, self.init = [], cat, init

    def __call__(self, args, **kw):
        self.cmds.append(list(args))
        codigo, erro = (0, "")
        if args[:3] == ["restic", "cat", "config"]:
            codigo, erro = self.cat
        elif args[:2] == ["restic", "init"]:
            codigo, erro = self.init
        elif args[:2] == ["systemctl", "is-enabled"]:
            return subprocess.CompletedProcess(args, 0, "enabled\n", "")
        if kw.get("check") and codigo:
            raise subprocess.CalledProcessError(codigo, args)
        return subprocess.CompletedProcess(args, codigo, "", erro)


class BackupTela(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.mod = carregar(self.tmp.name)
        # subprocess e shutil são os módulos de todo mundo: trocar sem devolver estragava os testes que rodam depois
        self._run, self._which = self.mod.subprocess.run, self.mod.shutil.which
        self.grupo = grp.getgrgid(os.getgid()).gr_name
        self.mod.shutil.which = lambda nome: "/usr/bin/" + nome

    def tearDown(self):
        self.mod.subprocess.run, self.mod.shutil.which = self._run, self._which
        self.tmp.cleanup()

    def pedir(self, pedido, falso):
        self.mod.PEDIDO.write_text(json.dumps(pedido))
        self.mod.subprocess.run = falso
        codigo = self.mod.tela(self.grupo)
        return codigo, json.loads((self.mod.TELA / "estado.json").read_text())

    def test_destino_vira_repositorio_s3_e_recusa_o_que_nao_presta(self):
        env = self.mod.validar_destino(DESTINO)
        self.assertEqual(env, {"RESTIC_REPOSITORY": "s3:https://abc.r2.cloudflarestorage.com/ratoeira-backup/minha-vps",
                               "AWS_ACCESS_KEY_ID": "AKIA12345678", "AWS_SECRET_ACCESS_KEY": "segredo/Muito+secreto",
                               "AWS_DEFAULT_REGION": "auto"})
        for ruim in [{"endpoint": "http://abc.com"}, {"endpoint": "https://abc.com/bucket"}, {"bucket": "a"},
                     {"prefixo": "../etc"}, {"segredo": "tem espaço no meio"}, {"chave_id": "x"}]:
            with self.assertRaises(self.mod.Recusa, msg=ruim):
                self.mod.validar_destino({**DESTINO, **ruim})

    def test_configurar_cria_o_repositorio_liga_o_timer_e_a_tela_nao_ve_segredo(self):
        falso = Falso(cat=(1, "Fatal: unable to open config file: Stat: The specified key does not exist.\nIs there a repository at the following location?"))
        codigo, estado = self.pedir({"acao": "configurar", "destino": DESTINO, "senha": SENHA}, falso)
        self.assertEqual(codigo, 0, estado)
        self.assertTrue(estado["pedido"]["ok"])
        self.assertIn(["restic", "init", "--repository-version", "2"], falso.cmds)
        self.assertIn(["systemctl", "enable", "--now", "ratoeira-backup.timer"], falso.cmds)
        self.assertIn(["systemctl", "start", "--no-block", "ratoeira-backup.service"], falso.cmds)
        self.assertFalse(self.mod.PEDIDO.exists(), "o pedido (com a chave) some")
        cfg = self.mod.CONFIG
        self.assertEqual((cfg / "password").read_text().strip(), SENHA)
        self.assertEqual(oct((cfg / "restic-env.json").stat().st_mode & 0o777), "0o600")
        self.assertEqual(json.loads((cfg / "config.json").read_text()), {"upload_kib_per_second": 4096, "bancos": "avisar", "origem": "tela"})
        texto = (self.mod.TELA / "estado.json").read_text()
        self.assertNotIn("secreto", texto)
        self.assertNotIn(SENHA, texto)
        self.assertEqual(estado["destino"], {"tipo": "s3", "host": "abc.r2.cloudflarestorage.com", "caminho": "ratoeira-backup/minha-vps"})
        self.assertTrue(estado["configurado"] and estado["pela_tela"] and estado["timer"])
        self.assertEqual(oct((self.mod.TELA / "estado.json").stat().st_mode & 0o777), "0o640")
        self.assertEqual(oct(self.mod.TELA.stat().st_mode & 0o777), "0o750", "o gateway (grupo) entra na pasta")

    def test_senha_errada_ou_chave_recusada_devolvem_a_config_de_antes(self):
        cfg = self.mod.CONFIG
        (cfg / "restic-env.json").write_text('{"RESTIC_REPOSITORY": "s3:https://velho/b"}\n')
        (cfg / "password").write_text("velha\n")
        (cfg / "config.json").write_text('{"origem": "tela"}\n')
        codigo, estado = self.pedir({"acao": "configurar", "destino": DESTINO, "senha": SENHA},
                                    Falso(cat=(1, "Fatal: wrong password or no key found")))
        self.assertEqual(codigo, 1)
        self.assertIn("outra senha", estado["pedido"]["erro"])
        self.assertEqual((cfg / "password").read_text(), "velha\n")
        self.assertIn("velho", (cfg / "restic-env.json").read_text())
        codigo, estado = self.pedir({"acao": "configurar", "destino": DESTINO, "senha": SENHA},
                                    Falso(cat=(1, "Fatal: ... api error AccessDenied: Access Denied.")))
        self.assertIn("recusou a chave", estado["pedido"]["erro"])

    def test_backup_montado_a_mao_a_tela_nao_mexe(self):
        cfg = self.mod.CONFIG
        (cfg / "restic-env.json").write_text('{"RESTIC_REPOSITORY": "s3:https://nosso/b"}\n')
        (cfg / "password").write_text("nossa\n")
        (cfg / "config.json").write_text('{"upload_kib_per_second": 8192}\n')
        codigo, estado = self.pedir({"acao": "configurar", "destino": DESTINO, "senha": SENHA}, Falso())
        self.assertEqual(codigo, 1)
        self.assertIn("à mão", estado["pedido"]["erro"])
        self.assertEqual((cfg / "password").read_text(), "nossa\n")
        self.assertFalse(estado["pela_tela"])
        self.assertEqual(estado["destino"]["host"], "nosso")

    def test_agora_desligar_e_pedido_estranho(self):
        codigo, estado = self.pedir({"acao": "agora"}, Falso())
        self.assertEqual(estado["pedido"]["erro"], "O backup ainda não foi configurado.")
        (self.mod.CONFIG / "restic-env.json").write_text("{}")
        falso = Falso()
        codigo, estado = self.pedir({"acao": "desligar"}, falso)
        self.assertTrue(estado["pedido"]["ok"])
        self.assertIn(["systemctl", "disable", "--now", "ratoeira-backup.timer"], falso.cmds)
        codigo, estado = self.pedir({"acao": "apagar-tudo"}, Falso())
        self.assertEqual(estado["pedido"]["erro"], "Pedido desconhecido.")

    def test_pedido_que_e_atalho_nao_e_lido(self):
        alvo = Path(self.tmp.name) / "alvo.json"
        alvo.write_text(json.dumps({"acao": "agora"}))
        os.symlink(alvo, self.mod.PEDIDO)
        self.mod.subprocess.run = Falso()
        self.assertEqual(self.mod.tela(self.grupo), 1)
        estado = json.loads((self.mod.TELA / "estado.json").read_text())
        self.assertEqual(estado["pedido"]["erro"], "pedido inválido")
        self.assertTrue(alvo.exists())
        self.assertFalse(os.path.lexists(self.mod.PEDIDO))

    def test_bancos_no_modo_avisar_nao_param_o_backup(self):
        self.mod.command = lambda args: "systemd\npostgres\nnode\n"
        self.mod.shutil.which = lambda nome: None
        with self.assertRaises(RuntimeError):
            self.mod.guard_databases()
        self.mod.guard_databases("avisar")


if __name__ == "__main__":
    unittest.main()
