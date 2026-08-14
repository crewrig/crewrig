#!/usr/bin/env python3
"""
check-figure-labels.py — Verify figure labels against sidecar prompts using OCR (spec 0156 / issue #881).
"""

import sys
import os
import glob
import re
import subprocess
import difflib

def normalize(text):
    text = text.replace("’", "'").replace("“", '"').replace("”", '"').replace("—", "-").replace("–", "-")
    text = re.sub(r"-\s+", "-", text)
    text = re.sub(r"[^\w\s-]", " ", text)
    return re.sub(r"\s+", " ", text).strip().lower()

def extract_labels(prompt_path):
    with open(prompt_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 1. Look for Box text: "..."
    box_matches = re.findall(r'Box text:\s*"([^"]+)"', content)
    if box_matches:
        return box_matches
    
    # 2. Look for numbered list of quoted strings e.g. 1. "Claude Code"
    quoted_matches = re.findall(r'^\s*(?:\d+\.\s*)?"([^"]+)"\s*$', content, re.MULTILINE)
    if quoted_matches:
        return quoted_matches
    
    return []

def get_clusters(png_path):
    cmd = ["tesseract", png_path, "stdout", "tsv"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        return []
    
    lines = res.stdout.splitlines()
    words = []
    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) >= 12 and parts[0] == "5" and parts[11].strip():
            left, top, width, height, text = int(parts[6]), int(parts[7]), int(parts[8]), int(parts[9]), parts[11]
            words.append({
                "left": left, "top": top, "right": left + width, "bottom": top + height, "text": text
            })
            
    if not words:
        return []

    words_by_x = sorted(words, key=lambda w: w["left"])
    clusters = []
    for w in words_by_x:
        merged = False
        for c in clusters:
            if not (w["right"] < c["left"] - 40 or w["left"] > c["right"] + 40):
                c["words"].append(w)
                c["left"] = min(c["left"], w["left"])
                c["right"] = max(c["right"], w["right"])
                c["top"] = min(c["top"], w["top"])
                c["bottom"] = max(c["bottom"], w["bottom"])
                merged = True
                break
        if not merged:
            clusters.append({
                "left": w["left"], "right": w["right"], "top": w["top"], "bottom": w["bottom"],
                "words": [w]
            })
            
    clusters.sort(key=lambda c: (c["left"], c["top"]))
    
    res_clusters = []
    for c in clusters:
        c_words = sorted(c["words"], key=lambda w: (w["top"] // 20, w["left"]))
        raw_txt = " ".join(w["text"] for w in c_words)
        res_clusters.append((c["left"], c["top"], raw_txt, normalize(raw_txt)))
        
    return res_clusters

def is_word_matched(word, ocr_words):
    for ow in ocr_words:
        if word == ow or difflib.SequenceMatcher(None, word, ow).ratio() >= 0.75:
            return True
    return False

def match_label_in_text(label, text):
    norm_lbl = normalize(label)
    norm_txt = normalize(text)

    if norm_lbl in norm_txt:
        return True

    lbl_words = [w for w in norm_lbl.split() if len(w) > 1]
    txt_words = norm_txt.split()

    if not lbl_words:
        return False

    matched_count = sum(1 for lw in lbl_words if is_word_matched(lw, txt_words))
    return (matched_count / len(lbl_words)) >= 0.5

def match_label(label, clusters, full_raw_text):
    # 1. Try spatial clusters first
    for idx, (left, top, raw_txt, norm_txt) in enumerate(clusters):
        if match_label_in_text(label, raw_txt):
            return idx, left, top

    # 2. Fallback to full OCR text stream
    if match_label_in_text(label, full_raw_text):
        return 0, 0, 0

    return None

def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    sidecars = sorted(glob.glob(os.path.join(repo_root, "docs", "assets", "**", "*.prompt.md"), recursive=True))
    
    if not sidecars:
        print("[INFO] No figure prompt sidecars found in docs/assets.")
        sys.exit(0)

    total_figures = 0
    failed_figures = 0

    for sidecar in sidecars:
        png = sidecar[:-10] + ".png"
        if not os.path.exists(png):
            continue
        
        total_figures += 1
        rel_png = os.path.relpath(png, repo_root)
        labels = extract_labels(sidecar)
        clusters = get_clusters(png)
        full_ocr = " ".join(c[2] for c in clusters)

        print(f"Checking {rel_png} ({len(labels)} expected labels)...")
        
        if not labels:
            print(f"  [WARN] No labels extracted from sidecar {os.path.relpath(sidecar, repo_root)}")
            continue

        last_idx = -1
        figure_ok = True

        for lbl in labels:
            res = match_label(lbl, clusters, full_ocr)
            if res is None:
                print(f"  ❌ [FAIL] Missing label: '{lbl}'")
                figure_ok = False
            else:
                c_idx, left, top = res
                if c_idx < last_idx:
                    print(f"  ❌ [FAIL] Label out of order: '{lbl}' found at cluster {c_idx} (x={left}px), expected after cluster {last_idx}")
                    figure_ok = False
                else:
                    print(f"  ✓ [PASS] Label: '{lbl}'")
                    last_idx = c_idx

        if not figure_ok:
            failed_figures += 1
            print(f"  RESULT: FAIL for {rel_png}\n")
        else:
            print(f"  RESULT: PASS for {rel_png}\n")

    if failed_figures > 0:
        print(f"[FAIL] {failed_figures}/{total_figures} figure(s) failed label OCR verification.")
        sys.exit(1)
    else:
        print(f"[PASS] All {total_figures} figure(s) passed label OCR verification.")
        sys.exit(0)

if __name__ == "__main__":
    main()
