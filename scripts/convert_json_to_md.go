package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type PodcastEpisode struct {
	DateAndTime string `json:"dateAndTime"`
	Description string `json:"description"`
	Audio       string `json:"audio"`
	ImgMain     string `json:"imgMain"`
	ImgMini     string `json:"imgMini"`
	Len         string `json:"len"`
	Link        string `json:"link"`
	Title       string `json:"title"`
}

const (
	mdFormat = `---
title: "%s"
description: "%s"
date: %s
draft: %v
---

%s

[Escuchar](%s)
`
	descriptionLength = 100
)

func main() {
	dir := "../data"
	pattern := "season_*.json"

	files, err := filepath.Glob(filepath.Join(dir, pattern))
	if err != nil {
		log.Fatalf("Error trying to find files: %v", err)
	}

	if len(files) == 0 {
		fmt.Println("No files found.")
		return
	}

	for _, file := range files {
		outputDir := "../content/blog"

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

			mdContent := fmt.Sprintf(
				mdFormat,
				strings.ReplaceAll(post.Title, "\"", "'"),
				fmt.Sprintf("%s...", strings.ReplaceAll(post.Description, "\"", "'")[:descriptionLength]),
				post.DateAndTime,
				false,
				post.Description,
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
