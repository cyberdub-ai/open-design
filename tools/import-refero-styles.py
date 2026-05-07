#!/usr/bin/env python3
"""Import design styles from styles.refero.design into Open Design design-systems/."""

import os
import re
import time
import requests

PROXY = {"http": "http://127.0.0.1:8118", "https": "http://127.0.0.1:8118"}
HEADERS = {"User-Agent": "Mozilla/5.0"}
API_BASE = "https://styles.refero.design/api"

INDUSTRY_CATEGORY = {
    "ai": "AI & Developer Tools",
    "fintech": "Fintech & Finance",
    "productivity": "Productivity & SaaS",
    "design": "Design & Creative",
    "ecommerce": "E-Commerce & Retail",
    "media": "Media & Entertainment",
    "enterprise": "Enterprise & B2B",
    "consumer": "Consumer Apps",
    "agency": "Agency & Creative",
}


def slug(name: str) -> str:
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return f"refero-{s}"


def get_category(style: dict, ds: dict) -> str:
    industry = ds.get("industry") or style.get("industry") or ""
    return INDUSTRY_CATEGORY.get(industry.lower(), "Web & SaaS")


def render_design_md(style: dict, ds: dict) -> str:
    name = style["siteName"]
    site_url = style["url"]
    north_star = ds.get("northStar", "")
    description = ds.get("description", "")
    theme = ds.get("theme", "light")
    cat = get_category(style, ds)

    lines = []

    lines.append(f"# Design System Inspired by {name}")
    lines.append("")
    lines.append(f"> Category: {cat}")
    lines.append(f"> Surface: web")
    if north_star:
        lines.append(f"> {north_star}")
    lines.append(f"> Source: {site_url}")
    lines.append("")

    if description:
        lines.append("## Overview")
        lines.append("")
        lines.append(description)
        lines.append("")

    colors = ds.get("colors", [])
    if colors:
        lines.append("## Color Palette")
        lines.append("")
        lines.append(f"Theme: **{theme}**")
        lines.append("")
        groups: dict = {}
        for c in colors:
            groups.setdefault(c.get("group", "other"), []).append(c)
        for group_name, group_colors in groups.items():
            lines.append(f"### {group_name.title()}")
            lines.append("")
            for c in group_colors:
                lines.append(f"- **{c['name']}** (`{c['hex']}`): {c.get('role', '')}")
            lines.append("")

    surfaces = ds.get("surfaces", [])
    if surfaces:
        lines.append("## Surfaces")
        lines.append("")
        for s in surfaces:
            lines.append(f"- **Level {s['level']} — {s['name']}** (`{s['hex']}`): {s.get('purpose', '')}")
        lines.append("")

    typography = ds.get("typography", [])
    if typography:
        lines.append("## Typography")
        lines.append("")
        for t in typography:
            family = t.get("family", "")
            role = t.get("role", "")
            weights = t.get("weights", [])
            w_str = ", ".join(str(w) for w in weights) if weights else ""
            lines.append(f"- **{family}** — {role}")
            if w_str:
                lines.append(f"  Weights: {w_str}")
        lines.append("")

    type_scale = ds.get("typeScale", [])
    if type_scale:
        lines.append("## Type Scale")
        lines.append("")
        lines.append("| Role | Size | Line Height | Letter Spacing |")
        lines.append("|------|------|-------------|----------------|")
        for t in type_scale:
            lines.append(f"| {t.get('role','')} | {t.get('size','')}px | {t.get('lineHeight','')} | {t.get('letterSpacing','')}px |")
        lines.append("")

    spacing = ds.get("spacing")
    if spacing and isinstance(spacing, dict):
        lines.append("## Spacing & Layout")
        lines.append("")
        for key, label in [("radius","Border Radius"),("elementGap","Element Gap"),("sectionGap","Section Gap"),("cardPadding","Card Padding"),("pageMaxWidth","Page Max Width")]:
            val = spacing.get(key)
            if val is not None:
                lines.append(f"- **{label}**: {val}")
        lines.append("")

    layout = ds.get("layout", "")
    if layout:
        lines.append("## Layout")
        lines.append("")
        lines.append(layout)
        lines.append("")

    elevation = ds.get("elevation", [])
    if elevation:
        lines.append("## Elevation & Shadows")
        lines.append("")
        for e in elevation:
            lines.append(f"- **{e.get('element','')}**: `{e.get('style','')}`")
        lines.append("")

    imagery = ds.get("imagery", "")
    if imagery:
        lines.append("## Imagery")
        lines.append("")
        lines.append(imagery)
        lines.append("")

    dos = ds.get("dos", [])
    donts = ds.get("donts", [])
    if dos or donts:
        lines.append("## Design Rules")
        lines.append("")
        if dos:
            lines.append("### Do")
            lines.append("")
            for d in dos:
                lines.append(f"- {d}")
            lines.append("")
        if donts:
            lines.append("### Don't")
            lines.append("")
            for d in donts:
                lines.append(f"- {d}")
            lines.append("")

    similar = ds.get("similar", [])
    if similar:
        lines.append("## Similar Brands")
        lines.append("")
        for s in similar:
            lines.append(f"- **{s.get('business','')}**: {s.get('why','')}")
        lines.append("")

    for section in ds.get("customSections", []):
        content = section.get("content", "")
        if content:
            lines.append(f"## {section.get('title', 'Notes')}")
            lines.append("")
            lines.append(content)
            lines.append("")

    return "\n".join(lines)


def fetch_all_styles() -> list:
    all_styles = []
    page = 1
    while True:
        r = requests.get(f"{API_BASE}/styles?page={page}&limit=50", headers=HEADERS, proxies=PROXY, timeout=15)
        r.raise_for_status()
        d = r.json()
        batch = d.get("styles", [])
        if not batch:
            break
        all_styles.extend(batch)
        next_page = d.get("nextPage")
        print(f"  page {page}: {len(batch)} (total: {len(all_styles)})")
        if not next_page or next_page == page:
            break
        page = next_page
        time.sleep(0.1)
    return all_styles


def main() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    out_dir = os.path.join(repo_root, "design-systems")

    print(f"Output dir: {out_dir}")
    print("Fetching all pages...")
    styles = fetch_all_styles()
    print(f"Total: {len(styles)} styles\n")

    written = skipped = errors = 0

    for i, style in enumerate(styles, 1):
        sid = style["id"]
        name = style["siteName"]
        folder = slug(name)
        dest_file = os.path.join(out_dir, folder, "DESIGN.md")

        if os.path.exists(dest_file):
            skipped += 1
            continue

        try:
            r2 = requests.get(f"{API_BASE}/styles/{sid}", headers=HEADERS, proxies=PROXY, timeout=15)
            r2.raise_for_status()
            full_style = r2.json()["style"]
            ds = full_style.get("fullResult", {}).get("designSystem", {})

            if not ds:
                print(f"  [{i}/{len(styles)}] SKIP (no data): {name}")
                skipped += 1
                continue

            md = render_design_md(full_style, ds)
            os.makedirs(os.path.join(out_dir, folder), exist_ok=True)
            with open(dest_file, "w") as f:
                f.write(md)
            written += 1
            print(f"  [{i}/{len(styles)}] {name} → {folder} ({len(md)} chars)")
            time.sleep(0.05)
        except Exception as e:
            errors += 1
            print(f"  [{i}/{len(styles)}] ERROR {name}: {e}")

    print(f"\nDone. written={written} skipped={skipped} errors={errors}")


if __name__ == "__main__":
    main()
