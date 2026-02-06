#!/usr/bin/env python3
"""
Update videos from YouTube RSS feed.
Downloads videos from RSS feed, adds them to videos.json,
and matches them with podcast episodes for embedding.
"""

import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import requests


class VideoUpdater:
    def __init__(self):
        self.repo_root = Path(__file__).parent.parent.parent
        self.data_dir = self.repo_root / "data"
        self.videos_file = self.data_dir / "videos.json"
        self.season_files = sorted(self.data_dir.glob("season_*.json"))
        self.rss_url = os.environ.get("RSS_URL")
        
    def fetch_rss_videos(self) -> List[Dict[str, Any]]:
        """Fetch videos from YouTube RSS feed."""
        print(f"Fetching videos from RSS feed...")
        try:
            response = requests.get(self.rss_url, timeout=30)
            response.raise_for_status()
            data = response.json()
            return data.get("items", [])
        except Exception as e:
            print(f"Error fetching RSS: {e}")
            return []
    
    def extract_video_data(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Extract relevant video data from RSS item."""
        try:
            title = item.get("title", "").strip()
            url = item.get("url", "").strip()
            
            # Extract video ID from URL
            if not url or "youtube.com/watch" not in url:
                return None
            
            # Extract published date - prefer _rssbridge.published, fallback to date_modified
            published_str = item.get("_rssbridge", {}).get("published", "")
            if not published_str:
                published_str = item.get("date_modified", "")
            
            published_at = published_str if published_str else None
            
            # Placeholder for duration (will need to be fetched separately if needed)
            duration = None
            
            if not title or not url:
                return None
            
            return {
                "title": title,
                "url": url,
                "published_at": published_at,
                "duration": duration
            }
        except Exception as e:
            print(f"Error extracting video data: {e}")
            return None
    
    def load_existing_videos(self) -> List[Dict[str, Any]]:
        """Load existing videos from videos.json."""
        try:
            if self.videos_file.exists():
                with open(self.videos_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print(f"Error loading existing videos: {e}")
        return []
    
    def load_season_episodes(self) -> Dict[str, List[Dict[str, Any]]]:
        """Load all podcast episodes from season files."""
        episodes = {}
        for season_file in self.season_files:
            try:
                with open(season_file, "r", encoding="utf-8") as f:
                    season_data = json.load(f)
                    season_name = season_file.stem  # e.g., "season_1"
                    episodes[season_name] = season_data
            except Exception as e:
                print(f"Error loading {season_file}: {e}")
        return episodes
    
    def normalize_title(self, title: str) -> str:
        """Normalize title for comparison."""
        # Remove common prefixes
        prefixes = ["Mundo Dolphins:", "Mundo Dolphins"]
        for prefix in prefixes:
            if title.startswith(prefix):
                title = title[len(prefix):].strip()
        
        # Lowercase and remove extra spaces
        title = re.sub(r"\s+", " ", title.lower()).strip()
        return title
    
    def find_matching_episode(
        self, video: Dict[str, Any], episodes: Dict[str, List[Dict[str, Any]]]
    ) -> Optional[Tuple[str, int, Dict[str, Any]]]:
        """Find matching episode for a video."""
        video_title_norm = self.normalize_title(video["title"])
        
        # Split into words for better matching
        video_words = set(video_title_norm.split())
        
        for season_name, season_episodes in episodes.items():
            for ep_idx, episode in enumerate(season_episodes):
                episode_title_norm = self.normalize_title(episode.get("title", ""))
                episode_words = set(episode_title_norm.split())
                
                # Exact match
                if video_title_norm == episode_title_norm:
                    return season_name, ep_idx, episode
                
                # Partial match - if video title is subset of episode or vice versa
                if (video_title_norm in episode_title_norm or
                    episode_title_norm in video_title_norm):
                    
                    # Additional date check if available
                    if video.get("published_at") and episode.get("dateAndTime"):
                        if self.dates_close(
                            video["published_at"], 
                            episode["dateAndTime"]
                        ):
                            return season_name, ep_idx, episode
                    else:
                        return season_name, ep_idx, episode
                
                # Word overlap match (at least 50% of words match)
                if len(video_words) > 0 and len(episode_words) > 0:
                    common_words = video_words & episode_words
                    overlap_ratio = len(common_words) / max(len(video_words), len(episode_words))
                    
                    if overlap_ratio >= 0.5:
                        # Additional date check
                        if video.get("published_at") and episode.get("dateAndTime"):
                            if self.dates_close(
                                video["published_at"], 
                                episode["dateAndTime"]
                            ):
                                return season_name, ep_idx, episode
        
        return None
    
    def dates_close(self, date1_str: str, date2_str: str, days: int = 3) -> bool:
        """Check if two dates are close (within specified days)."""
        try:
            # Parse ISO 8601 dates
            date1 = datetime.fromisoformat(date1_str.replace("Z", "+00:00"))
            date2 = datetime.fromisoformat(date2_str.replace("Z", "+00:00"))
            
            diff = abs((date1 - date2).total_seconds())
            threshold = days * 86400
            return diff <= threshold
        except Exception:
            return False
    
    def format_video_entry(self, video: Dict[str, Any]) -> Dict[str, Any]:
        """Format video entry for episode."""
        return {
            "title": video.get("title", ""),
            "duration": video.get("duration", ""),
            "url": video.get("url", ""),
            "published_at": video.get("published_at", "")
        }
    
    def merge_videos(
        self,
        existing: List[Dict[str, Any]],
        new_videos: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Merge new videos with existing ones, avoiding duplicates."""
        existing_urls = {v["url"] for v in existing}
        
        # Add isPodcast flag to existing videos if missing
        for video in existing:
            if "isPodcast" not in video:
                video["isPodcast"] = False
        
        # Filter and add only new videos
        merged = existing.copy()
        added_count = 0
        for video in new_videos:
            if video["url"] not in existing_urls:
                video["isPodcast"] = False
                merged.append(video)
                added_count += 1
        
        # Sort by published_at (newest first), handle missing dates gracefully
        def get_sort_key(v):
            date_str = v.get("published_at", "")
            if date_str:
                try:
                    return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                except:
                    return datetime.min
            return datetime.min
        
        merged.sort(key=get_sort_key, reverse=True)
        
        print(f"Added {added_count} new videos to the collection")
        return merged
    
    def save_videos(self, videos: List[Dict[str, Any]]) -> None:
        """Save videos to videos.json."""
        try:
            with open(self.videos_file, "w", encoding="utf-8") as f:
                json.dump(videos, f, ensure_ascii=False, indent=2)
            print(f"Saved {len(videos)} videos to {self.videos_file}")
        except Exception as e:
            print(f"Error saving videos: {e}")
    
    def save_episodes(
        self,
        episodes: Dict[str, List[Dict[str, Any]]]
    ) -> None:
        """Save updated episodes back to season files."""
        for season_name, season_episodes in episodes.items():
            season_file = self.data_dir / f"{season_name}.json"
            try:
                with open(season_file, "w", encoding="utf-8") as f:
                    json.dump(season_episodes, f, ensure_ascii=False, indent=2)
                print(f"Saved episodes to {season_file}")
            except Exception as e:
                print(f"Error saving {season_file}: {e}")
    
    def run(self) -> None:
        """Main workflow."""
        print("=" * 80)
        print("YouTube Videos Update Workflow")
        print("=" * 80)
        
        # Fetch new videos
        rss_items = self.fetch_rss_videos()
        if not rss_items:
            print("No videos found in RSS feed")
            return
        
        print(f"Found {len(rss_items)} items in RSS feed")
        
        # Extract video data
        new_videos = []
        for item in rss_items:
            video = self.extract_video_data(item)
            if video:
                new_videos.append(video)
        
        print(f"Extracted {len(new_videos)} valid videos")
        
        # Load existing data
        existing_videos = self.load_existing_videos()
        episodes = self.load_season_episodes()
        
        print(f"Loaded {len(existing_videos)} existing videos")
        print(f"Loaded episodes from {len(episodes)} season files")
        
        # Merge videos
        merged_videos = self.merge_videos(existing_videos, new_videos)
        
        # Match videos with episodes
        print("\nMatching videos with episodes...")
        matched_count = 0
        for video in merged_videos:
            if video["url"] not in {v["url"] for v in existing_videos}:
                # Only process newly added videos
                match = self.find_matching_episode(video, episodes)
                if match:
                    season_name, ep_idx, episode = match
                    video["isPodcast"] = True
                    
                    # Add video to episode
                    if "video" not in episode:
                        episode["video"] = []
                    
                    video_entry = self.format_video_entry(video)
                    # Check if video already in episode
                    if not any(
                        v.get("url") == video_entry["url"]
                        for v in episode["video"]
                    ):
                        episode["video"].append(video_entry)
                        matched_count += 1
                        print(f"  ✓ Matched: {video['title'][:60]}...")
        
        print(f"\nMatched {matched_count} videos with episodes")
        
        # Save updated data
        self.save_videos(merged_videos)
        self.save_episodes(episodes)
        
        print("\n" + "=" * 80)
        print("Workflow completed successfully")
        print("=" * 80)


if __name__ == "__main__":
    updater = VideoUpdater()
    updater.run()
