package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	dataDir = "../../data"
	dstDir  = "../../static/api"
)

type InstagramPost struct {
	URL         string `json:"URL"`
	Description string `json:"Description"`
	SvgPath     string `json:"SvgPath"`
}

type BlueSkyPost struct {
	BskyURI        string `json:"BskyURI"`
	BskyCID        string `json:"BskyCID"`
	Description    string `json:"Description"`
	BskyProfileURI string `json:"BskyProfileURI"`
	BskyProfile    string `json:"BskyProfile"`
	BskyPost       string `json:"BskyPost"`
}

type SocialPost struct {
	ID            string        `json:"id"`
	SType         int           `json:"stype"`
	PublishedOn   string        `json:"PublishedOn"`
	BlueSkyPost   BlueSkyPost   `json:"BlueSkyPost"`
	InstagramPost InstagramPost `json:"InstagramPost"`
}

func main() {
	// Crear el directorio de destino si no existe
	if err := os.MkdirAll(dstDir, os.ModePerm); err != nil {
		fmt.Println("Error creating directory:", err)
		return
	}

	// Leer posts_1.json
	posts1, err := readPostsFile(filepath.Join(dataDir, "posts_1.json"))
	if err != nil {
		fmt.Println("Error reading posts_1.json:", err)
		return
	}

	// Leer posts_2.json
	posts2, err := readPostsFile(filepath.Join(dataDir, "posts_2.json"))
	if err != nil {
		fmt.Println("Error reading posts_2.json:", err)
		return
	}

	// Combinar todos los posts
	allPosts := append(posts1, posts2...)

	// Generar el archivo social.json
	outputData, err := json.MarshalIndent(allPosts, "", "  ")
	if err != nil {
		fmt.Println("Error marshalling JSON:", err)
		return
	}

	outputPath := filepath.Join(dstDir, "social.json")
	err = os.WriteFile(outputPath, outputData, 0644)
	if err != nil {
		fmt.Println("Error writing JSON file:", err)
		return
	}

	fmt.Printf("✅ JSON file generated: social.json (%d posts)\n", len(allPosts))
}

func readPostsFile(filePath string) ([]SocialPost, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var posts []SocialPost
	if err := json.Unmarshal(data, &posts); err != nil {
		return nil, err
	}

	fmt.Printf("📖 Read %d posts from %s\n", len(posts), filepath.Base(filePath))
	return posts, nil
}
