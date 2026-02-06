#!/usr/bin/env python3
import json
from pathlib import Path
p = Path('..') / '..' / 'data' / 'videos.json'
print('Updating', p)
with p.open('r', encoding='utf-8') as f:
    data = json.load(f)
changed = 0
for obj in data:
    if obj.get('embeddable') is not True:
        obj['embeddable'] = True
        changed += 1
with p.open('w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print('Changed', changed, 'objects')
