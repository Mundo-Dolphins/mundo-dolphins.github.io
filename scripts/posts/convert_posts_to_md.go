package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

type SocialPost struct {
	BskyURI        string `json:"BskyURI"`
	BskyCID        string `json:"BskyCID"`
	Description    string `json:"Description"`
	BskyProfileURI string `json:"BskyProfileURI"`
	BskyProfile    string `json:"BskyProfile"`
	BskyPost       string `json:"BskyPost"`
	PublishedOn    string `json:"PublishedOn"`
}

func processPosts(input []byte) []SocialPost {
	var inputPosts []SocialPost
	err := json.Unmarshal(input, &inputPosts)
	if err != nil {
		log.Fatalf("Error unmarshalling input JSON: %v", err)
	}

	return inputPosts
}

func processFile(filePath string) {
	// Read the JSON file
	fileContent, err := os.ReadFile(filePath)
	if err != nil {
		fmt.Printf("Error reading file %s: %s\n", filePath, err)
		return
	}

	// Process the posts
	outputContent := processPosts(fileContent)

	// Create output file name
	outputFileName := strings.Replace(filepath.Base(filePath), ".json", ".html", 1)

	mdContentTemplate := `
<blockquote class="bluesky-embed" data-bluesky-uri="%s" data-bluesky-cid="%s">
   <p lang="es">%s</p>
   &mdash; <a href="%s">%s</a> <a href="%s">%s</a>
</blockquote>
`
	mdContent := `---
cascade:
  target:
    kind: page
    path: '{/redes-sociales/**}'
title: Redes Sociales
---
`
	for _, post := range outputContent {
		mdContent += fmt.Sprintf(
			mdContentTemplate,
			post.BskyURI,
			post.BskyCID,
			post.Description,
			post.BskyProfileURI,
			post.BskyProfile,
			post.BskyPost,
			post.PublishedOn,
		)
	}

	mdContent += "<script async src=\"https://embed.bsky.app/static/embed.js\" charset=\"utf-8\"></script>"

	outputDir := "../../content/social/"
	// Write the output JSON to the new file
	if err := os.MkdirAll(outputDir, os.ModePerm); err != nil {
		fmt.Println("Error generating directory:", err)
		return
	}

	err = os.WriteFile(outputDir+outputFileName, []byte(mdContent), 0644)
	if err != nil {
		fmt.Printf("Error writing file %s: %s\n", outputFileName, err)
		return
	}

	fmt.Printf("Processed file %s and wrote output to %s\n", filePath, outputFileName)
}

func main() {
	err := filepath.Walk("../../data", func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasPrefix(info.Name(), "posts_") && strings.HasSuffix(info.Name(), ".json") {
			processFile(path)
		}
		return nil
	})
	if err != nil {
		fmt.Printf("Error walking through files: %s\n", err)
	}
}
