import json
from datetime import datetime
from pathlib import Path

# Load videos
with open('data/videos.json', 'r') as f:
    videos = json.load(f)

# Load seasons
seasons = {}
for season_file in sorted(Path('data').glob('season_*.json')):
    season_num = season_file.stem.replace('season_', '')
    with open(season_file, 'r') as f:
        seasons[season_num] = json.load(f)

# Videos marked as non-podcast
non_podcast = [v for v in videos if v.get('isPodcast') is False]
print(f"Videos marked as NON-PODCAST: {len(non_podcast)}\n")

# Let's check that specific video the user mentioned
target_title = "T3 P20. Derrota contra Broncos. Previa vs Jets"
target_video = next((v for v in videos if v['title'] == target_title), None)

if target_video:
    print(f"✓ Found the video: {target_video['title']}")
    print(f"  isPodcast: {target_video.get('isPodcast')}")
    print(f"  Date: {target_video.get('published_at')[:10]}")
    
    # Look for episodes in season_3
    print(f"\n  Looking in Season 3 for matches...")
    for ep_idx, ep in enumerate(seasons['3']):
        if 'broncos' in ep['title'].lower() and '20' in ep['title']:
            print(f"\n  Found candidate:")
            print(f"    Episode: {ep['title']}")
            print(f"    Date: {ep.get('dateAndTime')[:10]}")
else:
    print(f"✗ Video not found: {target_title}")
    print(f"\nAll videos in dataset:")
    for i, v in enumerate(videos):
        if i < 30:
            print(f"  {i}: {v['title']}")
