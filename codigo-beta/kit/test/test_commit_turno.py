"""Gancho commit-turno: no fim da resposta commita o que mudou durante ela, inclusive por comando."""
import json, os, subprocess, tempfile, unittest

GANCHO = os.path.join(os.path.dirname(__file__), "..", "multiusuario", "commit-turno")


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout


class CommitTurno(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = os.path.realpath(self.tmp.name)
        self.areas = os.path.join(base, "areas") + "/"
        self.repo = os.path.join(self.areas, "trabalho")
        self.home = os.path.join(base, "home")
        os.makedirs(self.repo); os.makedirs(self.home)
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.name", "Ana"); git(self.repo, "config", "user.email", "ana@x.com")
        for rel, txt in {"antes.md": "a", "mover/c.md": "c", "apagar.md": "e", "sujo.md": "s"}.items():
            os.makedirs(os.path.dirname(os.path.join(self.repo, rel)) or self.repo, exist_ok=True)
            with open(os.path.join(self.repo, rel), "w") as f: f.write(txt)
        git(self.repo, "add", "-A"); git(self.repo, "commit", "-qm", "início")
        self.env = {**os.environ, "HOME": self.home, "RATOEIRA_TESTE_AREAS": self.areas}

    def tearDown(self): self.tmp.cleanup()

    def gancho(self, evento, **extra):
        ev = {"hook_event_name": evento, "session_id": "s1", "cwd": self.repo, **extra}
        r = subprocess.run([GANCHO], input=json.dumps(ev), text=True, capture_output=True, env=self.env)
        self.assertEqual(r.returncode, 0, r.stderr)

    def escrever(self, rel, txt):
        os.makedirs(os.path.dirname(os.path.join(self.repo, rel)) or self.repo, exist_ok=True)
        with open(os.path.join(self.repo, rel), "w") as f: f.write(txt)

    def test_commita_o_que_mudou_por_comando_e_deixa_o_que_ja_estava_sujo(self):
        self.escrever("sujo.md", "mexido antes do pedido")
        self.gancho("UserPromptSubmit", prompt="Organiza as pastas do projeto\nmais detalhe")
        self.escrever("novo/nasceu.md", "criado por comando")
        os.makedirs(os.path.join(self.repo, "na-lata"))
        os.rename(os.path.join(self.repo, "mover"), os.path.join(self.repo, "na-lata", "mover"))
        os.unlink(os.path.join(self.repo, "apagar.md"))
        self.gancho("Stop")
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s").strip(), "Organiza as pastas do projeto")
        no_git = set(git(self.repo, "ls-files").split())
        self.assertIn("novo/nasceu.md", no_git)
        self.assertIn("na-lata/mover/c.md", no_git)
        self.assertNotIn("mover/c.md", no_git)
        self.assertNotIn("apagar.md", no_git)
        # o que já estava modificado antes do pedido continua só modificado, sem commit no nome de ninguém
        self.assertEqual(git(self.repo, "status", "--porcelain").strip(), "M sujo.md")
        self.assertFalse(os.listdir(os.path.join(self.home, ".local", "state", "ratoeira", "turno")), "o estado do turno some no fim")

    def test_ja_sujo_que_mudou_de_novo_entra(self):
        self.escrever("sujo.md", "antes")
        self.gancho("UserPromptSubmit", prompt="ajusta")
        os.utime(os.path.join(self.repo, "sujo.md"), ns=(1, 1))   # mudou durante a resposta
        self.escrever("sujo.md", "depois, com outro tamanho")
        self.gancho("Stop")
        self.assertEqual(git(self.repo, "status", "--porcelain").strip(), "")

    def test_arquivo_grande_fica_de_fora(self):
        self.gancho("UserPromptSubmit", prompt="baixa o vídeo")
        with open(os.path.join(self.repo, "grande.bin"), "wb") as f: f.truncate(51 * 1024 * 1024)
        self.escrever("leve.md", "x")
        self.gancho("Stop")
        no_git = set(git(self.repo, "ls-files").split())
        self.assertIn("leve.md", no_git)
        self.assertNotIn("grande.bin", no_git)

    def test_sem_comeco_segue_o_de_antes_so_com_as_edicoes(self):
        self.escrever("antes.md", "editado pelo Write")
        self.escrever("solto.md", "por comando, sem o começo anotado")
        tr = os.path.join(self.home, "t.jsonl")
        with open(tr, "w") as f:
            f.write(json.dumps({"type": "user", "message": {"content": "edita o antes"}}) + "\n")
            f.write(json.dumps({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Write", "input": {"file_path": os.path.join(self.repo, "antes.md")}}]}}) + "\n")
        self.gancho("Stop", transcript_path=tr)
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s").strip(), "edita o antes")
        self.assertEqual(git(self.repo, "status", "--porcelain").strip(), "?? solto.md")

    def test_codex_pedido_e_patch_do_historico_dele(self):
        """Codex (desde 28/10/2026): mesmo gancho, pelo managed_config.toml. A conversa abre numa subpasta; o patch mexe
        num arquivo fora dela (vem do histórico do Codex) e um comando cria outro dentro dela (vem do status)."""
        sub = os.path.join(self.repo, "sub"); os.makedirs(sub)
        cx = {"turn_id": "t1", "session_id": "01a1-codex", "cwd": sub}
        def gancho(evento, **extra):
            r = subprocess.run([GANCHO], input=json.dumps({"hook_event_name": evento, **cx, **extra}), text=True, capture_output=True, env=self.env)
            self.assertEqual((r.returncode, r.stdout.strip()), (0, "{}"))   # o Codex quer JSON na saída
        gancho("UserPromptSubmit", prompt="Arruma o antes e cria a nota")
        self.escrever("antes.md", "mexido pelo patch")
        self.escrever("sub/nota.md", "criada por comando")
        self.escrever("solto.md", "fora da pasta da conversa e sem patch")
        tr = os.path.join(self.home, "rollout.jsonl")
        patch = 'text(await tools.apply_patch("*** Begin Patch\\n*** Update File: ../antes.md\\n@@\\n-a\\n+b\\n*** End Patch"));'
        with open(tr, "w") as f:
            for d in [{"type": "session_meta", "payload": {"id": "01a1-codex", "cwd": sub}},
                      {"type": "event_msg", "payload": {"type": "user_message", "message": "Arruma o antes e cria a nota"}},
                      {"type": "response_item", "payload": {"type": "custom_tool_call", "name": "exec", "input": patch}}]:
                f.write(json.dumps(d) + "\n")
        gancho("Stop", transcript_path=tr, last_assistant_message="feito", stop_hook_active=False)
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s").strip(), "Arruma o antes e cria a nota")
        self.assertIn("sub/nota.md", git(self.repo, "ls-files").split())
        self.assertEqual(git(self.repo, "status", "--porcelain").strip(), "?? solto.md")

    def test_fora_das_areas_nao_faz_nada(self):
        fora = os.path.join(self.home, "fora"); os.makedirs(fora); git(fora, "init", "-q")
        ev = {"hook_event_name": "UserPromptSubmit", "session_id": "s2", "cwd": fora, "prompt": "x"}
        subprocess.run([GANCHO], input=json.dumps(ev), text=True, env=self.env, check=True)
        self.assertFalse(os.path.exists(os.path.join(self.home, ".local", "state", "ratoeira", "turno", "s2.json")))


if __name__ == "__main__": unittest.main()
