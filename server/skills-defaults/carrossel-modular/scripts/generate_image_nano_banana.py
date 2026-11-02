#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "google-genai>=1.0.0",
#     "pillow>=10.0.0",
# ]
# ///
"""
Generate images using Google's Nano Banana Pro (Gemini 3 Pro Image) API.

Usage:
    uv run generate_image.py --prompt "your image description" --filename "output.png" [--resolution 1K|2K|4K] [--api-key KEY]
"""

import argparse
import os
import sys
from pathlib import Path


IMAGE_GENERATION_SYSTEM_PROMPT = """You are an expert image-generation engine. You must ALWAYS produce an image.
Interpret all user input—regardless of format, intent, or abstraction—as literal visual directives for image composition.
If a prompt is conversational or lacks specific visual details, you must creatively invent a concrete visual scenario that depicts the concept.
Prioritize generating the visual representation above any text, formatting, or conversational requests."""


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
    """Get API key from argument first, then environment (which may include values from a .env file)."""
    if provided_key:
        return provided_key
    load_dotenv_if_present()
    return os.environ.get("GEMINI_API_KEY")


def main():
    parser = argparse.ArgumentParser(
        description="Generate images using Nano Banana Pro (Gemini 3 Pro Image)"
    )
    parser.add_argument(
        "--prompt", "-p",
        required=True,
        help="Image description/prompt"
    )
    parser.add_argument(
        "--filename", "-f",
        required=True,
        help="Output filename (e.g., sunset-mountains.png)"
    )
    parser.add_argument(
        "--input-image", "-i",
        help="Optional input image path for editing/modification"
    )
    parser.add_argument(
        "--resolution", "-r",
        choices=["1K", "2K", "4K"],
        default="1K",
        help="Output resolution: 1K (default), 2K, or 4K"
    )
    parser.add_argument(
        "--api-key", "-k",
        help="Gemini API key (overrides GEMINI_API_KEY env var)"
    )

    args = parser.parse_args()

    # Get API key
    api_key = get_api_key(args.api_key)
    if not api_key:
        print("Error: GEMINI_API_KEY not found.", file=sys.stderr)
        print("Configure de uma das 3 formas (do mais rápido pro mais durável):", file=sys.stderr)
        print("  1. .env local: copie .env.example para .env na raiz do projeto e preencha", file=sys.stderr)
        print("  2. settings.json global: ~/.claude/settings.json -> {\"env\":{\"GEMINI_API_KEY\":\"...\"}}", file=sys.stderr)
        print("  3. Shell env: export GEMINI_API_KEY=...", file=sys.stderr)
        print("Chave em: https://aistudio.google.com/apikey", file=sys.stderr)
        sys.exit(1)

    # Import here after checking API key to avoid slow import on error
    from google import genai
    from google.genai import types
    from PIL import Image as PILImage

    # Initialise client
    client = genai.Client(api_key=api_key)

    # Set up output path
    output_path = Path(args.filename)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Load input image if provided
    input_image = None
    output_resolution = args.resolution
    if args.input_image:
        try:
            input_image = PILImage.open(args.input_image)
            print(f"Loaded input image: {args.input_image}")

            # Auto-detect resolution if not explicitly set by user
            if args.resolution == "1K":  # Default value
                # Map input image size to resolution
                width, height = input_image.size
                max_dim = max(width, height)
                if max_dim >= 3000:
                    output_resolution = "4K"
                elif max_dim >= 1500:
                    output_resolution = "2K"
                else:
                    output_resolution = "1K"
                print(f"Auto-detected resolution: {output_resolution} (from input {width}x{height})")
        except Exception as e:
            print(f"Error loading input image: {e}", file=sys.stderr)
            sys.exit(1)

    # Build full prompt with system instruction (ensures model always generates image)
    full_prompt = f"{IMAGE_GENERATION_SYSTEM_PROMPT}\n\nUser prompt: {args.prompt}"

    # Build contents (image first if editing, prompt only if generating)
    if input_image:
        contents = [input_image, full_prompt]
        print(f"Editing image with resolution {output_resolution}...")
    else:
        contents = full_prompt
        print(f"Generating image with resolution {output_resolution}...")

    try:
        response = client.models.generate_content(
            model="gemini-3-pro-image-preview",
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=types.ImageConfig(
                    image_size=output_resolution
                )
            )
        )
        
        # Process response and convert to PNG
        image_saved = False
        for part in response.parts:
            if part.text is not None:
                print(f"Model response: {part.text}")
            elif part.inline_data is not None:
                # Convert inline data to PIL Image and save as PNG
                from io import BytesIO

                # inline_data.data is already bytes, not base64
                image_data = part.inline_data.data
                if isinstance(image_data, str):
                    # If it's a string, it might be base64
                    import base64
                    image_data = base64.b64decode(image_data)

                image = PILImage.open(BytesIO(image_data))

                # Ensure RGB mode for PNG (convert RGBA to RGB with white background if needed)
                if image.mode == 'RGBA':
                    rgb_image = PILImage.new('RGB', image.size, (255, 255, 255))
                    rgb_image.paste(image, mask=image.split()[3])
                    rgb_image.save(str(output_path), 'PNG')
                elif image.mode == 'RGB':
                    image.save(str(output_path), 'PNG')
                else:
                    image.convert('RGB').save(str(output_path), 'PNG')
                image_saved = True
        
        if image_saved:
            full_path = output_path.resolve()
            print(f"\nImage saved: {full_path}")
        else:
            print("Error: No image was generated in the response.", file=sys.stderr)
            sys.exit(1)
            
    except Exception as e:
        print(f"Error generating image: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
