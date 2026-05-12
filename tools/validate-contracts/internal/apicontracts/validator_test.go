package apicontracts

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateContractsSuccess(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "contracts/schemas/articles.schema.json", `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["title", "author", "content", "publishedDate"],
    "properties": {
      "title": {"type": "string"},
      "author": {"type": "string"},
      "content": {"type": "string"},
      "publishedDate": {"type": "string", "format": "date-time"}
    },
    "additionalProperties": true
  }
}`)
	writeFile(t, root, "public/api/articles.json", `[
  {
    "title": "Article",
    "author": "Javi",
    "content": "Body",
    "publishedDate": "2026-05-12T09:00:00+02:00"
  }
]`)
	writeFile(t, root, "contracts/api-contracts.yaml", `contracts:
  - name: articles
    schema: contracts/schemas/articles.schema.json
    json: public/api/articles.json
`)

	if err := Validate(root, filepath.Join(root, "contracts/api-contracts.yaml")); err != nil {
		t.Fatalf("expected validation to pass, got error: %v", err)
	}
}

func TestValidateContractsInvalidJSONFails(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "contracts/schemas/articles.schema.json", `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["title", "publishedDate"],
    "properties": {
      "title": {"type": "string"},
      "publishedDate": {"type": "string", "format": "date-time"}
    },
    "additionalProperties": true
  }
}`)
	writeFile(t, root, "public/api/articles.json", `[
  {
    "title": "Article",
    "publishedDate": "not-a-date"
  }
]`)
	writeFile(t, root, "contracts/api-contracts.yaml", `contracts:
  - name: articles
    schema: contracts/schemas/articles.schema.json
    json: public/api/articles.json
`)

	err := Validate(root, filepath.Join(root, "contracts/api-contracts.yaml"))
	if err == nil {
		t.Fatal("expected validation to fail")
	}
	message := err.Error()
	for _, want := range []string{"articles", "public/api/articles.json", "contracts/schemas/articles.schema.json", "/0/publishedDate", "not-a-date"} {
		if !strings.Contains(message, want) {
			t.Fatalf("error %q does not contain %q", message, want)
		}
	}
}

func TestValidateContractsMissingSchemaFails(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "public/api/articles.json", `[]`)
	writeFile(t, root, "contracts/api-contracts.yaml", `contracts:
  - name: articles
    schema: contracts/schemas/missing.schema.json
    json: public/api/articles.json
`)

	err := Validate(root, filepath.Join(root, "contracts/api-contracts.yaml"))
	if err == nil {
		t.Fatal("expected validation to fail")
	}
	if !strings.Contains(err.Error(), "schema not found") {
		t.Fatalf("expected missing schema error, got: %v", err)
	}
}

func TestValidateContractsMissingJSONFails(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "contracts/schemas/articles.schema.json", `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array"
}`)
	writeFile(t, root, "contracts/api-contracts.yaml", `contracts:
  - name: articles
    schema: contracts/schemas/articles.schema.json
    json: public/api/missing.json
`)

	err := Validate(root, filepath.Join(root, "contracts/api-contracts.yaml"))
	if err == nil {
		t.Fatal("expected validation to fail")
	}
	if !strings.Contains(err.Error(), "no such file") && !strings.Contains(err.Error(), "missing.json") {
		t.Fatalf("expected missing JSON error, got: %v", err)
	}
}

func TestLoadConfigMalformedYAMLFails(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "contracts/api-contracts.yaml", "contracts:\n  - name: articles\n    schema")

	if _, err := LoadConfig(filepath.Join(root, "contracts/api-contracts.yaml")); err == nil {
		t.Fatal("expected malformed YAML to fail")
	}
}

func writeFile(t *testing.T, root, relPath, content string) {
	t.Helper()
	path := filepath.Join(root, relPath)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
