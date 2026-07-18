#!/usr/bin/env python3
"""统计 wechat-bot 仓库源代码行数与文件分布"""

import os
import json
from collections import defaultdict

ROOT = r"C:\Users\18034\wechat-bot"

EXCLUDE_DIRS = {'.git', 'node_modules', '.data', 'patches'}
SRC_EXTS = {'.js', '.json', '.md', '.patch', '.yml', '.yaml', '.env', '.dockerfile'}

stats = {
    'total_files': 0,
    'total_lines': 0,
    'by_ext': defaultdict(lambda: {'files': 0, 'lines': 0}),
    'by_dir': defaultdict(lambda: {'files': 0, 'lines': 0}),
}

def count_lines(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return sum(1 for _ in f)
    except:
        return 0

for dirpath, dirnames, filenames in os.walk(ROOT):
    # filter out excluded dirs
    dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]

    for fname in filenames:
        ext = os.path.splitext(fname)[1].lower()
        fpath = os.path.join(dirpath, fname)
        rel = os.path.relpath(fpath, ROOT)
        lines = count_lines(fpath)
        stats['total_files'] += 1
        stats['total_lines'] += lines
        stats['by_ext'][ext or '(no ext)']['files'] += 1
        stats['by_ext'][ext or '(no ext)']['lines'] += lines

        # by top-level dir
        parts = rel.replace('\\', '/').split('/')
        top_dir = parts[0] if len(parts) > 1 else '(root)'
        stats['by_dir'][top_dir]['files'] += 1
        stats['by_dir'][top_dir]['lines'] += lines

print("=" * 60)
print("wechat-bot 代码统计报告")
print("=" * 60)
print(f"总文件数: {stats['total_files']}")
print(f"总代码行数: {stats['total_lines']}")
print()

# By extension
print("--- 按文件扩展名分布 ---")
for ext, data in sorted(stats['by_ext'].items(), key=lambda x: x[1]['lines'], reverse=True):
    print(f"  {ext:15s} | 文件数: {data['files']:4d} | 行数: {data['lines']:6d}")

print()
print("--- 按目录分布 (源码相关) ---")
for d, data in sorted(stats['by_dir'].items(), key=lambda x: x[1]['lines'], reverse=True):
    if d == '(root)':
        print(f"  {'(根目录)':15s} | 文件数: {data['files']:4d} | 行数: {data['lines']:6d}")
    else:
        print(f"  {d:15s} | 文件数: {data['files']:4d} | 行数: {data['lines']:6d}")

# Detail: Source .js files in src/
print()
print("--- src/ 下各 JS 源文件行数 ---")
src_js_files = []
for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, 'src')):
    for fname in filenames:
        if fname.endswith('.js'):
            fpath = os.path.join(dirpath, fname)
            rel = os.path.relpath(fpath, ROOT)
            lines = count_lines(fpath)
            src_js_files.append((rel, lines))

for rel, lines in sorted(src_js_files, key=lambda x: x[1], reverse=True):
    print(f"  {lines:5d} 行 | {rel}")

# Root JS files
print()
print("--- 根目录 JS 文件 ---")
for fname in os.listdir(ROOT):
    if fname.endswith('.js'):
        fpath = os.path.join(ROOT, fname)
        lines = count_lines(fpath)
        print(f"  {lines:5d} 行 | {fname}")

print()
print("=" * 60)
print("统计完成")
