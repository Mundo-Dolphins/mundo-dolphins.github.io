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

type Video struct {
	Title       string `json:"title"`
	Duration    string `json:"duration"`
	URL         string `json:"url"`
	PublishedAt string `json:"published_at"`
	IsPodcast   bool   `json:"isPodcast"`
	Embeddable  *bool  `json:"embeddable"`
}

const (
	mdFormat = `---
title: "%s"
description: "%s"
date: %s
draft: %v
slug: %s
length: %s
videoId: "%s"
embeddable: %v
categories:
  - "Videos"
showDate: true
---

%s
<!--more-->
%s
`
	descriptionLength = 120
)

func main() {
	dataFile := "../../data/videos.json"
	outputDir := "../../content/videos"

	if err := os.MkdirAll(outputDir, os.ModePerm); err != nil {
		log.Fatalf("Error generating directory: %v", err)
	}

	data, err := os.ReadFile(dataFile)
	if err != nil {
		log.Fatalf("Error reading JSON file: %v", err)
	}

	var videos []Video
	if err := json.Unmarshal(data, &videos); err != nil {
		log.Fatalf("Error parsing JSON file: %v", err)
	}

	for _, video := range videos {
		if video.IsPodcast {
			continue
		}

		parse, err := time.Parse(time.RFC3339, video.PublishedAt)
		if err != nil {
			fmt.Printf("Skipping video with invalid published_at (%s): %v\n", video.PublishedAt, err)
			continue
		}

		videoID, err := extractYouTubeID(video.URL)
		if err != nil {
			fmt.Printf("Skipping video with invalid URL (%s): %v\n", video.URL, err)
			continue
		}

		filename := filepath.Join(outputDir, fmt.Sprintf("%d.md", parse.Unix()))
		cleanTitle := strings.ReplaceAll(video.Title, "\"", "'")
		desc := cleanTitle
		if len(desc) > descriptionLength {
			desc = desc[:descriptionLength]
		}

		embeddable := true
		if video.Embeddable != nil {
			embeddable = *video.Embeddable
		}

		videoBlock := fmt.Sprintf("{{< youtube %s >}}\n", videoID)
		if !embeddable {
			videoBlock = fmt.Sprintf("{{< video-fallback id=\"%s\" title=\"%s\" >}}\n", videoID, cleanTitle)
		}

		mdContent := fmt.Sprintf(
			mdFormat,
			cleanTitle,
			desc,
			parse.Format(time.RFC3339),
			false,
			slug.Make(video.Title),
			video.Duration,
			videoID,
			embeddable,
			cleanTitle,
			videoBlock,
		)

		if err := os.WriteFile(filename, []byte(mdContent), 0644); err != nil {
			fmt.Printf("Error writing Markdown: %v\n", err)
		} else {
			fmt.Println("File generated:", filename)
		}
	}

	fmt.Println("Finished.")
}

func extractYouTubeID(youtubeURL string) (string, error) {
	re := regexp.MustCompile(`(?:youtube\.com/watch\?v=|youtube\.com/.*[?&]v=|youtu\.be/|youtube\.com/embed/)([^&?\s"'<]+)`)
	matches := re.FindStringSubmatch(youtubeURL)
	if len(matches) < 2 {
		return "", fmt.Errorf("no YouTube video ID found in URL: %s", youtubeURL)
	}
	return matches[1], nil
}
