#!/usr/bin/env python3
"""
Improved Interactive script to match YouTube videos with podcast episodes.
- Uses title similarity + publication date matching
- Exact/date-based matches are added automatically
- Partial matches are presented for interactive confirmation
- Processes ALL videos from videos.json into season_*.json files
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
TITLE_CONFIDENCE_THRESHOLD = 60
EXACT_MATCH_THRESHOLD = 85
DATE_CONFIDENCE_BOOST = 30  # Extra points if dates match
DATE_TOLERANCE_DAYS = 2  # Match videos/episodes within 2 days

def normalize_title(title):
    """Normalize title for matching"""
    # Remove season/episode prefixes
    title = re.sub(r'^(Temp\.|Temporada|Season|T)\s*\d+\s*[.,]?\s*', '', title, flags=re.IGNORECASE)
    # Remove cap/chapter/episode prefixes
    title = re.sub(r'(Cap\.|Chapter|Episodio|Ep\.)\s*\d*\s*[.,]?\s*', '', title, flags=re.IGNORECASE)
    # Remove "P" prefix (episodio number like "P20")
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
            # Handle ISO8601 format with timezone
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
    """
    Calculate similarity score between video and episode
    Considers title similarity AND date proximity
    """
    norm_video_title = normalize_title(video['title'])
    norm_episode_title = normalize_title(episode['title'])
    
    # Title similarity (0-100)
    title_score = fuzz.token_set_ratio(norm_video_title, norm_episode_title)
    
    # Date proximity bonus
    date_bonus = 0
    video_date = parse_date(video.get('published_at'))
    episode_date = parse_date(episode.get('dateAndTime'))
    
    if video_date and episode_date:
        days_diff = date_distance_days(video_date, episode_date)
        if days_diff is not None:
            if days_diff == 0:
                # Same day - STRONG indicator, give significant bonus
                date_bonus = 40  # Increased from 30
            elif days_diff == 1:
                # Next day - moderate indicator
                date_bonus = 25
            elif days_diff <= DATE_TOLERANCE_DAYS:
                # Within 2 days - light indicator
                date_bonus = 15
    
    # Final score: title score + date bonus (capped at 100)
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
    # Handle both formats: list or {videos: [...]}
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
    """Find candidate episodes for a video based on title similarity and date"""
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
    
    # Sort by score (descending)
    candidates.sort(key=lambda x: x['final_score'], reverse=True)
    return candidates

def format_video_entry(video):
    """Format video entry for season file"""
    return {
        'title': video['title'],
        'duration': video.get('duration', ''),
        'url': video['url'],
        'published_at': video.get('published_at', '')
    }

def print_menu():
    """Print interaction menu"""
    print("\n" + "="*80)
    print("Options:")
    print("  (y)es - Add this match")
    print("  (n)o - Skip this video")
    print("  (s)kip - Skip and show next candidate")
    print("  (c)ancel - Cancel this video and move to next")
    print("  (q)uit - Exit script")
    print("="*80)

def ask_confirmation(video, candidates):
    """Ask user to confirm match interactively"""
    if not candidates:
        return None
    
    candidate = candidates[0]
    print(f"\n📹 Video: {video['title']}")
    print(f"   Duration: {video.get('duration', 'N/A')}")
    print(f"   Published: {video.get('published_at', 'N/A')}")
    print(f"   URL: {video['url']}")
    
    print(f"\n✓ Best Match (Score: {candidate['final_score']:.1f}% = Title:{candidate['title_score']:.0f}% + Date:{candidate['date_bonus']:.0f}%):")
    print(f"   Season {candidate['season']}, Episode: {candidate['episode']['title']}")
    print(f"   Published: {candidate['episode'].get('dateAndTime', 'N/A')}")
    if candidate['days_diff'] is not None:
        print(f"   Date difference: {candidate['days_diff']} day(s)")
    print(f"   {'[EXACT/AUTO-MATCH]' if candidate['is_exact'] else '[PARTIAL MATCH]'}")
    
    if len(candidates) > 1:
        print(f"\n📋 Other candidates ({len(candidates)-1} more):")
        for i, cand in enumerate(candidates[1:4], 1):  # Show top 3 alternatives
            date_str = f" ({cand['days_diff']}d)" if cand['days_diff'] is not None else ""
            print(f"   {i}. Season {cand['season']}, {cand['episode']['title']}{date_str} " +
                  f"({cand['final_score']:.1f}%)")
    
    if candidate['is_exact']:
        print("\n→ Auto-confirming high-confidence match...")
        return candidate
    
    print_menu()
    while True:
        choice = input("Your choice: ").lower().strip()
        
        if choice in ('y', 'yes'):
            return candidate
        elif choice in ('n', 'no', 'c', 'cancel'):
            return None
        elif choice in ('s', 'skip') and len(candidates) > 1:
            # Show next candidate
            candidates = candidates[1:]
            return ask_confirmation(video, candidates)
        elif choice in ('q', 'quit'):
            raise KeyboardInterrupt("User quit")
        else:
            print("Invalid choice. Try again.") 

def add_video_to_episode(episode, video):
    """Add video to episode's video array"""
    if 'video' not in episode:
        episode['video'] = []
    
    # Check if video already exists
    for existing in episode['video']:
        if existing['url'] == video['url']:
            print(f"   ℹ️  Video already in episode")
            return False
    
    episode['video'].append(format_video_entry(video))
    return True

def main():
    """Main processing loop"""
    print("🎬 Improved Interactive YouTube Video to Podcast Matcher")
    print("=" * 80)
    print("Features:")
    print("  - Title similarity matching (fuzzy)")
    print("  - Publication date proximity matching")
    print("  - Auto-confirm high-confidence matches")
    print("=" * 80)
    
    # Load data
    print("\n📂 Loading data...")
    videos = load_videos()
    seasons = load_seasons()
    
    print(f"✓ Loaded {len(videos)} videos")
    print(f"✓ Loaded {len(seasons)} seasons")
    
    stats = {
        'total': len(videos),
        'exact_matched': 0,
        'user_confirmed': 0,
        'skipped': 0,
        'already_added': 0,
        'no_match': 0,
        'videos_added': 0
    }
    
    try:
        for video_idx, video in enumerate(videos, 1):
            print(f"\n[{video_idx}/{len(videos)}] Processing video...", end=" ")
            
            # Don't skip videos marked as non-podcast - they might still be podcasts
            # Just note if they're marked as non-podcast
            video_status = "Non-podcast" if video.get('isPodcast') is False else "Unmarked"
            
            # Find candidates
            candidates = find_candidate_episodes(video, seasons)
            
            if not candidates:
                print(f"✗ No match")
                stats['no_match'] += 1
                continue
            
            # Check for exact/high-confidence match
            # For videos marked as non-podcast, we're more aggressive with auto-match
            # if dates match and title is reasonable
            best_candidate = candidates[0]
            
            # Auto-confirm if:
            # 1. High confidence score AND same-day dates
            # 2. Very high confidence (exact match threshold)
            auto_confirm = (
                best_candidate['days_diff'] == 0 and best_candidate['final_score'] >= 70
            ) or best_candidate['is_exact']
            
            if auto_confirm:
                choice = best_candidate
                print("✓ Auto-matched")
                stats['exact_matched'] += 1
            else:
                # Ask user for lower-confidence matches
                choice = ask_confirmation(video, candidates)
                if choice:
                    print("✓ User confirmed")
                    stats['user_confirmed'] += 1
                else:
                    print("✗ Skipped by user")
                    stats['skipped'] += 1
                    continue
            
            # Add video to episode
            if choice:
                season_info = seasons[choice['season']]
                episode = season_info['data'][choice['episode_idx']]
                
                if add_video_to_episode(episode, video):
                    print(f"   ✓ Added to Season {choice['season']}")
                    stats['videos_added'] += 1
                    
                    # Mark video as podcast if added to any episode
                    video['isPodcast'] = True
                else:
                    stats['already_added'] += 1
                
                # Save immediately
                save_season(choice['season'], season_info['data'])
    
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
    
    # Save videos.json with updated isPodcast flags
    print("\n💾 Saving updated videos.json...")
    with open(VIDEOS_FILE, 'w', encoding='utf-8') as f:
        json.dump(videos, f, indent=2, ensure_ascii=False)
    
    # Print statistics
    print("\n" + "=" * 80)
    print("📊 SUMMARY")
    print("=" * 80)
    print(f"Total videos processed:           {stats['total']}")
    print(f"Auto-matched (high confidence):   {stats['exact_matched']}")
    print(f"User confirmed matches:           {stats['user_confirmed']}")
    print(f"Already in episodes:              {stats['already_added']}")
    print(f"No matches found:                 {stats['no_match']}")
    print(f"Skipped by user:                  {stats['skipped']}")
    print(f"Videos successfully added:        {stats['videos_added']}")
    print("=" * 80)

if __name__ == '__main__':
    main()
