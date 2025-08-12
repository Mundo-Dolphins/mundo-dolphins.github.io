package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"time"
)

type TeamInfo struct {
	Record                string              `json:"record"`
	Coach                 string              `json:"coach"`
	PointsFor             string              `json:"points_for"`
	PointsAgainst         string              `json:"points_against"`
	Stadium               string              `json:"stadium"`
	FounderPrincipalOwner string              `json:"founder_principal_owner"`
	President             string              `json:"president"`
	Owner                 string              `json:"owner"`
	Chairman              string              `json:"chairman"`
	GeneralManager        string              `json:"general_manager"`
	TrainingCamp          string              `json:"training_camp"`
	Division              string              `json:"division"`
	Position              string              `json:"position"`
	SeasonGames           []map[string]string `json:"season_games"`
}

func main() {
	// Directorios
	historicalDataDir := "../../data/historical"
	logosDir := "../../assets/logos"
	outputDir := "../../content/historia"

	// Crear la carpeta de salida si no existe
	if err := os.MkdirAll(outputDir, os.ModePerm); err != nil {
		log.Fatalf("Error creando el directorio de salida: %v", err)
	}

	// Obtener los logos y mapearlos por rango de años
	logoMap := getLogoMap(logosDir)

	// Leer los archivos JSON de la carpeta histórica
	files, err := os.ReadDir(historicalDataDir)
	if err != nil {
		log.Fatalf("Error al leer la carpeta de datos históricos: %v", err)
	}

	// Lista para almacenar los años procesados
	var years []string

	for _, file := range files {
		if filepath.Ext(file.Name()) == ".json" {
			year := extractYearFromFilename(file.Name())
			if year == "" {
				log.Printf("No se pudo extraer el año del archivo: %s\n", file.Name())
				continue
			}

			// Leer el contenido del archivo JSON
			filePath := filepath.Join(historicalDataDir, file.Name())
			content, err := os.ReadFile(filePath)
			if err != nil {
				log.Printf("Error al leer el archivo %s: %v\n", filePath, err)
				continue
			}

			// Parsear el JSON
			var teamInfo TeamInfo
			if err := json.Unmarshal(content, &teamInfo); err != nil {
				log.Printf("Error al parsear el archivo %s: %v\n", filePath, err)
				continue
			}

			// Reemplazar " and " por " y " en el campo Head Coach
			teamInfo.Coach = replaceAndWithY(teamInfo.Coach)

			// Obtener el logo correspondiente al año
			logo := getLogoForYear(logoMap, year)

			// Generar el contenido de la página
			pageContent := generatePageContent(year, teamInfo, logo)

			// Guardar el archivo Markdown
			outputFile := filepath.Join(outputDir, fmt.Sprintf("%s.md", year))
			if err := os.WriteFile(outputFile, []byte(pageContent), 0644); err != nil {
				log.Printf("Error al escribir el archivo %s: %v\n", outputFile, err)
				continue
			}

			fmt.Printf("Página generada exitosamente: %s\n", outputFile)

			// Agregar el año a la lista
			years = append(years, year)
		}
	}

	// Generar el archivo _index.md
	generateIndexPage(outputDir, years)
}

func extractYearFromFilename(filename string) string {
	re := regexp.MustCompile(`team_info_(\d{4})\.json`)
	matches := re.FindStringSubmatch(filename)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

func getLogoMap(logosDir string) map[string]string {
	logoMap := make(map[string]string)
	files, err := os.ReadDir(logosDir)
	if err != nil {
		log.Fatalf("Error al leer la carpeta de logos: %v", err)
	}

	// Expresión regular para capturar el rango de años en el nombre del archivo
	re := regexp.MustCompile(`(\d{4})_(\d{4})`)
	for _, file := range files {
		if filepath.Ext(file.Name()) == ".png" {
			matches := re.FindStringSubmatch(file.Name())
			if len(matches) == 3 {
				startYear, _ := strconv.Atoi(matches[1])
				endYear, _ := strconv.Atoi(matches[2])
				for year := startYear; year <= endYear; year++ {
					yearStr := fmt.Sprintf("%d", year)
					logoMap[yearStr] = file.Name()                                // Asociar el año al nombre del archivo
					fmt.Printf("Logo asignado: %s -> %s\n", yearStr, file.Name()) // Depuración
				}
			} else {
				fmt.Printf("No se encontró un rango de años en el archivo: %s\n", file.Name())
			}
		}
	}
	return logoMap
}

func getLogoForYear(logoMap map[string]string, year string) string {
	if logo, exists := logoMap[year]; exists {
		return logo
	}
	return ""
}

func formatPointsField(pointsField string) string {
	// Expresión regular para extraer los valores
	re := regexp.MustCompile(`(\d+)\s+\(([\d\.]+/g)\)\s+(\d+)[a-z]{2}\s+of\s+(\d+)`)
	matches := re.FindStringSubmatch(pointsField)

	if len(matches) == 5 {
		points := matches[1]     // Ejemplo: "297"
		rank := matches[3]       // Ejemplo: "11"
		totalTeams := matches[4] // Ejemplo: "26"
		return fmt.Sprintf("%s puntos. %sº de %s equipos", points, rank, totalTeams)
	}

	// Si no coincide con el formato esperado, devolver el campo original
	return pointsField
}

func generateGamesContent(games []map[string]string) string {
	if len(games) == 0 {
		return ""
	}

	content := ""

	for _, game := range games {
		// Determinar el orden de los equipos según el campo "game_location"
		var header string
		if game["game_location"] == "@" {
			header = fmt.Sprintf("### Miami Dolphins vs %s", game["opp_name"])
		} else {
			header = fmt.Sprintf("### %s vs Miami Dolphins", game["opp_name"])
		 }

		// Convertir la fecha al formato de España
		date := formatDateToSpanish(game["date"])

		// Obtener el resultado
		result := fmt.Sprintf("Resultado: %s - %s", game["points"], game["points_opp"])

		// Crear los grupos de estadísticas
		offensiveStats := ""
		specialTeamsStats := ""

		// Ofensiva
		if value, ok := game["time_of_poss"]; ok {
			offensiveStats += fmt.Sprintf("- **Tiempo de posesión**: %s\n", value)
		}
		if value, ok := game["first_down"]; ok {
			offensiveStats += fmt.Sprintf("- **Primeros Downs**: %s\n", value)
		}
		if value, ok := game["third_down_att"]; ok {
			offensiveStats += fmt.Sprintf("- **Terceros Downs**: %s/%s\n", game["third_down_success"], value)
		}
		if value, ok := game["fourth_down_att"]; ok {
			offensiveStats += fmt.Sprintf("- **Cuartos Downs**: %s/%s\n", game["fourth_down_success"], value)
		}
		if value, ok := game["pass_att"]; ok {
			offensiveStats += fmt.Sprintf("- **Pases**: %s/%s (%s%%)\n", game["pass_cmp"], value, game["pass_cmp_pct"])
		}
		if value, ok := game["pass_yds"]; ok {
			offensiveStats += fmt.Sprintf("- **Yardas de pase**: %s (%s por intento)\n", value, game["pass_yds_per_att"])
		}
		if value, ok := game["rush_att"]; ok {
			offensiveStats += fmt.Sprintf("- **Carreras**: %s\n", value)
		}
		if value, ok := game["rush_yds"]; ok {
			offensiveStats += fmt.Sprintf("- **Yardas de carrera**: %s (%s por intento)\n", value, game["rush_yds_per_att"])
		}
		if value, ok := game["tot_yds"]; ok {
			offensiveStats += fmt.Sprintf("- **Yardas totales**: %s\n", value)
		}
		if value, ok := game["penalties"]; ok {
			offensiveStats += fmt.Sprintf("- **Penaltis**: %s (%s yardas)\n", value, game["penalties_yds"])
		}

		// Equipos Especiales
		if value, ok := game["fga"]; ok {
			specialTeamsStats += fmt.Sprintf("- **Field Goals**: %s/%s\n", game["fgm"], value)
		}
		if value, ok := game["xpa"]; ok {
			specialTeamsStats += fmt.Sprintf("- **Extra Points**: %s/%s\n", game["xpm"], value)
		}
		if value, ok := game["punt"]; ok {
			specialTeamsStats += fmt.Sprintf("- **Punts**: %s (%s yardas)\n", value, game["punt_yds"])
		}

		// Crear el bloque de estadísticas
		stats := ""
		if offensiveStats != "" {
			stats += "**Ofensiva:**\n" + offensiveStats + "\n"
		}
		if specialTeamsStats != "" {
			stats += "**Equipos Especiales:**\n" + specialTeamsStats + "\n"
		}

		// Agregar el bloque al contenido con detalles en Markdown
		content += fmt.Sprintf(`%s

**Fecha**: %s

%s

{{< details >}}
%s
{{< /details >}}

`, header, date, result, stats)
	}

	return content
}

func formatDateToSpanish(date string) string {
	// Parsear la fecha en formato YYYY-MM-DD
	parsedDate, err := time.Parse("2006-01-02", date)
	if err != nil {
		log.Printf("Error al parsear la fecha: %s\n", date)
		return date // Devolver la fecha original si hay un error
	}

	// Formatear la fecha al formato DD-MM-YYYY
	return parsedDate.Format("02-01-2006")
}

func generatePageContent(year string, teamInfo TeamInfo, logo string) string {
	// Formatear los campos points_for y points_against
	pointsForFormatted := formatPointsField(teamInfo.PointsFor)
	pointsAgainstFormatted := formatPointsField(teamInfo.PointsAgainst)

	// Determinar el campo adecuado para Fundador/Propietario/Presidente
	var leadershipFieldName, leadershipFieldValue string
	if teamInfo.FounderPrincipalOwner != "" {
		leadershipFieldName = "Fundador/Propietario"
		leadershipFieldValue = teamInfo.FounderPrincipalOwner
	} else if teamInfo.President != "" {
		leadershipFieldName = "Presidente"
		leadershipFieldValue = teamInfo.President
	} else if teamInfo.Owner != "" {
		leadershipFieldName = "Propietario"
		leadershipFieldValue = teamInfo.Owner
	} else if teamInfo.Chairman != "" {
		leadershipFieldName = "Presidente"
		leadershipFieldValue = teamInfo.Chairman
	}

	// Crear la tabla con los datos del equipo
	table := "|                      |                      |\n"
	table += "|-------------------------|---------------------------|\n"
	table += fmt.Sprintf("| Division               | %s                       |\n", teamInfo.Division)
	table += fmt.Sprintf("| Record                 | %s                       |\n", teamInfo.Record)
	table += fmt.Sprintf("| Posición               | %s                       |\n", teamInfo.Position)
	table += fmt.Sprintf("| Puntos a favor          | %s                       |\n", pointsForFormatted)
	table += fmt.Sprintf("| Puntos en contra       | %s                       |\n", pointsAgainstFormatted)
	table += fmt.Sprintf("| Head Coach             | %s                       |\n", teamInfo.Coach)
	table += fmt.Sprintf("| General Manager        | %s                       |\n", teamInfo.GeneralManager)
	table += fmt.Sprintf("| Estadio                | %s                       |\n", teamInfo.Stadium)
	table += fmt.Sprintf("| Training Camp          | %s                       |\n", teamInfo.TrainingCamp)

	// Agregar el campo de liderazgo si existe
	if leadershipFieldName != "" && leadershipFieldValue != "" {
		table += fmt.Sprintf("| %s               | %s                       |\n", leadershipFieldName, leadershipFieldValue)
	}

	// Dividir los juegos en temporada regular y playoffs
	regularSeasonGames, playoffGames := splitGamesByType(teamInfo.SeasonGames)

	// Crear el contenido de los juegos
	regularGamesContent := generateGamesContent(regularSeasonGames)
	playoffGamesContent := generateGamesContent(playoffGames)

	// Generar el contenido del archivo Markdown
	content := fmt.Sprintf(`---
title: "Temporada %s"
date: %s-01-01
draft: false
logo: "logos/%s"
---

%s

## Partidos de la temporada regular

%s
`, year, year, logo, table, regularGamesContent)

	// Agregar la sección de playoffs solo si hay contenido
	if playoffGamesContent != "" {
		content += fmt.Sprintf(`
## Partidos de Playoffs

%s
`, playoffGamesContent)
	}

	content += "\n[Volver](/historia)\n"

	return content
}

func splitGamesByType(games []map[string]string) (regularGames, playoffGames []map[string]string) {
	for _, game := range games {
		if game["type"] == "Regular" {
			regularGames = append(regularGames, game)
		} else if game["type"] == "Playoff" {
			playoffGames = append(playoffGames, game)
		}
	}
	return
}

func generateIndexPage(outputDir string, years []string) {
	// Ordenar los años de más reciente a más antigua
	sort.Sort(sort.Reverse(sort.StringSlice(years)))

	// Generar el contenido del archivo _index.md
	content := `---
title: "Historia"
date: 2025-01-01
draft: false
---

# Historia de los Miami Dolphins

Listado de temporadas:
`

	for _, year := range years {
		content += fmt.Sprintf("- [Temporada %s](/historia/%s)\n", year, year)
	}

	// Guardar el archivo _index.md
	indexFile := filepath.Join(outputDir, "_index.md")
	if err := os.WriteFile(indexFile, []byte(content), 0644); err != nil {
		log.Fatalf("Error al escribir el archivo _index.md: %v", err)
	}

	fmt.Printf("Archivo _index.md generado exitosamente en: %s\n", indexFile)
}

func replaceAndWithY(input string) string {
	return regexp.MustCompile(`\band\b`).ReplaceAllString(input, "y")
}
