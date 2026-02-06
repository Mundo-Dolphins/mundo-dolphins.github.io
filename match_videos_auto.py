#!/usr/bin/env python3
"""
Automatic YouTube Video to Podcast Matcher
- Uses title similarity + publication date matching
- Auto-matches everything with reasonable confidence (with better thresholds)
- No interactive prompts
"""

import json
import os
import re
from datetime import datetime, timedelta
from fuzzywuzzy import fuzz
from pathlib import Path

# Configuration
VIDEOS_FILE = "data/videos.json"
DATA_DIR = "data"
TITLE_CONFIDENCE_THRESHOLD = 50  # Lowered from 60
EXACT_MATCH_THRESHOLD = 75  # Lowered from 85 for auto-confirm
DATE_CONFIDENCE_BOOST = 40

def normalize_title(title):
    """Normalize title for matching"""
    # Remove season/episode prefixes
    title = re.sub(r'^(Temp\.|Temporada|Season|T)\s*\d+\s*[.,]?\s*', '', title, flags=re.IGNORECASE)
    # Remove cap/chapter/episode prefixes
    title = re.sub(r'(Cap\.|Chapter|Episodio|Ep\.)\s*\d*\s*[.,]?\s*', '', title, flags=re.IGNORECASE)
    # Remove "P" prefix (part number like "P20")
    title = re.sub(r'^P\s*\d+\s*[.,]?\s*', '', title, flags=re.IGNORECASE)
    # Lowercase and remove extra spaces
    title = title.lower().strip()
    # Remove special characters but keep spaces
    title = re.sub(r'[^a-z0-9\s]', '', title)
    title = ' '.join(title.split())
    return title

def parse_date(date_str):
    """Parse ISO8601 date string to datetime"""
    try:
        if date_str:
            return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
    except:
        pass
    return None

def date_distance_days(date1, date2):
    """Calculate days between two dates"""
    if not date1 or not date2:
        return None
    try:
        diff = abs((date1.date() - date2.date()).days)
        return diff
    except:
        return None

def calculate_match_score(video, episode):
    """Calculate similarity score"""
    norm_video_title = normalize_title(video['title'])
    norm_episode_title = normalize_title(episode['title'])
    
    # Title similarity
    title_score = fuzz.token_set_ratio(norm_video_title, norm_episode_title)
    
    # Date proximity bonus
    date_bonus = 0
    video_date = parse_date(video.get('published_at'))
    episode_date = parse_date(episode.get('dateAndTime'))
    
    if video_date and episode_date:
        days_diff = date_distance_days(video_date, episode_date)
        if days_diff is not None:
            if days_diff == 0:
                # Same day
                date_bonus = DATE_CONFIDENCE_BOOST
            elif days_diff == 1:
                # Next day
                date_bonus = 25
            elif days_diff <= 2:
                # Within 2 days
                date_bonus = 15
    
    final_score = min(100, title_score + date_bonus)
    
    return {
        'title_score': title_score,
        'date_bonus': date_bonus,
        'final_score': final_score,
        'video_date': video_date,
        'episode_date': episode_date,
        'days_diff': date_distance_days(video_date, episode_date)
    }

def load_videos():
    """Load videos from videos.json"""
    with open(VIDEOS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    return data.get('videos', [])

def load_seasons():
    """Load all season files"""
    seasons = {}
    for season_file in sorted(Path(DATA_DIR).glob('season_*.json')):
        season_num = season_file.stem.replace('season_', '')
        with open(season_file, 'r', encoding='utf-8') as f:
            seasons[season_num] = {
                'file': season_file,
                'data': json.load(f)
            }
    return seasons

def save_season(season_num, season_data):
    """Save season file"""
    season_file = Path(DATA_DIR) / f'season_{season_num}.json'
    with open(season_file, 'w', encoding='utf-8') as f:
        json.dump(season_data, f, indent=2, ensure_ascii=False)

def find_candidate_episodes(video, seasons, threshold=TITLE_CONFIDENCE_THRESHOLD):
    """Find candidate episodes"""
    candidates = []
    
    for season_num, season_info in seasons.items():
        for episode_idx, episode in enumerate(season_info['data']):
            score_data = calculate_match_score(video, episode)
            final_score = score_data['final_score']
            
            if final_score >= threshold:
                candidates.append({
                    'final_score': final_score,
                    'title_score': score_data['title_score'],
                    'date_bonus': score_data['date_bonus'],
                    'days_diff': score_data['days_diff'],
                    'video_date': score_data['video_date'],
                    'episode_date': score_data['episode_date'],
                    'season': season_num,
                    'episode_idx': episode_idx,
                    'episode': episode,
                    'is_exact': final_score >= EXACT_MATCH_THRESHOLD
                })
    
    candidates.sort(key=lambda x: x['final_score'], reverse=True)
    return candidates

def format_video_entry(video):
    """Format video entry"""
    return {
        'title': video['title'],
        'duration': video.get('duration', ''),
        'url': video['url'],
        'published_at': video.get('published_at', '')
    }

def add_video_to_episode(episode, video):
    """Add video to episode"""
    if 'video' not in episode:
        episode['video'] = []
    
    for existing in episode['video']:
        if existing['url'] == video['url']:
            return False
    
    episode['video'].append(format_video_entry(video))
    return True

def main():
    """Main processing"""
    print("🔄 Automatic YouTube Video to Podcast Matcher")
    print("=" * 80)
    
    videos = load_videos()
    seasons = load_seasons()
    
    print(f"📂 Loaded {len(videos)} videos from {len(seasons)} seasons\n")
    
    stats = {
        'total': len(videos),
        'auto_matched': 0,
        'already_added': 0,
        'no_match': 0,
        'videos_added': 0
    }
    
    report = []
    
    for video_idx, video in enumerate(videos, 1):
        candidates = find_candidate_episodes(video, seasons)
        
        status = "OK"
        if not candidates:
            print(f"[{video_idx:2d}/{len(videos)}] ✗ No match: {video['title'][:50]}")
            stats['no_match'] += 1
            report.append({
                'video': video['title'],
                'status': 'NO_MATCH',
                'candidates': 0
            })
            continue
        
        best = candidates[0]
        
        # Auto-match if:
        # 1. High score with same-day dates
        # 2. Exact match threshold
        auto_match = (
            best['days_diff'] == 0 and best['final_score'] >= 65
        ) or best['is_exact']
        
        if not auto_match:
            print(f"[{video_idx:2d}/{len(videos)}] REVIEW: {video['title'][:40]} ({best['final_score']:.0f}%) vs {best['episode']['title'][:40]}")
            report.append({
                'video': video['title'],
                'status': 'NEEDS_REVIEW',
                'episode': best['episode']['title'],
                'score': best['final_score'],
                'season': best['season'],
                'candidates': len(candidates)
            })
            continue
        
        # Do the match
        season_info = seasons[best['season']]
        episode = season_info['data'][best['episode_idx']]
        
        if add_video_to_episode(episode, video):
            print(f"[{video_idx:2d}/{len(videos)}] ✓ Added to S{best['season']}: {video['title'][:40]}")
            stats['auto_matched'] += 1
            stats['videos_added'] += 1
            video['isPodcast'] = True
            save_season(best['season'], season_info['data'])
        else:
            print(f"[{video_idx:2d}/{len(videos)}] ℹ️  Already in episode: {video['title'][:40]}")
            stats['already_added'] += 1
            video['isPodcast'] = True
            save_season(best['season'], season_info['data'])
        
        report.append({
            'video': video['title'],
            'status': 'MATCHED',
            'episode': best['episode']['title'],
            'score': best['final_score'],
            'season': best['season'],
            'days_diff': best['days_diff']
        })
    
    # Save videos
    print("\n💾 Saving updated videos.json...")
    with open(VIDEOS_FILE, 'w', encoding='utf-8') as f:
        json.dump(videos, f, indent=2, ensure_ascii=False)
    
    # Print report
    print("\n" + "=" * 80)
    print("📊 SUMMARY")
    print("=" * 80)
    print(f"Total videos processed:    {stats['total']}")
    print(f"Auto-matched:              {stats['auto_matched']}")
    print(f"Already in episodes:       {stats['already_added']}")
    print(f"No matches found:          {stats['no_match']}")
    print(f"Needs review:              {len([r for r in report if r['status'] == 'NEEDS_REVIEW'])}")
    print(f"Videos successfully added: {stats['videos_added']}")
    print("=" * 80)
    
    # Show items needing review
    review_items = [r for r in report if r['status'] == 'NEEDS_REVIEW']
    if review_items:
        print(f"\n⚠️  {len(review_items)} Items needing manual review:\n")
        for item in review_items:
            print(f"  📹 {item['video']}")
            print(f"     Best match: {item['episode']} (Score: {item['score']:.0f}%)")
            print(f"     Season: {item['season']}, Candidates: {item['candidates']}\n")

if __name__ == '__main__':
    main()
