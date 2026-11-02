#!/bin/sh
# CLI do Claude de mentira pros testes das Conexões. Como o de verdade, lê e grava o login no
# CLAUDE_CONFIG_DIR, quando tem (conta pessoal com login completo).
C="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
case "$1 $2" in
  "auth status")
    if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then echo '{"loggedIn":true,"authMethod":"oauth_token"}';
    elif grep -qs claudeAiOauth "$C/.credentials.json"; then echo '{"loggedIn":true,"email":"pessoa@exemplo.com","subscriptionType":"max"}';
    else echo '{"loggedIn":false}'; fi ;;
  "auth login")
    [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] && { echo "token da geral vazou pro login"; exit 3; }
    echo "Abra https://claude.ai/oauth/authorize?code=true&client_id=x"
    printf 'Paste code here: '
    read codigo
    [ "$codigo" = recusar ] && { echo "OAuth error"; exit 1; }
    mkdir -p "$C" && echo '{"claudeAiOauth":{}}' > "$C/.credentials.json"
    echo "Login ok ($codigo)" ;;
  *) exit 2 ;;
esac
