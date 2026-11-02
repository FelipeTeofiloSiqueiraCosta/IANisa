#!/usr/bin/env bash
# Atalho: o instalador de verdade mora em kit/instalador/instalar.sh (README.md, "Instalar").
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/kit/instalador/instalar.sh" "$@"
