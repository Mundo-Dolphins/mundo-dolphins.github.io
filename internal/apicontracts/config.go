package apicontracts

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config declares the external API contracts that must pass validation.
type Config struct {
	Contracts []ContractSpec `yaml:"contracts"`
}

// ContractSpec binds one JSON Schema to one or more generated JSON files.
type ContractSpec struct {
	Name   string   `yaml:"name"`
	Schema string   `yaml:"schema"`
	JSON   string   `yaml:"json"`
	JSONs  []string `yaml:"jsons"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse contracts config %s: %w", path, err)
	}

	for i := range cfg.Contracts {
		cfg.Contracts[i].Name = strings.TrimSpace(cfg.Contracts[i].Name)
		cfg.Contracts[i].Schema = strings.TrimSpace(cfg.Contracts[i].Schema)
		cfg.Contracts[i].JSON = strings.TrimSpace(cfg.Contracts[i].JSON)
		for j := range cfg.Contracts[i].JSONs {
			cfg.Contracts[i].JSONs[j] = strings.TrimSpace(cfg.Contracts[i].JSONs[j])
		}

		if cfg.Contracts[i].Name == "" {
			return nil, fmt.Errorf("parse contracts config %s: contract at index %d is missing name", path, i)
		}
		if cfg.Contracts[i].Schema == "" {
			return nil, fmt.Errorf("parse contracts config %s: contract %q is missing schema", path, cfg.Contracts[i].Name)
		}
		if len(cfg.Contracts[i].JSONs) == 0 && cfg.Contracts[i].JSON == "" {
			return nil, fmt.Errorf("parse contracts config %s: contract %q has no JSON targets", path, cfg.Contracts[i].Name)
		}
	}

	return &cfg, nil
}

func (c ContractSpec) Targets() []string {
	targets := make([]string, 0, 1+len(c.JSONs))
	if c.JSON != "" {
		targets = append(targets, c.JSON)
	}
	targets = append(targets, c.JSONs...)
	return targets
}
