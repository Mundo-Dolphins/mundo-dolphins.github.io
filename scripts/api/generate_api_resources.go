package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
)

const (
	srcDir = "../../data"
	dstDir = "../../static/api"
)

func main() {
	files, err := os.ReadDir(srcDir)
	if err != nil {
		fmt.Println("Error reading directory:", err)
		return
	}

	if err := os.MkdirAll(dstDir, os.ModePerm); err != nil {
		fmt.Println("Error creating directory:", err)
		return
	}

	if err := cleanDirectory(dstDir); err != nil {
		fmt.Println("Error cleaning directory:", err)
		return
	}

	var seasonFiles []string
	re := regexp.MustCompile(`^season_(\d+)\.json$`)

	for _, file := range files {
		if !file.IsDir() && re.MatchString(file.Name()) {
			seasonFiles = append(seasonFiles, file.Name())
		}
	}

	sort.Slice(seasonFiles, func(i, j int) bool {
		numI, _ := strconv.Atoi(re.FindStringSubmatch(seasonFiles[i])[1])
		numJ, _ := strconv.Atoi(re.FindStringSubmatch(seasonFiles[j])[1])
		return numI > numJ
	})

	outputFile := "seasons.json"
	outputData, err := json.MarshalIndent(seasonFiles, "", "  ")
	if err != nil {
		fmt.Println("Error marshalling JSON:", err)
		return
	}

	err = os.WriteFile(filepath.Join(dstDir, outputFile), outputData, 0644)
	if err != nil {
		fmt.Println("Error writing JSON file:", err)
		return
	}

	fmt.Println("JSON file generated:", outputFile)

	for _, fileName := range seasonFiles {
		if err := copyFiles(fileName); err != nil {
			continue
		}
	}
}

func cleanDirectory(dir string) error {
	files, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	for _, file := range files {
		err := os.RemoveAll(filepath.Join(dir, file.Name()))
		if err != nil {
			return err
		}
	}

	return nil
}

func copyFiles(fileName string) error {
	srcPath := filepath.Join(srcDir, fileName)
	dstPath := filepath.Join(dstDir, fileName)

	srcFile, err := os.Open(srcPath)
	if err != nil {
		fmt.Println("Error opening source file:", err)
		return err
	}
	defer func(srcFile *os.File) {
		err := srcFile.Close()
		if err != nil {
			fmt.Println("Error closing source file:", err)
		}
	}(srcFile)

	dstFile, err := os.Create(dstPath)
	if err != nil {
		fmt.Println("Error creating destination file:", err)
		return err
	}
	defer func(dstFile *os.File) {
		err := dstFile.Close()
		if err != nil {
			fmt.Println("Error closing destination file:", err)
		}
	}(dstFile)

	_, err = io.Copy(dstFile, srcFile)
	if err != nil {
		fmt.Println("Error copying file:", err)
		return err
	}

	fmt.Println("Copied file:", fileName)
	return nil
}
