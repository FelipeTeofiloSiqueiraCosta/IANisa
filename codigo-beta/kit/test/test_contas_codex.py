"""aplicar-acessos, contas do Codex da organização (desde 28/10/2026): pasta por conta, login gravado só quando é novo,
leitura e escrita por ACL só pra quem pode usar, e a conta que saiu do pedido sai do disco."""
import importlib.machinery, importlib.util, json, os, pwd, subprocess, tempfile, unittest

ARQ = os.path.join(os.path.dirname(__file__), "..", "multiusuario", "aplicar-acessos")
_l = importlib.machinery.SourceFileLoader("aplicar_acessos", ARQ)
aa = importlib.util.module_from_spec(importlib.util.spec_from_loader("aplicar_acessos", _l)); _l.exec_module(aa)
EU = pwd.getpwuid(os.getuid()).pw_name


def login(n):
    return {"auth_mode": "chatgpt", "tokens": {"refresh_token": "r" + n, "access_token": "a" + n}}


def acl(f):
    return subprocess.run(["getfacl", "-cp", f], capture_output=True, text=True, check=True).stdout


class ContasCodex(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = os.path.join(self.tmp.name, "codex-contas")
        self.geral = os.path.join(self.tmp.name, "codex-geral", "auth.json")

    def tearDown(self): self.tmp.cleanup()

    def aplicar(self, contas, modo="opcional"):
        return aa.contas_codex(contas, {EU: modo}, base=self.base, geral=self.geral, root=False)

    def test_instala_da_acesso_e_nao_regrava_o_renovado(self):
        religar = self.aplicar([{"id": "o1", "nome": "Time\t1", "auth": login("1")}, {"id": "Inválido"}, {"id": "o2", "nome": "Sem login"}])
        self.assertEqual(religar, {EU})
        arq = os.path.join(self.base, "o1", "auth.json")
        self.assertEqual(json.load(open(arq))["tokens"]["refresh_token"], "r1")
        self.assertIn(f"user:{EU}:rw-", acl(arq))
        self.assertIn(f"user:{EU}:r-x", acl(os.path.dirname(arq)))
        self.assertEqual(open(os.path.join(self.base, "contas.tsv")).read(), "o1\tTime 1\n")   # o2 sem login fica fora
        # o Codex renovou o token no arquivo; o gateway ainda manda a cópia velha: não regrava, ninguém religa
        with open(arq, "w") as f: json.dump(login("renovado"), f)
        self.assertEqual(self.aplicar([{"id": "o1", "nome": "Time 1", "auth": login("1")}]), set())
        self.assertEqual(json.load(open(arq))["tokens"]["refresh_token"], "rrenovado")
        # login novo (reconectou): grava
        self.aplicar([{"id": "o1", "nome": "Time 1", "auth": login("2")}])
        self.assertEqual(json.load(open(arq))["tokens"]["refresh_token"], "r2")

    def test_quem_pode_usar(self):
        self.aplicar([{"id": "o1", "nome": "Só outra", "users": ["outra"], "auth": login("1")}])
        self.assertNotIn(f"user:{EU}:", acl(os.path.join(self.base, "o1", "auth.json")))
        self.aplicar([{"id": "o1", "nome": "Todos"}], modo="propria")   # modo própria nunca usa conta da organização
        self.assertNotIn(f"user:{EU}:", acl(os.path.join(self.base, "o1", "auth.json")))

    def test_geral_de_antes_e_conta_que_sai(self):
        os.makedirs(os.path.dirname(self.geral)); json.dump(login("g"), open(self.geral, "w"))
        self.aplicar([{"id": "geral", "nome": "Conta da organização"}, {"id": "o1", "nome": "Time", "auth": login("1")}])
        self.assertEqual(json.load(open(self.geral))["tokens"]["refresh_token"], "rg")   # fica onde estava
        self.assertIn(f"user:{EU}:rw-", acl(self.geral))
        self.assertEqual(open(os.path.join(self.base, "contas.tsv")).read(), "geral\tConta da organização\no1\tTime\n")
        self.aplicar([{"id": "o1", "nome": "Time"}])
        self.assertFalse(os.path.exists(self.geral))
        self.aplicar([])
        self.assertFalse(os.path.exists(os.path.join(self.base, "o1")))
        self.assertEqual(open(os.path.join(self.base, "contas.tsv")).read(), "")


if __name__ == "__main__":
    unittest.main()
