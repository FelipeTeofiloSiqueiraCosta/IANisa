"""Atualizador dos alunos (kit/instalador/atualizar), sem root: canal e versão a partir de um repositório git de
mentira no lugar do GitHub, o que muda (CHANGELOG) e o pedido do gateway.
Rodar: python3 -m unittest discover -s kit/test"""
import http.server, importlib.machinery, importlib.util, json, os, stat, subprocess, tempfile, threading, time, types, unittest

AQUI = os.path.dirname(os.path.abspath(__file__))


def sh(*cmd, cwd=None):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "Teste", "GIT_AUTHOR_EMAIL": "teste@exemplo.com",
                        "GIT_COMMITTER_NAME": "Teste", "GIT_COMMITTER_EMAIL": "teste@exemplo.com"})


def carregar(env):
    os.environ.update(env)
    caminho = os.path.join(AQUI, "..", "instalador", "atualizar")
    loader = importlib.machinery.SourceFileLoader("atualizar", caminho)
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("atualizar", loader))
    loader.exec_module(mod)
    return mod


CHANGELOG = """# Ratoeira: o que mudou

## {v} (16/10/2026)

- {texto}

## 0.6.0 (15/10/2026)

- primeira
"""


class Canais(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = self.tmp.name
        self.produto = os.path.join(t, "produto")
        os.makedirs(self.produto)
        sh("git", "init", "-q", "-b", "main", cwd=self.produto)
        # 0.6.0 no beta e no estável; depois 0.6.1 só no beta
        for v, texto in (("0.6.0", "primeira"), ("0.6.1", "correção do chat")):
            with open(os.path.join(self.produto, "VERSION"), "w") as f:
                f.write(v + "\n")
            with open(os.path.join(self.produto, "CHANGELOG.md"), "w") as f:
                f.write(CHANGELOG.format(v=v, texto=texto) if v != "0.6.0" else "# Ratoeira: o que mudou\n\n## 0.6.0 (15/10/2026)\n\n- primeira\n")
            sh("git", "add", "-A", cwd=self.produto)
            sh("git", "commit", "-q", "-m", f"Ratoeira {v}", cwd=self.produto)
            sh("git", "tag", "-a", f"v{v}", "-m", f"Ratoeira {v}", cwd=self.produto)
            if v == "0.6.0":
                sh("git", "branch", "-f", "estavel", "HEAD", cwd=self.produto)
        sh("git", "branch", "-f", "beta", "HEAD", cwd=self.produto)
        self.fonte = os.path.join(t, "fonte")
        sh("git", "clone", "-q", "--branch", "estavel", self.produto, self.fonte)
        self.cfg = os.path.join(t, "fonte.json")
        self.trabalho = os.path.join(t, "core")
        self.a = carregar({"RATOEIRA_FONTE": self.fonte, "RATOEIRA_FONTE_CONFIG": self.cfg,
                           "RATOEIRA_CORE_TRABALHO": self.trabalho, "RATOEIRA_GIT_HOME": t,
                           "RATOEIRA_FONTE_CHAVE": os.path.join(t, "sem-chave"),
                           "RATOEIRA_FONTE_TOKEN_ARQUIVO": os.path.join(t, "sem-token"),
                           "RATOEIRA_PLATAFORMA_CHAVE": os.path.join(t, "plataforma.chave"),
                           "RATOEIRA_INSTALACAO_ID": os.path.join(t, "instalacao.id"),
                           "RATOEIRA_CONFIG": os.path.join(t, "gateway.config.json"),
                           "RATOEIRA_PLATAFORMA": "http://127.0.0.1:9",
                           "RATOEIRA_PEDIDOS_ATUALIZAR": os.path.join(t, "pedidos")})

    def tearDown(self):
        self.tmp.cleanup()

    def canal(self, nome):
        with open(self.cfg, "w") as f:
            json.dump({"remoto": self.produto, "canal": nome}, f)

    def test_cada_canal_aponta_pra_sua_versao(self):
        self.canal("beta")
        self.a.buscar()
        self.assertEqual(self.a.versao_do_canal("beta"), "0.6.1")
        self.assertEqual(self.a.versao_do_canal("estavel"), "0.6.0")
        self.assertEqual(self.a.versao_no_clone(), "0.6.0")

    def test_verificar_diz_que_tem_nova_e_o_que_muda(self):
        self.canal("beta")
        self.a.gravar_estado(noAr={"versao": "0.6.0"})
        e = self.a.verificar()
        self.assertTrue(e["disponivel"]["nova"])
        self.assertEqual(e["disponivel"]["versao"], "0.6.1")
        self.assertEqual([m["versao"] for m in e["disponivel"]["mudancas"]], ["0.6.1"])
        self.assertIn("correção do chat", e["disponivel"]["mudancas"][0]["texto"])

    def test_no_estavel_nao_tem_nova(self):
        self.canal("estavel")
        self.a.gravar_estado(noAr={"versao": "0.6.0"})
        self.assertFalse(self.a.verificar()["disponivel"]["nova"])

    def test_canal_desconhecido_recusa(self):
        self.canal("qualquer")
        with self.assertRaises(self.a.Recusa):
            self.a.buscar()

    def test_versoes_comparam_como_numero(self):
        self.assertGreater(self.a.num("0.10.0"), self.a.num("0.9.9"))
        self.assertIsNone(self.a.num("0.6"))
        self.assertEqual(self.a.tag("0.6.1"), "v0.6.1")
        self.assertEqual(self.a.tag("v0.6.1"), "v0.6.1")

    def pedido(self, dados):
        pasta = os.path.join(self.tmp.name, "pedidos")
        os.makedirs(pasta, exist_ok=True)
        with open(os.path.join(pasta, "pedido.json"), "w") as f:
            json.dump(dados, f)
        return pasta

    def resultado(self, pasta):
        with open(os.path.join(pasta, "resultado.json")) as f:
            return json.load(f)

    def test_pedido_do_gateway_com_acao_estranha_recusa(self):
        pasta = self.pedido({"acao": "rm -rf /", "por": "x"})
        self.assertFalse(self.a.atender_pedido())
        r = self.resultado(pasta)
        self.assertFalse(r["ok"])
        self.assertIn("Ação desconhecida", r["erro"])
        self.assertFalse(os.path.exists(os.path.join(pasta, "pedido.json")))

    def test_pedido_com_versao_invalida_recusa(self):
        pasta = self.pedido({"acao": "aplicar", "versao": "main; rm", "por": "x"})
        self.assertFalse(self.a.atender_pedido())
        self.assertIn("Versão inválida", self.resultado(pasta)["erro"])
        self.assertFalse(os.path.exists(os.path.join(pasta, "pedido.json")))

    def test_pedido_symlink_nao_e_seguido(self):
        pasta = os.path.join(self.tmp.name, "pedidos")
        os.makedirs(pasta)
        alvo = os.path.join(self.tmp.name, "de-outro.json")
        with open(alvo, "w") as f:
            json.dump({"acao": "verificar"}, f)
        os.symlink(alvo, os.path.join(pasta, "pedido.json"))
        self.assertFalse(self.a.atender_pedido())
        self.assertFalse(self.resultado(pasta)["ok"])
        self.assertFalse(os.path.lexists(os.path.join(pasta, "pedido.json")))
        self.assertTrue(os.path.exists(alvo))  # o apagado foi o link, não o alvo

    def test_resultado_symlink_nao_e_seguido(self):
        pasta = self.pedido({"acao": "nada"})
        vitima = os.path.join(self.tmp.name, "vitima")
        with open(vitima, "w") as f:
            f.write("intacto")
        os.symlink(vitima, os.path.join(pasta, "resultado.json"))
        os.symlink(vitima, os.path.join(pasta, "resultado.json.tmp"))
        self.a.atender_pedido()
        with open(vitima) as f:
            self.assertEqual(f.read(), "intacto")
        self.assertFalse(os.path.islink(os.path.join(pasta, "resultado.json")))
        self.assertFalse(self.resultado(pasta)["ok"])

    def test_pasta_de_pedidos_symlink_recusa(self):
        real = os.path.join(self.tmp.name, "real")
        os.makedirs(real)
        os.symlink(real, os.path.join(self.tmp.name, "pedidos"))
        with self.assertRaises(self.a.Recusa):
            self.a.atender_pedido()
        self.assertEqual(os.listdir(real), [])

    def test_pedido_que_quebra_tambem_grava_resultado(self):
        pasta = self.pedido({"acao": "verificar", "por": "x"})
        def quebra():
            raise RuntimeError("bum")
        self.a.verificar = quebra
        self.assertFalse(self.a.atender_pedido())
        self.assertIn("RuntimeError: bum", self.resultado(pasta)["erro"])
        self.assertFalse(os.path.exists(os.path.join(pasta, "pedido.json")))

    def test_gateway_nao_desce_versao_pelo_aplicar(self):
        self.canal("beta")
        self.a.gravar_estado(noAr={"versao": "0.6.1"})
        with self.assertRaisesRegex(self.a.Recusa, "mais velha"):
            self.a.aplicar("0.6.0", por="x", do_gateway=True)

    def test_versao_fora_do_canal_recusa(self):
        # 0.6.1 existe mas só no beta: quem está no estável não pode pedir ela
        self.canal("estavel")
        self.a.gravar_estado(noAr={"versao": "0.6.0"})
        with self.assertRaisesRegex(self.a.Recusa, "não faz parte do canal"):
            self.a.aplicar("0.6.1", por="x", do_gateway=True)


class PlataformaFalsa(http.server.BaseHTTPRequestHandler):
    """Responde como a plataforma (sites/plataforma/src/app/api/ratoeira): cada teste põe as respostas na fila."""
    respostas, pedidos = {}, []

    def do_POST(self):
        corpo = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        self.pedidos.append((self.path, self.headers.get("Authorization"), corpo))
        fila = self.respostas.get(self.path) or [(404, {})]
        status, dados = fila.pop(0) if len(fila) > 1 else fila[0]
        bruto = json.dumps(dados).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(bruto)))
        self.end_headers()
        self.wfile.write(bruto)

    def log_message(self, *a):
        pass


class Plataforma(Canais):
    def setUp(self):
        super().setUp()
        PlataformaFalsa.respostas, PlataformaFalsa.pedidos = {}, []
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), PlataformaFalsa)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.a.PLATAFORMA = f"http://127.0.0.1:{self.srv.server_address[1]}"
        self.a.time = types.SimpleNamespace(sleep=lambda s: None, time=time.time)
        self.canal("beta")

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        super().tearDown()

    def conectada(self):
        with open(self.a.CHAVE_PLATAFORMA, "w") as f:
            f.write("rat_" + "x" * 43 + "\n")

    def test_sem_conectar_segue_pela_credencial_antiga_e_avisa(self):
        self.a.buscar()
        self.assertEqual(self.a.estado()["conexao"]["estado"], "desconectada")
        self.assertEqual(PlataformaFalsa.pedidos, [])

    def test_conectada_com_comunidade_busca_com_o_token(self):
        self.conectada()
        PlataformaFalsa.respostas["/api/ratoeira/atualizacao"] = [(200, {"ok": True, "token": "ghs_abc", "email": "a@b.c"})]
        self.a.gravar_estado(noAr={"versao": "0.6.0"})
        e = self.a.verificar()
        self.assertTrue(e["disponivel"]["nova"])
        self.assertEqual(self.a.TOKEN_PLATAFORMA, "ghs_abc")
        self.assertIn("GIT_CONFIG_VALUE_0", self.a.ambiente_git())
        caminho, auth, corpo = PlataformaFalsa.pedidos[0]
        self.assertEqual(auth, "Bearer rat_" + "x" * 43)
        self.assertEqual(corpo["versao"], "0.6.0")
        e = self.a.estado()
        self.assertEqual((e["conexao"]["estado"], e["conexao"]["email"], e["licenca"]["ok"]), ("conectada", "a@b.c", True))

    def test_sem_comunidade_nao_busca_e_diz_por_que(self):
        self.conectada()
        PlataformaFalsa.respostas["/api/ratoeira/atualizacao"] = [(403, {"ok": False, "motivo": "sem-comunidade",
                                                                         "mensagem": "Sem Comunidade ativa.", "email": "a@b.c"})]
        antes = subprocess.run(["git", "-C", self.fonte, "rev-parse", "-q", "--verify", "refs/remotes/origin/beta"],
                               capture_output=True, text=True).stdout
        with self.assertRaisesRegex(self.a.Recusa, "Sem Comunidade ativa"):
            self.a.verificar()
        lic = self.a.estado()["licenca"]
        self.assertEqual((lic["ok"], lic["motivo"]), (False, "sem-comunidade"))
        self.assertIsNone(self.a.TOKEN_PLATAFORMA)
        depois = subprocess.run(["git", "-C", self.fonte, "rev-parse", "-q", "--verify", "refs/remotes/origin/beta"],
                                capture_output=True, text=True).stdout
        self.assertEqual(antes, depois)  # nem chegou a buscar
        with self.assertRaises(self.a.Recusa):
            self.a.aplicar(por="x")

    def test_plataforma_fora_do_ar_recusa_sem_marcar_bloqueio(self):
        self.conectada()
        PlataformaFalsa.respostas["/api/ratoeira/atualizacao"] = [(503, {"ok": False, "motivo": "erro", "mensagem": "Fora."})]
        with self.assertRaisesRegex(self.a.Recusa, "Fora"):
            self.a.buscar()
        self.assertNotIn("licenca", self.a.estado())

    def test_conectar_espera_o_codigo_e_guarda_a_chave_so_do_root(self):
        PlataformaFalsa.respostas["/api/ratoeira/dispositivo"] = [(200, {
            "segredo": "rcx_s", "codigo": "ABCD-EFGH", "url": "https://p/ratoeira/conectar?codigo=ABCD-EFGH",
            "url_curta": "https://p/ratoeira/conectar", "expira_em": "x", "intervalo": 5})]
        PlataformaFalsa.respostas["/api/ratoeira/dispositivo/chave"] = [
            (200, {"estado": "esperando"}), (200, {"estado": "conectada", "chave": "rat_nova", "email": "a@b.c"})]
        self.a.conectar()
        with open(self.a.CHAVE_PLATAFORMA) as f:
            self.assertEqual(f.read().strip(), "rat_nova")
        self.assertEqual(stat.S_IMODE(os.stat(self.a.CHAVE_PLATAFORMA).st_mode), 0o600)
        self.assertEqual(self.a.estado()["conexao"]["estado"], "conectada")
        inst = PlataformaFalsa.pedidos[0][2]["instalacao"]
        self.a.conectar()  # de novo: o mesmo id de instalação
        self.assertEqual(PlataformaFalsa.pedidos[-2][2]["instalacao"], inst)

    def test_codigo_que_vence_recusa(self):
        PlataformaFalsa.respostas["/api/ratoeira/dispositivo"] = [(200, {
            "segredo": "rcx_s", "codigo": "ABCD-EFGH", "url": "u", "url_curta": "u", "expira_em": "x"})]
        PlataformaFalsa.respostas["/api/ratoeira/dispositivo/chave"] = [(410, {"estado": "expirado"})]
        with self.assertRaisesRegex(self.a.Recusa, "venceu"):
            self.a.conectar()
        self.assertFalse(os.path.exists(self.a.CHAVE_PLATAFORMA))

    def test_remoto_ssh_vira_https_pro_token(self):
        self.assertEqual(self.a.https_do("git@github.com:acme/produto.git"), "https://github.com/acme/produto.git")
        self.assertEqual(self.a.https_do("/caminho/local"), "/caminho/local")


if __name__ == "__main__":
    unittest.main()
