#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "openai>=1.50.0",
#     "pillow>=10.0.0",
# ]
# ///
"""
Generate images using OpenAI's gpt-image-1 model.

Usage:
    uv run generate_image_gpt.py --prompt "..." --filename "out.png" [--size 1024x1024|1536x1024|1024x1536|2048x2048]
                                  [--quality low|medium|high] [--input-image path.png]
                                  [--mask mask.png] [--api-key KEY]
"""

import argparse
import base64
import os
import sys
from pathlib import Path


def load_dotenv_if_present():
    """Look for a .env file in cwd or any parent up to 5 levels; load KEY=VALUE pairs
    into os.environ if not already set. Env vars from the real environment take precedence."""
    cwd = Path.cwd().resolve()
    for parent in [cwd] + list(cwd.parents)[:5]:
        env_path = parent / ".env"
        if env_path.is_file():
            try:
                for raw in env_path.read_text().splitlines():
                    line = raw.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and v and k not in os.environ:
                        os.environ[k] = v
            except Exception:
                pass
            return env_path
    return None


def get_api_key(provided_key: str | None) -> str | None:
    if provided_key:
        return provided_key
    load_dotenv_if_present()
    return os.environ.get("OPENAI_API_KEY")


SIZE_ALIASES = {
    "1k": "1024x1024",
    "2k": "2048x2048",
    "square": "1024x1024",
    "portrait": "1024x1536",
    "landscape": "1536x1024",
    "tall": "1024x1536",
    "wide": "1536x1024",
}


def main():
    parser = argparse.ArgumentParser(description="Generate images via OpenAI gpt-image-1")
    parser.add_argument("--prompt", "-p", required=True, help="Image description/prompt")
    parser.add_argument("--filename", "-f", required=True, help="Output filename")
    parser.add_argument(
        "--input-image", "-i", action="append",
        help="Optional input image(s) for editing. Pass multiple times for multi-reference."
    )
    parser.add_argument("--mask", "-m", help="Optional mask PNG (alpha=transparent regenerates)")
    parser.add_argument(
        "--size", "-s", default="1024x1536",
        help="Output size. Pixels (1024x1536) or alias (1k/2k/portrait/landscape/tall/wide). Default: 1024x1536 (4:5 vertical)."
    )
    parser.add_argument(
        "--quality", "-q", choices=["low", "medium", "high"], default="high",
        help="Quality tier. Default: high."
    )
    parser.add_argument("--api-key", "-k", help="OpenAI API key (overrides OPENAI_API_KEY)")

    args = parser.parse_args()

    api_key = get_api_key(args.api_key)
    if not api_key:
        print("Error: OPENAI_API_KEY not found.", file=sys.stderr)
        print("Configure de uma das 3 formas (do mais rápido pro mais durável):", file=sys.stderr)
        print("  1. .env local: copie .env.example para .env na raiz do projeto e preencha", file=sys.stderr)
        print("  2. settings.json global: ~/.claude/settings.json -> {\"env\":{\"OPENAI_API_KEY\":\"...\"}}", file=sys.stderr)
        print("  3. Shell env: export OPENAI_API_KEY=...", file=sys.stderr)
        print("Chave em: https://platform.openai.com/api-keys", file=sys.stderr)
        sys.exit(1)

    size = SIZE_ALIASES.get(args.size.lower(), args.size)

    from openai import OpenAI
    client = OpenAI(api_key=api_key)

    output_path = Path(args.filename)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        if args.input_image:
            images = [open(p, "rb") for p in args.input_image]
            kwargs = dict(
                model="gpt-image-1",
                image=images if len(images) > 1 else images[0],
                prompt=args.prompt,
                size=size,
                quality=args.quality,
            )
            if args.mask:
                kwargs["mask"] = open(args.mask, "rb")
            print(f"Editing image(s) [{len(images)} ref] size={size} quality={args.quality}...")
            response = client.images.edit(**kwargs)
            for f in images:
                f.close()
            if args.mask:
                kwargs["mask"].close()
        else:
            print(f"Generating image size={size} quality={args.quality}...")
            response = client.images.generate(
                model="gpt-image-1",
                prompt=args.prompt,
                size=size,
                quality=args.quality,
            )

        b64 = response.data[0].b64_json
        if not b64:
            print("Error: No image data in response.", file=sys.stderr)
            sys.exit(1)

        image_bytes = base64.b64decode(b64)
        output_path.write_bytes(image_bytes)
        print(f"\nImage saved: {output_path.resolve()}")

    except Exception as e:
        print(f"Error generating image: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
