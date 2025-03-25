package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"

	"log"
	"os"
	"path/filepath"
	"strings"
)

type Type int

type SocialPost struct {
	ID            string        `json:"id"`
	SType         Type          `json:"stype"`
	PublishedOn   string        `json:"PublishedOn"`
	BlueSkyPost   BlueSkyPost   `json:"BlueSkyPost"`
	InstagramPost InstagramPost `json:"InstagramPost"`
}

type BlueSkyPost struct {
	BskyURI        string `json:"BskyURI"`
	BskyCID        string `json:"BskyCID"`
	Description    string `json:"Description"`
	BskyProfileURI string `json:"BskyProfileURI"`
	BskyProfile    string `json:"BskyProfile"`
	BskyPost       string `json:"BskyPost"`
}

type InstagramPost struct {
	URL         string `json:"URL"`
	Description string `json:"Description"`
	SvgPath     string `json:"SvgPath"`
}

const (
	BlueSky Type = iota
	Instagram
)

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

	mdContent := `---
cascade:
  target:
    kind: page
    path: '{/redes-sociales/**}'
title: Redes Sociales
---
`
	for _, post := range outputContent {
		if post.SType == BlueSky {
			var tmplFile = "bsky_embed.txt"
			mdContent += processTemplate(tmplFile, post)
		} else if post.SType == Instagram {
			var tmplFile = "ig_embed.txt"
			mdContent += processTemplate(tmplFile, post.InstagramPost)
		}
	}

	mdContent += "<script async src=\"https://embed.bsky.app/static/embed.js\" charset=\"utf-8\"></script>"
	mdContent += "<script async src=\"//www.instagram.com/embed.js\"></script>"

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

func processTemplate(tmplFile string, post interface{}) string {
	tmpl, err := template.New(tmplFile).ParseFiles(tmplFile)
	if err != nil {
		fmt.Printf("Error parsing template %s: %s\n", tmplFile, err)
	}

	var tpl bytes.Buffer
	err = tmpl.Execute(&tpl, post)
	if err != nil {
		fmt.Printf("Error executing template %s: %s\n", tmplFile, err)
	}

	return tpl.String() + "\n"
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
