"""publicar-app: definir_chaves_app junta as chaves do arquivo da pessoa no chaves.env do app (28/10/2026)."""
import importlib.machinery, importlib.util, os, pwd, tempfile, types, unittest

AQUI = os.path.dirname(os.path.abspath(__file__))


def carregar():
    caminho = os.path.join(AQUI, "..", "multiusuario", "publicar-app")
    loader = importlib.machinery.SourceFileLoader("publicar_app", caminho)
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("publicar_app", loader))
    loader.exec_module(mod)
    return mod


class JuntarChaves(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pa = carregar()
        eu = pwd.getpwuid(os.getuid())
        casa = os.path.join(self.tmp.name, "casa")
        # a pessoa "ana" é o usuário que roda o teste, com a casa numa pasta temporária
        falso = types.SimpleNamespace(pw_name="ana", pw_dir=casa, pw_uid=eu.pw_uid, pw_gid=eu.pw_gid)
        self.pa.pwd = type("P", (), {"getpwnam": staticmethod(lambda n: falso if n == "ana" else (_ for _ in ()).throw(KeyError(n)))})
        # gravar como root (chown 0:0) não roda no teste: grava sem trocar o dono
        original = self.pa.gravar
        self.pa.gravar = lambda c, t, m=0o644, d=None: original(c, t, m, None)
        self.dir = os.path.join(casa, ".config", "ratoeira", "chaves-apps")
        os.makedirs(self.dir)
        self.origem = os.path.join(self.dir, "pedidos.env")
        self.destino = os.path.join(self.tmp.name, "chaves.env")
        with open(self.destino, "w") as f:
            f.write("# chaves do app (NOME=valor), uma por linha\nERP_TOKEN=velho\nOUTRA=fica\n")

    def tearDown(self):
        self.tmp.cleanup()

    def escrever(self, texto, modo=0o600):
        with open(self.origem, "w") as f:
            f.write(texto)
        os.chmod(self.origem, modo)

    def ler(self):
        with open(self.destino) as f:
            return f.read()

    def test_troca_mantem_ignora_e_apaga_a_origem(self):
        self.escrever("ERP_TOKEN=novo\nNAO_DECLARADA=x\nlixo sem igual\n")
        novas, ignoradas = self.pa.juntar_chaves(self.destino, "ana", "pedidos", ["ERP_TOKEN", "OUTRA"])
        self.assertEqual((novas, ignoradas), (["ERP_TOKEN"], ["NAO_DECLARADA"]))
        texto = self.ler()
        self.assertIn("ERP_TOKEN=novo", texto)
        self.assertNotIn("velho", texto)
        self.assertIn("OUTRA=fica", texto)
        self.assertNotIn("NAO_DECLARADA", texto)
        self.assertFalse(os.path.exists(self.origem), "a origem é apagada")
        self.assertFalse(any("novo" in l for l in self.pa.log_linhas), "valor não vai pro log")

    def test_recusa_arquivo_aberto_pros_outros(self):
        self.escrever("ERP_TOKEN=novo\n", 0o644)
        with self.assertRaisesRegex(self.pa.Recusa, "modo 600"):
            self.pa.juntar_chaves(self.destino, "ana", "pedidos", ["ERP_TOKEN"])
        self.assertIn("velho", self.ler())

    def test_recusa_atalho_e_arquivo_que_falta(self):
        alvo = os.path.join(self.tmp.name, "segredo")
        with open(alvo, "w") as f:
            f.write("ERP_TOKEN=roubado\n")
        os.chmod(alvo, 0o600)
        os.symlink(alvo, self.origem)
        with self.assertRaisesRegex(self.pa.Recusa, "Não achei"):
            self.pa.juntar_chaves(self.destino, "ana", "pedidos", ["ERP_TOKEN"])
        os.remove(self.origem)
        with self.assertRaisesRegex(self.pa.Recusa, "Não achei"):
            self.pa.juntar_chaves(self.destino, "ana", "pedidos", ["ERP_TOKEN"])

    def test_nada_do_manifesto_nao_grava(self):
        self.escrever("QUALQUER=1\n")
        with self.assertRaisesRegex(self.pa.Recusa, "Nenhuma das chaves"):
            self.pa.juntar_chaves(self.destino, "ana", "pedidos", ["ERP_TOKEN"])
        self.assertIn("velho", self.ler())

    def test_usuario_invalido(self):
        with self.assertRaises(self.pa.Recusa):
            self.pa.juntar_chaves(self.destino, "../root", "pedidos", ["ERP_TOKEN"])


if __name__ == "__main__":
    unittest.main()
