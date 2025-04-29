package main

import (
	"encoding/json"
	"fmt"

	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Article struct {
	Title         string `json:"title"`
	Author        string `json:"author"`
	PublishedDate string `json:"publishedDate"`
	Content       string `json:"content"`
}

func main() {
	// Directorios
	inputDir := "../../content/noticias"
	outputDir := "../../static/api"
	outputFile := filepath.Join(outputDir, "articles.json")

	// Crear la carpeta de salida si no existe
	if err := os.MkdirAll(outputDir, os.ModePerm); err != nil {
		fmt.Printf("Error creando el directorio de salida: %v\n", err)
		return
	}

	// Leer todos los archivos .md en el directorio de entrada
	files, err := os.ReadDir(inputDir)
	if err != nil {
		fmt.Printf("Error leyendo el directorio de entrada: %v\n", err)
		return
	}

	var articles []Article

	for _, file := range files {
		if strings.HasSuffix(file.Name(), ".md") {
			filePath := filepath.Join(inputDir, file.Name())

			// Leer el contenido del archivo
			content, err := os.ReadFile(filePath)
			if err != nil {
				fmt.Printf("Error leyendo el archivo %s: %v\n", file.Name(), err)
				continue
			}

			// Extraer los metadatos y el contenido
			article, err := parseMarkdown(string(content))
			if err != nil {
				fmt.Printf("Error procesando el archivo %s: %v\n", file.Name(), err)
				continue
			}

			articles = append(articles, article)
		}
	}

	// Ordenar los artículos por PublishedDate en orden descendente
	sort.Slice(articles, func(i, j int) bool {
		dateI, _ := time.Parse(time.RFC3339, articles[i].PublishedDate)
		dateJ, _ := time.Parse(time.RFC3339, articles[j].PublishedDate)
		return dateI.After(dateJ)
	})

	// Escribir el archivo JSON
	jsonData, err := json.MarshalIndent(articles, "", "  ")
	if err != nil {
		fmt.Printf("Error serializando a JSON: %v\n", err)
		return
	}

	if err := os.WriteFile(outputFile, jsonData, 0644); err != nil {
		fmt.Printf("Error escribiendo el archivo JSON: %v\n", err)
		return
	}

	fmt.Printf("Archivo JSON generado exitosamente en %s\n", outputFile)
}

func parseMarkdown(content string) (Article, error) {
	var article Article

	lines := strings.Split(content, "\n")
	for i, line := range lines {
		line = strings.TrimSpace(line)

		// Extraer los metadatos del encabezado
		if strings.HasPrefix(line, "title:") {
			article.Title = strings.Trim(strings.TrimPrefix(line, "title:"), " '\"")
		} else if strings.HasPrefix(line, "author:") {
			article.Author = strings.Trim(strings.TrimPrefix(line, "author:"), " '\"")
		} else if strings.HasPrefix(line, "date:") {
			article.PublishedDate = strings.Trim(strings.TrimPrefix(line, "date:"), " '\"")
		}

		// Detectar el final del encabezado y capturar el contenido
		if line == "---" && i > 0 {
			article.Content = strings.Join(lines[i+1:], "\n")
			break
		}
	}

	// Reemplazar las referencias de YouTube en el contenido
	article.Content = replaceYouTubeLinks(article.Content)

	return article, nil
}

func replaceYouTubeLinks(content string) string {
	// Expresión regular para encontrar {{< youtube _h286TXIjVw >}}
	re := regexp.MustCompile(`{{< youtube ([^ >]+) >}}`)

	// Reemplazar con el formato de enlace de YouTube
	return re.ReplaceAllString(content, `https://www.youtube.com/watch?v=$1`)
}
