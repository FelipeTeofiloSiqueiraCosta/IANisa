#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "requests>=2.28.0",
# ]
# ///
"""
Image Finder - Busca imagens via DuckDuckGo (sem API key!)
Uso: uv run scripts/image-finder.py --keyword "anthropic team" --count 1
"""

import argparse
import re
import time
from pathlib import Path
from urllib.parse import quote

import requests


def search_ddg_images(keyword, count=1, output_dir="."):
    """
    Busca imagens no DuckDuckGo (não precisa API key).

    Args:
        keyword: Termo de busca
        count: Número de imagens
        output_dir: Diretório de saída

    Returns:
        Lista de paths das imagens baixadas
    """

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    print(f"Buscando no DuckDuckGo: {keyword}")

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }

    try:
        # Request para pegar o token VQD
        response = requests.get(
            "https://duckduckgo.com/", params={"q": keyword}, headers=headers
        )

        vqd_match = None
        for line in response.text.split("\n"):
            if "vqd=" in line:
                match = re.search(r"vqd=(['\"])([^'\"]+)\1", line)
                if match:
                    vqd_match = match.group(2)
                    break

        if not vqd_match:
            print("Erro: nao conseguiu extrair token VQD do DuckDuckGo")
            return []

        # Buscar imagens
        params = {
            "q": keyword,
            "o": "json",
            "p": "1",
            "iax": "images",
            "ia": "images",
            "vqd": vqd_match,
        }

        response = requests.get(
            "https://duckduckgo.com/i.js", params=params, headers=headers, timeout=10
        )
        response.raise_for_status()

        data = response.json()
        results = data.get("results", [])

        if not results:
            print("Nenhuma imagem encontrada")
            return []

        print(f"Encontradas {len(results)} imagens")

        # Baixar as primeiras N imagens
        downloaded = []
        for i, result in enumerate(results[:count], 1):
            try:
                img_url = result.get("image")
                if not img_url:
                    continue

                print(f"Baixando imagem {i}/{count}...")

                img_response = requests.get(img_url, headers=headers, timeout=15)
                img_response.raise_for_status()

                # Determinar extensão
                content_type = img_response.headers.get("Content-Type", "")
                if "jpeg" in content_type or "jpg" in content_type:
                    ext = "jpg"
                elif "png" in content_type:
                    ext = "png"
                elif "webp" in content_type:
                    ext = "webp"
                else:
                    ext = "jpg"

                # Nome do arquivo
                timestamp = int(time.time())
                safe_keyword = keyword.replace(" ", "-").replace("/", "-")[:30]
                filename = f"img-{safe_keyword}-{timestamp}-{i}.{ext}"
                filepath = out / filename

                filepath.write_bytes(img_response.content)

                file_size = len(img_response.content) / 1024
                print(f"Salvo: {filepath} ({file_size:.1f} KB)")
                downloaded.append(str(filepath.resolve()))

                if i < count:
                    time.sleep(0.5)

            except Exception as e:
                print(f"Erro ao baixar imagem {i}: {e}")
                continue

        return downloaded

    except Exception as e:
        print(f"Erro na busca: {e}")
        return []


def main():
    parser = argparse.ArgumentParser(
        description="Busca automatica de imagens via DuckDuckGo (sem API key)"
    )
    parser.add_argument("--keyword", "-k", required=True, help="Termo de busca")
    parser.add_argument(
        "--count", "-c", type=int, default=1, help="Numero de imagens (padrao: 1)"
    )
    parser.add_argument(
        "--output-dir",
        "-o",
        default=".",
        help="Diretorio de saida (padrao: diretorio atual)",
    )

    args = parser.parse_args()

    images = search_ddg_images(
        keyword=args.keyword, count=args.count, output_dir=args.output_dir
    )

    if images:
        print(f"\n{len(images)} imagem(ns) baixada(s):")
        for img in images:
            print(f"  {img}")
    else:
        print("\nNenhuma imagem encontrada.")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
