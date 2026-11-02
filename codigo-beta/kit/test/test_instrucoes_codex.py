"""ratoeira-instrucoes, Codex: o managed_config.toml leva o texto dos agentes e, desde 28/10/2026, os ganchos do
commit-turno (gancho da camada gerenciada roda sem a pessoa aprovar). O TOML tem que abrir no leitor de verdade."""
import importlib.machinery, importlib.util, os, tempfile, tomllib, unittest

ARQ = os.path.join(os.path.dirname(__file__), "..", "ratoeira-instrucoes")
_l = importlib.machinery.SourceFileLoader("ratoeira_instrucoes", ARQ)
ri = importlib.util.module_from_spec(importlib.util.spec_from_loader("ratoeira_instrucoes", _l)); _l.exec_module(ri)


class InstrucoesCodex(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        ri.CODEX = os.path.join(self.tmp.name, "codex", "managed_config.toml")
        ri.COMMIT_TURNO = os.path.join(self.tmp.name, "commit-turno")

    def tearDown(self): self.tmp.cleanup()

    def test_texto_e_ganchos(self):
        open(ri.COMMIT_TURNO, "w").close()
        self.assertTrue(ri.codex("# Ratoeira\nTexto com \"aspas\" e acentuação."))
        cfg = tomllib.load(open(ri.CODEX, "rb"))
        self.assertIn("acentuação", cfg["developer_instructions"])
        for ev in ("UserPromptSubmit", "Stop"):
            self.assertEqual(cfg["hooks"][ev], [{"hooks": [{"type": "command", "command": ri.COMMIT_TURNO, "timeout": 30}]}])
        self.assertFalse(ri.codex("# Ratoeira\nTexto com \"aspas\" e acentuação."), "igual: não grava de novo")

    def test_sem_o_gancho_instalado_fica_so_o_texto(self):
        ri.codex("oi")
        self.assertNotIn("hooks", tomllib.load(open(ri.CODEX, "rb")))


if __name__ == "__main__":
    unittest.main()
