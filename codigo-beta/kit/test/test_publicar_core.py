"""Pastas por versão do publicar-core (gateway e agentes), sem root: /opt/ratoeira vira uma pasta temporária.
Rodar: python3 -m unittest discover -s kit/test"""
import importlib.machinery, importlib.util, os, tempfile, unittest

AQUI = os.path.dirname(os.path.abspath(__file__))


def carregar(opt, lib):
    os.environ["RATOEIRA_OPT"], os.environ["RATOEIRA_LIB"] = opt, lib
    caminho = os.path.join(AQUI, "..", "multiusuario", "publicar-core")
    loader = importlib.machinery.SourceFileLoader("publicar_core", caminho)
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("publicar_core", loader))
    loader.exec_module(mod)
    mod.dono_root = lambda pasta: None  # chown pra root não roda sem root
    return mod


def montar(raiz, nome, texto):
    p = os.path.join(raiz, nome)
    os.makedirs(p)
    with open(os.path.join(p, "main.mjs"), "w") as f:
        f.write(texto)
    return p


class Versoes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.opt = os.path.join(self.tmp.name, "opt")
        os.makedirs(self.opt)
        self.pc = carregar(self.opt, os.path.join(self.tmp.name, "lib"))
        self.alvo = os.path.join(self.opt, "gateway")

    def tearDown(self):
        self.tmp.cleanup()

    def ler(self):
        with open(os.path.join(self.alvo, "main.mjs")) as f:
            return f.read()

    def test_adota_a_instalacao_de_antes_e_aponta_pra_nova(self):
        montar(self.opt, "gateway", "v-antes")
        montar(self.opt, "gateway.anterior", "v-mais-antes")
        anterior, destino = self.pc.trocar_pasta(montar(self.tmp.name, "n1", "v1"), self.alvo, "abc1234 assunto | quando | ana")
        self.assertTrue(os.path.islink(self.alvo))
        self.assertEqual(self.ler(), "v1")
        self.assertTrue(destino.endswith("-abc1234"))
        with open(os.path.join(destino, ".versao")) as f:
            self.assertIn("abc1234", f.read())
        with open(os.path.join(anterior, "main.mjs")) as f:
            self.assertEqual(f.read(), "v-antes")
        self.assertFalse(os.path.exists(self.alvo + ".anterior"))
        self.assertEqual(sorted(os.listdir(os.path.join(self.opt, "versoes", "gateway")))[:2],
                         ["00000000T000000Z-anterior", "00000000T000001Z-antes-das-versoes"])

    def test_guarda_tres_alem_da_que_esta_no_ar_e_volta_apontando(self):
        import time
        destinos = []
        for i in range(6):
            _, d = self.pc.trocar_pasta(montar(self.tmp.name, f"n{i}", f"v{i}"), self.alvo, f"c{i:06d}0 x | y | z")
            destinos.append(d)
            time.sleep(1.05)  # o carimbo é por segundo
        self.assertEqual(self.ler(), "v5")
        sobram = sorted(os.listdir(os.path.join(self.opt, "versoes", "gateway")))
        self.assertEqual(len(sobram), 4)
        self.assertEqual([os.path.join(self.opt, "versoes", "gateway", n) for n in sobram], destinos[2:])
        # voltar = apontar pra anterior
        self.pc.apontar(self.alvo, destinos[4])
        self.assertEqual(self.ler(), "v4")
        self.assertTrue(os.path.islink(self.alvo))

    def test_skills_trocam_a_pasta_inteira_e_so_quando_mudam(self):
        origem = os.path.join(self.tmp.name, "kit-skills", "criar-app-ratoeira")
        os.makedirs(origem)
        with open(os.path.join(origem, "SKILL.md"), "w") as f:
            f.write("---\nname: criar-app-ratoeira\n---\n")
        backup = os.path.join(self.tmp.name, "backup")
        self.assertEqual(len(self.pc.instalar_skills(os.path.dirname(origem), backup)), 1)
        self.assertEqual(self.pc.instalar_skills(os.path.dirname(origem), backup), [])
        self.assertTrue(os.path.isfile(os.path.join(self.tmp.name, "lib", "skills", "criar-app-ratoeira", "SKILL.md")))
        self.assertEqual(self.pc.instalar_skills(os.path.join(self.tmp.name, "nao-existe"), backup), [])


if __name__ == "__main__":
    unittest.main()


class Clis(unittest.TestCase):
    """Claude Code e Codex nas versões de agentes/clis.json: só troca o que mudou."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pc = carregar(os.path.join(self.tmp.name, "opt"), os.path.join(self.tmp.name, "lib"))
        self.pc.log = lambda texto: None
        self.instalados = []
        self.pc.instalar_claude = lambda v: self.instalados.append(("claude", v))
        self.pc.instalar_codex = lambda v: self.instalados.append(("codex", v))
        self.arquivo = os.path.join(self.tmp.name, "clis.json")

    def tearDown(self):
        self.tmp.cleanup()

    def pedir(self, texto):
        with open(self.arquivo, "w") as f:
            f.write(texto)

    def test_troca_so_o_que_esta_noutra_versao(self):
        self.pedir('{"claude": "2.1.308", "codex": "0.165.0"}')
        self.pc.versao_cli = lambda b: {"claude": "2.1.308", "codex": "0.156.1"}[os.path.basename(b)]
        self.assertEqual(self.pc.instalar_clis(self.arquivo), ["codex 0.165.0"])
        self.assertEqual(self.instalados, [("codex", "0.165.0")])

    def test_instala_o_que_nao_existe(self):
        self.pedir('{"claude": "2.1.308", "codex": "0.165.0"}')
        self.pc.versao_cli = lambda b: None
        self.assertEqual(len(self.pc.instalar_clis(self.arquivo)), 2)

    def test_versao_invalida_recusa_antes_de_instalar(self):
        self.pedir('{"claude": "latest; rm -rf /"}')
        self.pc.versao_cli = lambda b: "2.1.280"
        with self.assertRaises(self.pc.Recusa):
            self.pc.instalar_clis(self.arquivo)
        self.assertEqual(self.instalados, [])

    def test_sem_arquivo_deixa_como_esta(self):
        self.assertEqual(self.pc.instalar_clis(os.path.join(self.tmp.name, "nao-existe.json")), [])
        self.assertEqual(self.instalados, [])

    def test_o_clis_json_do_repositorio_e_valido(self):
        with open(os.path.join(AQUI, "..", "..", "agentes", "clis.json")) as f:
            import json
            d = json.load(f)
        for nome in ("claude", "codex"):
            self.assertRegex(d[nome], self.pc.VERSAO_CLI)
