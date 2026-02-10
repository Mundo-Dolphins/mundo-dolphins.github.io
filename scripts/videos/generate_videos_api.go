package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const (
	srcFile   = "../../data/videos.json"
	dstDir    = "../../static/api"
	dstFile   = "videos.json"
	limitLatest = 50
)

type Video struct {
	Duration    string `json:"duration"`
	IsPodcast   bool   `json:"isPodcast"`
	PublishedAt string `json:"published_at"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	Embeddable  bool   `json:"embeddable"`
}

type VideosAPI struct {
	Videos      []Video `json:"videos"`
	TotalCount  int     `json:"totalCount"`
	LastUpdated string  `json:"lastUpdated"`
}

func main() {
	// Create output directory if it doesn't exist
	if err := os.MkdirAll(dstDir, os.ModePerm); err != nil {
		fmt.Printf("Error creating output directory: %v\n", err)
		return
	}

	// Read source videos.json file
	data, err := os.ReadFile(srcFile)
	if err != nil {
		fmt.Printf("Error reading source file: %v\n", err)
		return
	}

	var videos []Video
	if err := json.Unmarshal(data, &videos); err != nil {
		fmt.Printf("Error parsing JSON: %v\n", err)
		return
	}

	// Sort videos by published date (descending - most recent first)
	sort.Slice(videos, func(i, j int) bool {
		dateI, _ := time.Parse(time.RFC3339, videos[i].PublishedAt)
		dateJ, _ := time.Parse(time.RFC3339, videos[j].PublishedAt)
		return dateI.After(dateJ)
	})

	// Create API response with metadata
	apiResponse := VideosAPI{
		Videos:      videos,
		TotalCount:  len(videos),
		LastUpdated: time.Now().UTC().Format(time.RFC3339),
	}

	// Write main videos API file
	if err := writeJSONFile(filepath.Join(dstDir, dstFile), apiResponse); err != nil {
		fmt.Printf("Error writing main API file: %v\n", err)
		return
	}
	fmt.Printf("✅ Generated: %s (total: %d videos)\n", dstFile, len(videos))

	// Generate additional filtered endpoints
	if err := generateFilteredEndpoints(videos); err != nil {
		fmt.Printf("Error generating filtered endpoints: %v\n", err)
		return
	}

	fmt.Println("✅ All video API endpoints generated successfully")
}

func generateFilteredEndpoints(videos []Video) error {
	// Latest videos
	latestCount := limitLatest
	if len(videos) < latestCount {
		latestCount = len(videos)
	}
	latestVideos := VideosAPI{
		Videos:      videos[:latestCount],
		TotalCount:  latestCount,
		LastUpdated: time.Now().UTC().Format(time.RFC3339),
	}
	if err := writeJSONFile(filepath.Join(dstDir, "videos-latest.json"), latestVideos); err != nil {
		return err
	}
	fmt.Printf("✅ Generated: videos-latest.json (latest %d videos)\n", latestCount)

	// Podcast videos only
	var podcastVideos []Video
	for _, video := range videos {
		if video.IsPodcast {
			podcastVideos = append(podcastVideos, video)
		}
	}
	podcastAPI := VideosAPI{
		Videos:      podcastVideos,
		TotalCount:  len(podcastVideos),
		LastUpdated: time.Now().UTC().Format(time.RFC3339),
	}
	if err := writeJSONFile(filepath.Join(dstDir, "videos-podcasts.json"), podcastAPI); err != nil {
		return err
	}
	fmt.Printf("✅ Generated: videos-podcasts.json (total: %d podcast videos)\n", len(podcastVideos))

	// Non-podcast videos only
	var regularVideos []Video
	for _, video := range videos {
		if !video.IsPodcast {
			regularVideos = append(regularVideos, video)
		}
	}
	regularAPI := VideosAPI{
		Videos:      regularVideos,
		TotalCount:  len(regularVideos),
		LastUpdated: time.Now().UTC().Format(time.RFC3339),
	}
	if err := writeJSONFile(filepath.Join(dstDir, "videos-regular.json"), regularAPI); err != nil {
		return err
	}
	fmt.Printf("✅ Generated: videos-regular.json (total: %d regular videos)\n", len(regularVideos))

	// Embeddable videos only
	var embeddableVideos []Video
	for _, video := range videos {
		if video.Embeddable {
			embeddableVideos = append(embeddableVideos, video)
		}
	}
	embeddableAPI := VideosAPI{
		Videos:      embeddableVideos,
		TotalCount:  len(embeddableVideos),
		LastUpdated: time.Now().UTC().Format(time.RFC3339),
	}
	if err := writeJSONFile(filepath.Join(dstDir, "videos-embeddable.json"), embeddableAPI); err != nil {
		return err
	}
	fmt.Printf("✅ Generated: videos-embeddable.json (total: %d embeddable videos)\n", len(embeddableVideos))

	return nil
}

func writeJSONFile(filePath string, data interface{}) error {
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("error marshalling JSON: %w", err)
	}

	if err := os.WriteFile(filePath, jsonData, 0644); err != nil {
		return fmt.Errorf("error writing file: %w", err)
	}

	return nil
}

func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, srcFile)
	return err
}
