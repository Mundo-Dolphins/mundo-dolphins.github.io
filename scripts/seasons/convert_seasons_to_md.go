package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gosimple/slug"
)

type PodcastEpisode struct {
	DateAndTime string       `json:"dateAndTime"`
	Description string       `json:"description"`
	Audio       string       `json:"audio"`
	ImgMain     string       `json:"imgMain"`
	ImgMini     string       `json:"imgMini"`
	Len         string       `json:"len"`
	Link        string       `json:"link"`
	Title       string       `json:"title"`
	Video       VideoEntries `json:"video"`
}

type VideoEntry struct {
	Title       string `json:"title"`
	Duration    string `json:"duration"`
	URL         string `json:"url"`
	PublishedAt string `json:"published_at"`
}

type VideoEntries []VideoEntry

func (v *VideoEntries) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "null" {
		*v = nil
		return nil
	}

	// Try array first
	var arr []VideoEntry
	if err := json.Unmarshal(data, &arr); err == nil {
		*v = arr
		return nil
	}

	// Fallback to single object
	var single VideoEntry
	if err := json.Unmarshal(data, &single); err == nil {
		*v = []VideoEntry{single}
		return nil
	}

	return fmt.Errorf("invalid video field format")
}

const (
	mdFormat = `---
title: "%s"
description: "%s"
date: %s
draft: %v
slug: %s
length: %s
categories:
  - %s
showDate: true
---

%s

<!--more-->
%s
{{< iframe %s >}}
[Escuchar en Ivoox](%s)
`
	descriptionLength = 100
)

func main() {
	dir := "../../data"
	pattern := "season_*.json"
	re := regexp.MustCompile(`season_(\d+)\.json`)

	files, err := filepath.Glob(filepath.Join(dir, pattern))
	if err != nil {
		log.Fatalf("Error trying to find files: %v", err)
	}

	if len(files) == 0 {
		fmt.Println("No files found.")
		return
	}

	for _, file := range files {
		outputDir := "../../content/podcast"

		if err := os.MkdirAll(outputDir, os.ModePerm); err != nil {
			fmt.Println("Error generating directory:", err)
			return
		}

		data, err := os.ReadFile(file)
		if err != nil {
			fmt.Println("Error reading JSON file:", err)
			return
		}

		var posts []PodcastEpisode
		if err := json.Unmarshal(data, &posts); err != nil {
			fmt.Println("Error parsing JSON file:", err)
			return
		}

		for _, post := range posts {
			parse, _ := time.Parse(time.RFC3339, post.DateAndTime)
			filename := fmt.Sprintf("%s/%d.md", outputDir, parse.Unix())
			match := re.FindStringSubmatch(file)
			id, _ := extractId(post.Link)
			videoShortcode := generateVideoShortcode(post.Video)

			mdContent := fmt.Sprintf(
				mdFormat,
				strings.ReplaceAll(post.Title, "\"", "'"),
				fmt.Sprintf("%s...", strings.ReplaceAll(post.Description, "\"", "'")[:descriptionLength]),
				parse.Format(time.RFC3339),
				false,
				slug.Make(post.Title),
				post.Len,
				fmt.Sprintf("\"Temporada %s\"", match[1]),
				post.Description,
				videoShortcode,
				id,
				post.Link,
			)

			if err := os.WriteFile(filename, []byte(mdContent), 0644); err != nil {
				fmt.Println("Error writting Markdown:", err)
			} else {
				fmt.Println("File generated:", filename)
			}
		}
	}

	fmt.Println("Finished.")
}

func extractId(url string) (string, error) {
	re := regexp.MustCompile(`_rf_(\d+)_`)
	matches := re.FindStringSubmatch(url)
	if len(matches) < 2 {
		return "", fmt.Errorf("no fragment found in URL")
	}
	return matches[1], nil
}

func extractYouTubeID(youtubeURL string) (string, error) {
	// Extract YouTube video ID from various URL formats
	// Formats: https://www.youtube.com/watch?v=VIDEO_ID or v=VIDEO_ID&...
	re := regexp.MustCompile(`(?:youtube\.com/watch\?v=|youtube\.com/.*[?&]v=|youtu\.be/|youtube\.com/embed/)([^&?\s"'<]+)`)
	matches := re.FindStringSubmatch(youtubeURL)
	if len(matches) < 2 {
		return "", fmt.Errorf("no YouTube video ID found in URL: %s", youtubeURL)
	}
	return matches[1], nil
}

func generateVideoShortcode(videos []VideoEntry) string {
	if len(videos) == 0 {
		return ""
	}

	video := videos[0] // Use first video if multiple exist
	videoID, err := extractYouTubeID(video.URL)
	if err != nil {
		fmt.Printf("Warning: Could not extract YouTube ID from %s: %v\n", video.URL, err)
		return ""
	}

	return fmt.Sprintf("{{< youtube %s >}}\n\n", videoID)
}
