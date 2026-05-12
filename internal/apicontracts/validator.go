package apicontracts

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// Issue describes a single contract violation or a contract-level failure.
type Issue struct {
	Contract      string
	SchemaPath    string
	JSONPath      string
	SchemaURL     string
	Message       string
	Value         string
	JSONFile      string
	ContractError bool
}

// ValidationError aggregates every issue discovered during contract validation.
type ValidationError struct {
	Issues []Issue
}

func (e *ValidationError) Error() string {
	if e == nil || len(e.Issues) == 0 {
		return "API contract validation failed"
	}

	var b strings.Builder
	fmt.Fprintf(&b, "API contract validation failed (%d issue(s)):\n", len(e.Issues))

	for _, issue := range e.Issues {
		fmt.Fprintf(&b, "- [%s] ", issue.Contract)
		if issue.JSONFile != "" {
			fmt.Fprintf(&b, "%s ", issue.JSONFile)
		}
		if issue.SchemaPath != "" {
			fmt.Fprintf(&b, "-> %s ", issue.SchemaPath)
		}
		if issue.JSONPath != "" {
			fmt.Fprintf(&b, "path %s: ", issue.JSONPath)
		}
		fmt.Fprintf(&b, "%s", issue.Message)
		if issue.SchemaURL != "" && issue.SchemaURL != issue.SchemaPath {
			fmt.Fprintf(&b, " [schema=%s]", issue.SchemaURL)
		}
		if issue.Value != "" {
			fmt.Fprintf(&b, " (value=%s)", issue.Value)
		}
		b.WriteByte('\n')
	}

	return strings.TrimRight(b.String(), "\n")
}

func Validate(rootDir, configPath string) error {
	cfg, err := LoadConfig(configPath)
	if err != nil {
		return err
	}

	issues := ValidateConfig(rootDir, cfg)
	if len(issues) == 0 {
		return nil
	}
	return &ValidationError{Issues: issues}
}

func ValidateConfig(rootDir string, cfg *Config) []Issue {
	var issues []Issue
	for _, contract := range cfg.Contracts {
		issues = append(issues, validateContract(rootDir, contract)...)
	}
	return issues
}

func validateContract(rootDir string, contract ContractSpec) []Issue {
	var issues []Issue

	schemaPath, err := resolvePath(rootDir, contract.Schema)
	if err != nil {
		return []Issue{{Contract: contract.Name, SchemaPath: contract.Schema, Message: err.Error(), ContractError: true}}
	}
	if _, err := os.Stat(schemaPath); err != nil {
		return []Issue{{Contract: contract.Name, SchemaPath: contract.Schema, Message: fmt.Sprintf("schema not found: %s", schemaPath), ContractError: true}}
	}

	schemaDoc, err := loadJSONFile(schemaPath)
	if err != nil {
		return []Issue{{Contract: contract.Name, SchemaPath: contract.Schema, Message: fmt.Sprintf("invalid schema JSON: %v", err), ContractError: true}}
	}

	compiler := jsonschema.NewCompiler()
	compiler.AssertFormat()
	if err := compiler.AddResource(schemaPath, schemaDoc); err != nil {
		return []Issue{{Contract: contract.Name, SchemaPath: contract.Schema, Message: fmt.Sprintf("schema compilation failed: %v", err), ContractError: true}}
	}
	sch, err := compiler.Compile(schemaPath)
	if err != nil {
		return []Issue{{Contract: contract.Name, SchemaPath: contract.Schema, Message: fmt.Sprintf("schema compilation failed: %v", err), ContractError: true}}
	}

	targets := contract.Targets()
	for _, target := range targets {
		resolvedTargets, err := expandTarget(rootDir, target)
		if err != nil {
			issues = append(issues, Issue{Contract: contract.Name, SchemaPath: contract.Schema, JSONFile: target, Message: err.Error(), ContractError: true})
			continue
		}
		if len(resolvedTargets) == 0 {
			issues = append(issues, Issue{Contract: contract.Name, SchemaPath: contract.Schema, JSONFile: target, Message: fmt.Sprintf("no JSON files matched %q", target), ContractError: true})
			continue
		}

		sort.Strings(resolvedTargets)
		for _, jsonPath := range resolvedTargets {
			inst, err := loadJSONFile(jsonPath)
			if err != nil {
				issues = append(issues, Issue{Contract: contract.Name, SchemaPath: contract.Schema, JSONFile: relForDisplay(rootDir, jsonPath), Message: fmt.Sprintf("invalid JSON: %v", err), ContractError: true})
				continue
			}

			if err := sch.Validate(inst); err != nil {
				issues = append(issues, collectValidationIssues(contract.Name, contract.Schema, relForDisplay(rootDir, jsonPath), inst, err)...)
			}
		}
	}

	return issues
}

func collectValidationIssues(contractName, schemaPath, jsonFile string, instance any, err error) []Issue {
	var verr *jsonschema.ValidationError
	if !errors.As(err, &verr) {
		return []Issue{{
			Contract:   contractName,
			SchemaPath: schemaPath,
			JSONFile:   jsonFile,
			Message:    err.Error(),
		}}
	}

	if len(verr.Causes) > 0 {
		var issues []Issue
		for _, cause := range verr.Causes {
			issues = append(issues, collectValidationIssues(contractName, schemaPath, jsonFile, instance, cause)...)
		}
		return issues
	}

	path := pointerString(verr.InstanceLocation)
	value := valueAt(instance, verr.InstanceLocation)
	valueText := ""
	if value != nil {
		if raw, marshalErr := json.Marshal(value); marshalErr == nil {
			valueText = string(raw)
		}
	}

	return []Issue{{
		Contract:   contractName,
		SchemaPath: schemaPath,
		JSONFile:   jsonFile,
		JSONPath:   path,
		SchemaURL:  verr.SchemaURL,
		Message:    verr.Error(),
		Value:      valueText,
	}}
}

func loadJSONFile(path string) (any, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	decoder.UseNumber()

	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

func resolvePath(rootDir, relPath string) (string, error) {
	if filepath.IsAbs(relPath) {
		return filepath.Clean(relPath), nil
	}
	if rootDir == "" {
		return "", fmt.Errorf("empty repository root")
	}
	return filepath.Clean(filepath.Join(rootDir, relPath)), nil
}

func expandTarget(rootDir, pattern string) ([]string, error) {
	resolved, err := resolvePath(rootDir, pattern)
	if err != nil {
		return nil, err
	}

	if !hasGlob(pattern) {
		if _, err := os.Stat(resolved); err != nil {
			return nil, err
		}
		return []string{resolved}, nil
	}

	matches, err := filepath.Glob(resolved)
	if err != nil {
		return nil, fmt.Errorf("invalid glob %q: %w", pattern, err)
	}
	return matches, nil
}

func hasGlob(value string) bool {
	return strings.ContainsAny(value, "*?[")
}

func relForDisplay(rootDir, absPath string) string {
	rel, err := filepath.Rel(rootDir, absPath)
	if err != nil {
		return absPath
	}
	return filepath.ToSlash(rel)
}

func pointerString(tokens []string) string {
	if len(tokens) == 0 {
		return ""
	}
	var b strings.Builder
	for _, token := range tokens {
		b.WriteByte('/')
		b.WriteString(strings.NewReplacer("~", "~0", "/", "~1").Replace(token))
	}
	return b.String()
}

func valueAt(instance any, tokens []string) any {
	current := instance
	for _, token := range tokens {
		switch typed := current.(type) {
		case map[string]any:
			value, ok := typed[token]
			if !ok {
				return nil
			}
			current = value
		case []any:
			index, err := strconv.Atoi(token)
			if err != nil || index < 0 || index >= len(typed) {
				return nil
			}
			current = typed[index]
		default:
			return nil
		}
	}
	return current
}
