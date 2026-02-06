#!/usr/bin/env python3
"""
Detailed review of videos needing manual validation
"""

import json
import re
from datetime import datetime
from fuzzywuzzy import fuzz
from pathlib import Path

VIDEOS_FILE = "data/videos.json"
DATA_DIR = "data"

def normalize_title(title):
    """Normalize title for matching"""
    title = re.sub(r'^(Temp\.|Temporada|Season|T)\s*\d+\s*[.,]?\s*', '', title, flags=re.IGNORECASE)
    title = re.sub(r'(Cap\.|Chapter|Episodio|Ep\.)\s*\d*\s*[.,]?\s*', '', title, flags=re.IGNORECASE)
    title = re.sub(r'^P\s*\d+\s*[.,]?\s*', '', title, flags=re.IGNORECASE)
    title = title.lower().strip()
    title = re.sub(r'[^a-z0-9\s]', '', title)
    title = ' '.join(title.split())
    return title

def parse_date(date_str):
    """Parse ISO8601 date"""
    try:
        if date_str:
            return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
    except:
        pass
    return None

def analyze_reviews():
    """Analyze the 13 videos needing review"""
    
    with open(VIDEOS_FILE, 'r') as f:
        videos = json.load(f)
    
    seasons = {}
    for season_file in sorted(Path(DATA_DIR).glob('season_*.json')):
        season_num = season_file.stem.replace('season_', '')
        with open(season_file, 'r') as f:
            seasons[season_num] = json.load(f)
    
    # The 13 videos needing review
    review_videos = [
        "¿Qué esperar de la defensa de Jeff Hafley?",
        "JUGAMOS AL MADDEN 21. Nuestro primer partido",
        "JUGANDO AL MADDEN 21. Modo Franquicia. En busca de la 1ª victoria",
        "Entrvista a Ricardo Montesdeoca",
        "Previa Bears-Dolphins",
        "Píldora Dan Marino",
        "Temporada 2018. Cap. 04 (parte 5 de 7, hecho con Spreaker)",
        "Temporada 2018. Cap. 04 (parte 6 de 7, hecho con Spreaker)",
        "Temporada 2018. Cap. 04 (parte 4 de 7, hecho con Spreaker)",
        "Temporada 2018. Cap. 04 (parte 3 de 7, hecho con Spreaker)",
        "Temporada 2018. Cap. 04 (parte 7 de 7, hecho con Spreaker)",
        "Temporada 2018. Cap. 04 (parte 2 de 7, hecho con Spreaker)",
        "Temporada 2018. Cap. 04 (parte 1 de 7, hecho con Spreaker)",
    ]
    
    print("=" * 100)
    print("DETAILED REVIEW OF 13 VIDEOS NEEDING VALIDATION")
    print("=" * 100)
    
    recommendations = []
    
    for video_title in review_videos:
        video = next((v for v in videos if v['title'] == video_title), None)
        if not video:
            continue
        
        print(f"\n{'─' * 100}")
        print(f"📹 VIDEO: {video['title']}")
        print(f"   Duration: {video.get('duration', 'N/A')}")
        print(f"   Published: {video.get('published_at', 'N/A')}")
        
        # Find best matches
        candidates = []
        for season_num, episodes in seasons.items():
            for ep_idx, episode in enumerate(episodes):
                norm_video = normalize_title(video['title'])
                norm_ep = normalize_title(episode['title'])
                score = fuzz.token_set_ratio(norm_video, norm_ep)
                
                if score >= 45:
                    candidates.append({
                        'score': score,
                        'season': season_num,
                        'ep_idx': ep_idx,
                        'episode': episode
                    })
        
        candidates.sort(key=lambda x: x['score'], reverse=True)
        
        print(f"\n   Top 5 Candidates:")
        for i, cand in enumerate(candidates[:5], 1):
            print(f"   {i}. S{cand['season']}: {cand['episode']['title'][:60]} ({cand['score']:.0f}%)")
        
        # Analysis
        if not candidates:
            print(f"\n   ❌ RECOMMENDATION: NO PODCAST - No viable matches")
            recommendations.append({
                'video': video['title'],
                'rec': 'SKIP',
                'reason': 'No viable candidates'
            })
        elif candidates[0]['score'] >= 65:
            print(f"\n   ✅ RECOMMENDATION: ADD TO S{candidates[0]['season']}")
            print(f"      Episode: {candidates[0]['episode']['title']}")
            recommendations.append({
                'video': video['title'],
                'rec': 'ADD',
                'season': candidates[0]['season'],
                'episode': candidates[0]['episode']['title'],
                'score': candidates[0]['score']
            })
        else:
            # Check if video title suggests it's not a podcast
            skip_keywords = ['madden', 'píldora', 'parte', 'pildora', 'spreaker']
            if any(kw in video['title'].lower() for kw in skip_keywords):
                if 'madden' in video['title'].lower():
                    print(f"\n   ⚠️  RECOMMENDATION: SKIP - Gaming content (Madden)")
                elif 'píldora' in video['title'].lower() or 'pildora' in video['title'].lower():
                    print(f"\n   ⚠️  RECOMMENDATION: SKIP - Microcontent/Píldora")
                elif 'parte' in video['title'].lower():
                    print(f"\n   ⚠️  RECOMMENDATION: SKIP - Multi-part episode fragment")
                else:
                    print(f"\n   ⚠️  RECOMMENDATION: UNCLEAR - Manual review needed")
                recommendations.append({
                    'video': video['title'],
                    'rec': 'SKIP',
                    'reason': 'Content type unclear or non-podcast material'
                })
            else:
                print(f"\n   ⚠️  RECOMMENDATION: MANUAL REVIEW - Low match score")
                recommendations.append({
                    'video': video['title'],
                    'rec': 'REVIEW',
                    'best_match': candidates[0]['episode']['title'],
                    'score': candidates[0]['score']
                })
    
    # Summary
    print(f"\n\n{'=' * 100}")
    print("SUMMARY OF RECOMMENDATIONS")
    print('=' * 100)
    
    add_recommendations = [r for r in recommendations if r['rec'] == 'ADD']
    skip_recommendations = [r for r in recommendations if r['rec'] == 'SKIP']
    review_recommendations = [r for r in recommendations if r['rec'] == 'REVIEW']
    
    print(f"\n✅ ADD TO EPISODES ({len(add_recommendations)}):")
    for r in add_recommendations:
        print(f"   • {r['video'][:60]}")
        print(f"     → S{r['season']}: {r['episode'][:60]} ({r['score']:.0f}%)")
    
    print(f"\n⚠️  SKIP - NOT PODCASTS ({len(skip_recommendations)}):")
    for r in skip_recommendations:
        print(f"   • {r['video'][:60]}")
        print(f"     Reason: {r['reason']}")
    
    print(f"\n🔍 MANUAL REVIEW NEEDED ({len(review_recommendations)}):")
    for r in review_recommendations:
        print(f"   • {r['video'][:60]}")
        print(f"     Best match: {r['best_match'][:60]} ({r['score']:.0f}%)")
    
    print(f"\n{'=' * 100}\n")
    
    return recommendations

if __name__ == '__main__':
    analyze_reviews()
