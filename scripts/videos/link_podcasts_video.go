// link_podcast_videos.go
//
// Qué hace:
// - Lee videos.json (lista completa de vídeos del canal)
// - Lee season_*.json (cada uno es un array de episodios)
// - Respeta enlaces manuales existentes (si un episodio ya tiene `video`, NO lo modifica)
// - Para episodios sin `video`, intenta enlazar un vídeo libre usando:
//   - similitud de título (no exacta) +
//   - cercanía de fecha de publicación
//   - Si hay duda (score intermedio), pregunta de forma interactiva y te deja elegir candidato o saltar
//   - Genera:
//     out/videos.json (con isPodcast=false si no está enlazado)
//     out/season_X.json actualizados
//
// Requisitos:
//
//	go get golang.org/x/text@latest
//
// Uso típico:
//
//	go run link_podcast_videos.go -videos /mnt/data/videos.json -seasons "/mnt/data/season_*.json" -out ./out
//
// Flags útiles:
//
//	-auto 0.78     // umbral para enlazar automáticamente
//	-ask  0.58     // umbral para preguntar interactivamente
//	-days 5        // ventana de días para sumar puntos por cercanía de fecha
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

type Video struct {
	Title          string `json:"title"`
	PublishedAt    string `json:"published_at"` // YYYY-MM-DD (ideal) o vacío
	Duration       string `json:"duration,omitempty"`
	URL            string `json:"url"`
	IsPodcast      *bool  `json:"isPodcast,omitempty"`
	DurationSecond *int   `json:"duration_seconds,omitempty"`

	// Campos extra que existan se preservan
	Extra map[string]any `json:"-"`
}

func (v *Video) UnmarshalJSON(b []byte) error {
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	v.Extra = raw
	if s, _ := raw["title"].(string); s != "" {
		v.Title = s
	}
	if s, _ := raw["published_at"].(string); s != "" {
		v.PublishedAt = s
	}
	if s, _ := raw["duration"].(string); s != "" {
		v.Duration = s
	}
	if s, _ := raw["url"].(string); s != "" {
		v.URL = s
	}
	if b, ok := raw["isPodcast"].(bool); ok {
		v.IsPodcast = &b
	}
	if n, ok := raw["duration_seconds"].(float64); ok {
		i := int(n)
		v.DurationSecond = &i
	}
	return nil
}

func (v Video) MarshalJSON() ([]byte, error) {
	raw := map[string]any{}
	for k, val := range v.Extra {
		raw[k] = val
	}
	raw["title"] = v.Title
	raw["published_at"] = v.PublishedAt
	raw["duration"] = v.Duration
	raw["url"] = v.URL
	if v.DurationSecond != nil {
		raw["duration_seconds"] = *v.DurationSecond
	}
	if v.IsPodcast != nil {
		raw["isPodcast"] = *v.IsPodcast
	}
	return json.Marshal(raw)
}

type Episode struct {
	// No asumimos estructura fija: preservamos todo.
	Raw map[string]any
}

func (e *Episode) Title() string {
	if s, _ := e.Raw["title"].(string); s != "" {
		return s
	}
	return ""
}

func (e *Episode) DateStr() string {
	// Probar dateAndTime primero (formato RFC3339)
	if s, _ := e.Raw["dateAndTime"].(string); s != "" {
		return s
	}
	// muchos sistemas usan "date" en YYYY-MM-DD
	if s, _ := e.Raw["date"].(string); s != "" {
		return s
	}
	// fallback: published_at
	if s, _ := e.Raw["published_at"].(string); s != "" {
		return s
	}
	return ""
}

func (e *Episode) HasVideo() bool {
	v, ok := e.Raw["video"]
	if !ok || v == nil {
		return false
	}
	switch t := v.(type) {
	case map[string]any:
		// si hay url, consideramos enlazado
		if u, _ := t["url"].(string); strings.TrimSpace(u) != "" {
			return true
		}
		// si no hay url pero existe el objeto, lo respetamos igual
		return true
	case []any:
		// si es array, si hay alguno con url lo respetamos
		if len(t) > 0 {
			return true
		}
		return false
	default:
		return true
	}
}

func (e *Episode) ExistingVideoURLs() []string {
	v, ok := e.Raw["video"]
	if !ok || v == nil {
		return nil
	}
	var urls []string
	switch t := v.(type) {
	case map[string]any:
		if u, _ := t["url"].(string); strings.TrimSpace(u) != "" {
			urls = append(urls, strings.TrimSpace(u))
		}
	case []any:
		for _, it := range t {
			if m, ok := it.(map[string]any); ok {
				if u, _ := m["url"].(string); strings.TrimSpace(u) != "" {
					urls = append(urls, strings.TrimSpace(u))
				}
			}
		}
	}
	return urls
}

func (e *Episode) SetVideo(title, url string) {
	e.Raw["video"] = map[string]any{
		"title": title,
		"url":   url,
	}
}

type Candidate struct {
	Video     *Video
	Score     float64
	TitleSim  float64
	DateBonus float64
	DateDiff  int // days
}

func main() {
	var (
		videosPath  = flag.String("videos", "videos.json", "Ruta a videos.json")
		seasonsGlob = flag.String("seasons", "season_*.json", "Glob de seasons (p.ej. ./season_*.json)")
		outDir      = flag.String("out", "out", "Directorio de salida")
		autoThr     = flag.Float64("auto", 0.78, "Umbral para enlazar automáticamente")
		askThr      = flag.Float64("ask", 0.58, "Umbral para preguntar interactivamente")
		dateDays    = flag.Int("days", 5, "Ventana de días para dar bonus por fecha cercana")
		topN        = flag.Int("top", 6, "Top N candidatos a mostrar en modo interactivo")
		dryRun      = flag.Bool("dry", false, "No escribe ficheros, solo muestra decisiones")
	)
	flag.Parse()

	// 1) Cargar vídeos
	videos, err := loadVideos(*videosPath)
	if err != nil {
		fatal(err)
	}

	// 2) Cargar seasons
	seasonFiles, err := filepath.Glob(*seasonsGlob)
	if err != nil || len(seasonFiles) == 0 {
		fatal(fmt.Errorf("no encontré archivos con el patrón: %s", *seasonsGlob))
	}
	sort.Strings(seasonFiles)

	seasons := make(map[string][]Episode)
	for _, f := range seasonFiles {
		eps, err := loadEpisodes(f)
		if err != nil {
			fatal(fmt.Errorf("error leyendo %s: %w", f, err))
		}
		seasons[f] = eps
	}

	// 3) Construir set de URLs ya usadas (enlaces manuales)
	used := map[string]bool{}
	for _, eps := range seasons {
		for i := range eps {
			for _, u := range eps[i].ExistingVideoURLs() {
				used[u] = true
			}
		}
	}

	// 4) Index de vídeos (normalizado) para scoring rápido
	vIndex := make([]*Video, 0, len(videos))
	for i := range videos {
		vIndex = append(vIndex, &videos[i])
	}

	reader := bufio.NewReader(os.Stdin)

	linkedCount := 0
	askedCount := 0
	skippedCount := 0

	// 5) Link automático + interactivo
	for file, eps := range seasons {
		changed := false

		for i := range eps {
			ep := &eps[i]
			if ep.HasVideo() {
				continue // respetar manual
			}

			best := rankCandidates(*ep, vIndex, used, *dateDays)
			if len(best) == 0 {
				continue
			}

			if best[0].Score >= *autoThr {
				ep.SetVideo(best[0].Video.Title, best[0].Video.URL)
				used[best[0].Video.URL] = true
				linkedCount++
				changed = true
				fmt.Printf("[AUTO] %s  ⇄  %s (%.3f)\n", safe(ep.Title()), best[0].Video.Title, best[0].Score)
				continue
			}

			if best[0].Score >= *askThr {
				askedCount++
				fmt.Printf("\n[DUDOSO] Episodio: %s | date=%s\n", safe(ep.Title()), safe(ep.DateStr()))
				fmt.Println("Candidatos:")
				for j := 0; j < min(*topN, len(best)); j++ {
					c := best[j]
					fmt.Printf("  %d) score=%.3f  titleSim=%.3f  dateDiff=%dd  pub=%s\n     %s\n     %s\n",
						j+1, c.Score, c.TitleSim, c.DateDiff, safe(c.Video.PublishedAt), c.Video.Title, c.Video.URL)
				}
				fmt.Printf("Elige (1-%d), 's' para saltar, o pega URL manual: ", min(*topN, len(best)))

				choice, _ := reader.ReadString('\n')
				choice = strings.TrimSpace(choice)

				if choice == "s" || choice == "" {
					skippedCount++
					fmt.Println("  -> saltado")
					continue
				}

				if n, ok := parseInt(choice); ok {
					if n >= 1 && n <= min(*topN, len(best)) {
						c := best[n-1]
						ep.SetVideo(c.Video.Title, c.Video.URL)
						used[c.Video.URL] = true
						linkedCount++
						changed = true
						fmt.Printf("  -> enlazado con: %s\n", c.Video.Title)
						continue
					}
					fmt.Println("  -> opción inválida, saltando")
					skippedCount++
					continue
				}

				// Si no es número, asumimos URL manual
				if strings.Contains(choice, "youtube.com/watch") || strings.Contains(choice, "youtu.be/") {
					// buscamos el video en la lista (si existe), sino lo dejamos como url raw
					if v := findVideoByURL(vIndex, choice); v != nil {
						ep.SetVideo(v.Title, v.URL)
						used[v.URL] = true
						linkedCount++
						changed = true
						fmt.Printf("  -> enlazado manual con: %s\n", v.Title)
					} else {
						ep.SetVideo("", choice)
						used[choice] = true
						linkedCount++
						changed = true
						fmt.Printf("  -> enlazado manual con URL: %s\n", choice)
					}
					continue
				}

				fmt.Println("  -> entrada no reconocida, saltando")
				skippedCount++
			}
		}

		seasons[file] = eps

		if changed {
			fmt.Printf("[OK] cambios en %s\n", file)
		}
	}

	// 6) Marcar videos linked y corregir isPodcast (false si no enlazado)
	for i := range videos {
		linked := used[videos[i].URL]
		if !linked {
			// “limpieza”: si está mal marcado como podcast, lo forzamos a false
			videos[i].IsPodcast = ptrBool(false)
		}
	}

	fmt.Printf("\nResumen:\n")
	fmt.Printf("  enlazados: %d\n", linkedCount)
	fmt.Printf("  preguntados: %d\n", askedCount)
	fmt.Printf("  saltados: %d\n", skippedCount)

	if *dryRun {
		fmt.Println("\n(dry-run) No se escribieron ficheros.")
		return
	}

	// 7) Escribir salida
	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		fatal(err)
	}

	// videos.json
	if err := writeJSON(filepath.Join(*outDir, "videos.json"), videos); err != nil {
		fatal(err)
	}

	// seasons
	for file, eps := range seasons {
		outPath := filepath.Join(*outDir, filepath.Base(file))
		if err := writeJSON(outPath, epsToRaw(eps)); err != nil {
			fatal(err)
		}
	}

	fmt.Printf("\nEscrito en: %s\n", *outDir)
}

// ----------------------------
// IO
// ----------------------------

func loadVideos(path string) ([]Video, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var v []Video
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, err
	}
	// garantizar Extra no nil
	for i := range v {
		if v[i].Extra == nil {
			v[i].Extra = map[string]any{}
		}
	}
	return v, nil
}

func loadEpisodes(path string) ([]Episode, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw []map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	eps := make([]Episode, 0, len(raw))
	for _, r := range raw {
		eps = append(eps, Episode{Raw: r})
	}
	return eps, nil
}

func epsToRaw(eps []Episode) []map[string]any {
	out := make([]map[string]any, 0, len(eps))
	for i := range eps {
		out = append(out, eps[i].Raw)
	}
	return out
}

func writeJSON(path string, v any) error {
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, fs.FileMode(0o644))
	if err != nil {
		return err
	}
	defer f.Close()

	enc := json.NewEncoder(f)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ----------------------------
// Matching
// ----------------------------

func rankCandidates(ep Episode, videos []*Video, used map[string]bool, dateWindowDays int) []Candidate {
	epTitle := normalizeTitle(ep.Title())
	epTokens := tokenSet(epTitle)

	epDate := parseDate(ep.DateStr())

	cands := make([]Candidate, 0, 32)
	for _, v := range videos {
		if v == nil || v.URL == "" || used[v.URL] {
			continue
		}

		vTitleNorm := normalizeTitle(v.Title)
		if vTitleNorm == "" || epTitle == "" {
			continue
		}

		// Title similarity: combinación de Jaccard(tokens) + similitud por LCS/Lev aproximada (aquí: Dice sobre bigramas)
		j := jaccard(epTokens, tokenSet(vTitleNorm))
		d := diceBigrams(epTitle, vTitleNorm)

		titleSim := 0.55*j + 0.45*d

		// Date bonus (si tenemos fechas absolutas)
		dateBonus := 0.0
		dateDiff := 999999
		vDate := parseDate(v.PublishedAt)
		if !epDate.IsZero() && !vDate.IsZero() {
			diff := int(math.Abs(epDate.Sub(vDate).Hours() / 24))
			dateDiff = diff
			if diff <= dateWindowDays {
				// bonus suave, más alto cuanto más cerca
				dateBonus = 0.10 + 0.20*(1.0-float64(diff)/float64(max(1, dateWindowDays)))
			}
		}

		// Score final: primar título, añadir bonus por fecha
		score := clamp01(titleSim + dateBonus)

		// filtro rápido: si título casi no coincide, ni lo consideramos
		if score < 0.35 {
			continue
		}

		cands = append(cands, Candidate{
			Video:     v,
			Score:     score,
			TitleSim:  titleSim,
			DateBonus: dateBonus,
			DateDiff:  dateDiff,
		})
	}

	sort.Slice(cands, func(i, j int) bool {
		if cands[i].Score == cands[j].Score {
			// desempate: menor diff de fecha
			return cands[i].DateDiff < cands[j].DateDiff
		}
		return cands[i].Score > cands[j].Score
	})
	return cands
}

// ----------------------------
// Text normalization + similarity
// ----------------------------

var rePunct = regexp.MustCompile(`[^\pL\pN\s]+`)

func normalizeTitle(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	s = strings.ToLower(s)

	// quitar acentos
	t := transform.Chain(norm.NFD, transform.RemoveFunc(isMn), norm.NFC)
	out, _, _ := transform.String(t, s)
	s = out

	// quitar puntuación
	s = rePunct.ReplaceAllString(s, " ")
	s = strings.Join(strings.Fields(s), " ")

	// limpiar palabras muy comunes si te interesa (opcional, deja mínimo)
	stop := map[string]bool{
		"mundodolphins": true, "mundo": true, "dolphins": false, // ojo: "dolphins" suele ser relevante
		"podcast": true, "capitulo": true, "cap": true, "temporada": true,
		"vs": true, "v": true, "pre": true, "previa": true, "analisis": true,
	}
	toks := strings.Fields(s)
	outT := make([]string, 0, len(toks))
	for _, tok := range toks {
		if stop[tok] {
			continue
		}
		outT = append(outT, tok)
	}
	return strings.Join(outT, " ")
}

func isMn(r rune) bool { // Mark, nonspacing (acentos)
	return unicode.Is(unicode.Mn, r)
}

func tokenSet(s string) map[string]struct{} {
	set := map[string]struct{}{}
	for _, t := range strings.Fields(s) {
		set[t] = struct{}{}
	}
	return set
}

func jaccard(a, b map[string]struct{}) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	inter := 0
	for k := range a {
		if _, ok := b[k]; ok {
			inter++
		}
	}
	union := len(a) + len(b) - inter
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}

// Dice coefficient sobre bigramas de caracteres: robusto a pequeñas variaciones.
func diceBigrams(a, b string) float64 {
	ba := bigrams(a)
	bb := bigrams(b)
	if len(ba) == 0 || len(bb) == 0 {
		return 0
	}
	m := map[string]int{}
	for _, x := range ba {
		m[x]++
	}
	inter := 0
	for _, x := range bb {
		if m[x] > 0 {
			m[x]--
			inter++
		}
	}
	return (2.0 * float64(inter)) / float64(len(ba)+len(bb))
}

func bigrams(s string) []string {
	s = strings.ReplaceAll(s, " ", "")
	r := []rune(s)
	if len(r) < 2 {
		return nil
	}
	out := make([]string, 0, len(r)-1)
	for i := 0; i < len(r)-1; i++ {
		out = append(out, string(r[i:i+2]))
	}
	return out
}

// ----------------------------
// Date parsing
// ----------------------------

func parseDate(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	// Intentar YYYY-MM-DD (lo esperado)
	if len(s) >= 10 {
		if t, err := time.Parse("2006-01-02", s[:10]); err == nil {
			return t
		}
	}
	// fallback: RFC3339
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	return time.Time{}
}

// ----------------------------
// Helpers
// ----------------------------

func ptrBool(b bool) *bool { return &b }

func clamp01(x float64) float64 {
	if x < 0 {
		return 0
	}
	if x > 1 {
		return 1
	}
	return x
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func safe(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "-"
	}
	return s
}

func parseInt(s string) (int, bool) {
	s = strings.TrimSpace(s)
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, false
		}
		n = n*10 + int(r-'0')
	}
	return n, true
}

func findVideoByURL(videos []*Video, url string) *Video {
	url = strings.TrimSpace(url)
	for _, v := range videos {
		if v != nil && strings.TrimSpace(v.URL) == url {
			return v
		}
	}
	// permitir match si te pegan youtu.be/...
	if strings.Contains(url, "youtu.be/") {
		// transformar youtu.be/<id> a watch?v=<id>
		id := url[strings.LastIndex(url, "/")+1:]
		if id != "" {
			u2 := "https://www.youtube.com/watch?v=" + id
			for _, v := range videos {
				if v != nil && strings.TrimSpace(v.URL) == u2 {
					return v
				}
			}
		}
	}
	return nil
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "ERROR:", err)
	os.Exit(1)
}
