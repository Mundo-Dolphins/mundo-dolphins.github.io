package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Mundo-Dolphins/mundo-dolphins.github.io/tools/validate-contracts/internal/apicontracts"
)

func main() {
	rootDir := flag.String("root", ".", "repository root used to resolve contract paths")
	configPath := flag.String("config", filepath.FromSlash("contracts/api-contracts.yaml"), "path to the contract mapping YAML")
	flag.Parse()

	if err := apicontracts.Validate(*rootDir, *configPath); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
