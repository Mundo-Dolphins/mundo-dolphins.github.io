#!/usr/bin/env python3
"""
Update videos from YouTube Data API.
Downloads recent videos from the channel, adds them to videos.json,
stores embeddable status, and matches them with podcast episodes.
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
        self.api_key = os.environ.get("YOUTUBE_API_KEY")
        self.channel_id = os.environ.get("YOUTUBE_CHANNEL_ID")
        self.max_pages = int(os.environ.get("YOUTUBE_MAX_PAGES", "4"))

    def fetch_channel_uploads_playlist(self) -> Optional[str]:
        """Fetch uploads playlist ID for the channel."""
        if not self.api_key or not self.channel_id:
            print("Missing YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID")
            return None

        url = "https://www.googleapis.com/youtube/v3/channels"
        params = {
            "part": "contentDetails",
            "id": self.channel_id,
            "key": self.api_key,
        }
        try:
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            items = data.get("items", [])
            if not items:
                print("No channel data found for provided channel ID")
                return None
            return items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
        except Exception as e:
            print(f"Error fetching channel uploads playlist: {e}")
            return None

    def fetch_api_videos(self) -> List[Dict[str, Any]]:
        """Fetch recent videos using YouTube Data API."""
        print("Fetching videos from YouTube Data API...")
        uploads_playlist = self.fetch_channel_uploads_playlist()
        if not uploads_playlist:
            return []

        playlist_items = []
        page_token = None
        pages_fetched = 0

        while True:
            params = {
                "part": "snippet,contentDetails",
                "playlistId": uploads_playlist,
                "maxResults": 50,
                "key": self.api_key,
            }
            if page_token:
                params["pageToken"] = page_token

            try:
                response = requests.get(
                    "https://www.googleapis.com/youtube/v3/playlistItems",
                    params=params,
                    timeout=30,
                )
                response.raise_for_status()
                data = response.json()
                items = data.get("items", [])
                playlist_items.extend(items)
                page_token = data.get("nextPageToken")
                pages_fetched += 1
                if not page_token or pages_fetched >= self.max_pages:
                    break
            except Exception as e:
                print(f"Error fetching playlist items: {e}")
                break

        if not playlist_items:
            return []

        video_ids = [item["contentDetails"]["videoId"] for item in playlist_items]

        videos = []
        for i in range(0, len(video_ids), 50):
            chunk = video_ids[i:i + 50]
            params = {
                "part": "snippet,contentDetails,status",
                "id": ",".join(chunk),
                "key": self.api_key,
            }
            try:
                response = requests.get(
                    "https://www.googleapis.com/youtube/v3/videos",
                    params=params,
                    timeout=30,
                )
                response.raise_for_status()
                data = response.json()
                videos.extend(data.get("items", []))
            except Exception as e:
                print(f"Error fetching video details: {e}")

        extracted = []
        for item in videos:
            snippet = item.get("snippet", {})
            content = item.get("contentDetails", {})
            status = item.get("status", {})

            video_id = item.get("id")
            if not video_id:
                continue

            title = snippet.get("title", "").strip()
            published_at = snippet.get("publishedAt", "")
            duration = self.format_duration(content.get("duration", ""))
            embeddable = status.get("embeddable", True)

            if not title or not published_at:
                continue

            extracted.append(
                {
                    "title": title,
                    "url": f"https://www.youtube.com/watch?v={video_id}",
                    "published_at": published_at,
                    "duration": duration,
                    "embeddable": embeddable,
                }
            )

        extracted.sort(
            key=lambda v: datetime.fromisoformat(
                v["published_at"].replace("Z", "+00:00")
            ),
            reverse=True,
        )
        return extracted

    def format_duration(self, iso_duration: str) -> str:
        """Convert ISO 8601 duration to H:MM:SS or M:SS."""
        if not iso_duration:
            return ""

        match = re.match(
            r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$",
            iso_duration,
        )
        if not match:
            return ""

        hours = int(match.group(1) or 0)
        minutes = int(match.group(2) or 0)
        seconds = int(match.group(3) or 0)

        if hours > 0:
            return f"{hours}:{minutes:02d}:{seconds:02d}"
        return f"{minutes}:{seconds:02d}"
    
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
            if "embeddable" not in video:
                video["embeddable"] = True
        
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
        api_videos = self.fetch_api_videos()
        if not api_videos:
            print("No videos found via YouTube API")
            return
        
        print(f"Fetched {len(api_videos)} videos from API")
        
        # Load existing data
        existing_videos = self.load_existing_videos()
        episodes = self.load_season_episodes()
        
        print(f"Loaded {len(existing_videos)} existing videos")
        print(f"Loaded episodes from {len(episodes)} season files")
        
        # Merge videos
        merged_videos = self.merge_videos(existing_videos, api_videos)
        
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
