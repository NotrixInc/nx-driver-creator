import * as path from 'path';
import * as fs from 'fs';
import { getExtensionConfig, execCommand, execCommandWithTimeout, log } from '../utils';

/**
 * Service for building, running, and managing driver SDK operations.
 */
export class DriverSdkService {
  /**
   * Build a driver project using `go build`.
   */
  async buildDriver(projectDir: string): Promise<{ success: boolean; output: string }> {
    const config = getExtensionConfig();
    const goPath = config.goPath || 'go';

    log(`Building driver in ${projectDir}...`);

    try {
      const syncOutput = await this.syncGeneratedFiles(projectDir, goPath);

      // Always start from a clean bin/ for Build Driver
      this.cleanBinDir(projectDir);

      const outputFile = process.platform === 'win32'
        ? path.join(projectDir, 'bin', 'driver.exe')
        : path.join(projectDir, 'bin', 'driver');

      const { stdout, stderr } = await this.runGoBuild(projectDir, goPath, outputFile);

      const output = stdout + stderr;
      log(`Build successful: ${outputFile}`);
      return { success: true, output: `${syncOutput}\nBuild successful!\n${output}`.trim() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Build failed: ${message}`);
      return { success: false, output: message };
    }
  }

  async buildDriverForPackaging(projectDir: string): Promise<{ success: boolean; output: string }> {
    const config = getExtensionConfig();
    const goPath = config.goPath || 'go';
    const targetOs = (config.packageTargetOs || 'linux').toLowerCase();
    const targetArch = (config.packageTargetArch || 'amd64').toLowerCase();

    log(`Building package target in ${projectDir} for ${targetOs}/${targetArch}...`);

    try {
      const syncOutput = await this.syncGeneratedFiles(projectDir, goPath);

      // Clean stale binaries so old platform artifacts don't end up in the package
      this.cleanBinDir(projectDir);

      const outputFile = path.join(projectDir, 'bin', 'driver');

      const { stdout, stderr } = await this.runGoBuild(projectDir, goPath, outputFile, {
        GOOS: targetOs,
        GOARCH: targetArch,
        CGO_ENABLED: '0',
      });

      const output = `${stdout}${stderr}`.trim();
      log(`Package target build successful: ${outputFile} (${targetOs}/${targetArch})`);
      return {
        success: true,
        output: `${syncOutput}\nPackage build successful for ${targetOs}/${targetArch}!\n${output}`.trim(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Package target build failed: ${message}`);
      return { success: false, output: message };
    }
  }

  /**
   * Run `go mod tidy` in the project directory.
   * Skips gracefully if Go is not installed.
   */
  async modTidy(projectDir: string): Promise<{ success: boolean; output: string }> {
    // Check if Go is available before attempting mod tidy
    const goAvailable = await this.isGoAvailable();
    if (!goAvailable) {
      return { success: false, output: 'go mod tidy skipped: Go is not installed or not in PATH. You can run it manually later.' };
    }

    const config = getExtensionConfig();
    const goPath = config.goPath || 'go';

    try {
      const { stdout, stderr } = await execCommandWithTimeout(
        `"${goPath}" mod tidy`,
        projectDir,
        15000 // 15 second timeout
      );
      const output = (stdout + stderr).trim();
      // Timeout messages come back in stderr
      if (output.includes('timed out')) {
        return { success: false, output: output };
      }
      return { success: true, output: output || 'go mod tidy completed.' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Don't fail the whole creation if mod tidy fails
      return { success: false, output: `go mod tidy warning: ${message}` };
    }
  }

  /**
   * Run the driver locally with test device ID and config.
   */
  async getRunCommand(projectDir: string, deviceId: string, configPath?: string): Promise<string> {
    const binaryName = process.platform === 'win32' ? 'bin\\driver.exe' : './bin/driver';
    let cmd = `${binaryName} -device_id "${deviceId}"`;

    if (configPath) {
      cmd += ` -config "${configPath}"`;
    }

    return cmd;
  }

  /**
   * Check if Go is available.
   */
  async isGoAvailable(): Promise<boolean> {
    const config = getExtensionConfig();
    const goPath = config.goPath || 'go';

    try {
      await execCommand(`"${goPath}" version`, process.cwd());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Go version.
   */
  async getGoVersion(): Promise<string> {
    const config = getExtensionConfig();
    const goPath = config.goPath || 'go';

    try {
      const { stdout } = await execCommand(`"${goPath}" version`, process.cwd());
      return stdout.trim();
    } catch {
      return 'Go not found';
    }
  }

  /**
   * Resolve the SDK module path for use in go.mod.
   */
  getSdkModulePath(): string {
    return 'github.com/NotrixInc/nx-driver-sdk';
  }

  /**
   * Check if local SDK path is configured and add replace directive.
   */
  async setupLocalSdk(projectDir: string): Promise<void> {
    const config = getExtensionConfig();
    if (!config.sdkPath) {
      return;
    }

    const goModPath = path.join(projectDir, 'go.mod');
    if (!fs.existsSync(goModPath)) {
      return;
    }

    let content = fs.readFileSync(goModPath, 'utf-8');
    const sdkModule = this.getSdkModulePath();

    if (!content.includes(`replace ${sdkModule}`)) {
      const relativePath = path.relative(projectDir, config.sdkPath).replace(/\\/g, '/');
      content += `\nreplace ${sdkModule} => ${relativePath}\n`;
      fs.writeFileSync(goModPath, content, 'utf-8');
    }
  }

  /**
   * Find the entrypoint directory for go build.
   */
  private findEntrypoint(projectDir: string): string {
    const cmdDriver = path.join(projectDir, 'cmd', 'driver');
    if (fs.existsSync(cmdDriver)) {
      return './cmd/driver';
    }

    const mainGo = path.join(projectDir, 'main.go');
    if (fs.existsSync(mainGo)) {
      return '.';
    }

    return './cmd/driver';
  }

  /**
   * Remove previous build artifacts from the bin/ directory.
   * Keeps .gitkeep if present.
   */
  private cleanBinDir(projectDir: string): void {
    const binDir = path.join(projectDir, 'bin');
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(binDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.gitkeep') {
        continue;
      }

      const entryPath = path.join(binDir, entry.name);
      try {
        if (entry.isDirectory()) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(entryPath);
        }
        log(`Removed old build artifact: bin/${entry.name}`);
      } catch {
        // best-effort
      }
    }
  }

  private runGoBuild(
    projectDir: string,
    goPath: string,
    outputFile: string,
    env?: Record<string, string>
  ): Promise<{ stdout: string; stderr: string }> {
    const entrypoint = this.findEntrypoint(projectDir);
    return execCommand(
      `"${goPath}" build -o "${outputFile}" ${entrypoint}`,
      projectDir,
      env
    );
  }

  private async syncGeneratedFiles(projectDir: string, goPath: string): Promise<string> {
    this.validateSpecJsonFiles(projectDir);

    const config = getExtensionConfig();
    const configuredCommand = (config.preBuildSyncCommand || '').trim();
    if (!configuredCommand) {
      return 'Pre-build sync skipped: nxDriver.preBuildSyncCommand is empty.';
    }

    const resolvedCommand = configuredCommand
      .replaceAll('${goPath}', goPath)
      .replaceAll('${projectDir}', projectDir.replace(/\\/g, '/'));

    const usingDefaultGoGenerate = configuredCommand === 'go generate ./...';
    if (usingDefaultGoGenerate && !this.hasGoGenerateDirectives(projectDir)) {
      // Only re-bootstrap projects that were previously bootstrapped (have
      // the specgen source in cmd/specgen/main.go).  For all other projects,
      // skip code generation and do a plain build – this matches the dimmer
      // driver workflow where the Go code is hand-written and the JSON
      // schema files are served as-is by controller-core.
      const specGenPath = path.join(projectDir, 'cmd', 'specgen', 'main.go');
      if (fs.existsSync(specGenPath)) {
        const migrated = this.bootstrapLegacyJsonSync(projectDir);
        if (migrated) {
          log('Spec generator updated (project was previously bootstrapped).');
        }
      } else {
        log('No //go:generate directives found and no specgen present – skipping code generation (plain build).');
        const schemaWarnings = this.validateSchemaContents(projectDir);
        return schemaWarnings
          ? `Pre-build sync skipped (plain build).\n${schemaWarnings}`
          : 'Pre-build sync skipped (plain build).';
      }
    }

    if (usingDefaultGoGenerate && !this.hasGoGenerateDirectives(projectDir)) {
      log('No //go:generate directives found after bootstrap attempt – skipping code generation.');
      return 'Pre-build sync skipped: no //go:generate directives found.';
    }

    log(`Running pre-build sync command in ${projectDir}: ${resolvedCommand}`);
    const { stdout, stderr } = await execCommand(resolvedCommand, projectDir);
    const output = `${stdout}${stderr}`.trim();

    if (output) {
      log(`Pre-build sync output:\n${output}`);
    }

    const schemaWarnings = this.validateSchemaContents(projectDir);
    const parts = ['Pre-build sync completed.'];
    if (output) { parts.push(output); }
    if (schemaWarnings) { parts.push(schemaWarnings); }
    return parts.join('\n');
  }

  private validateSpecJsonFiles(projectDir: string): void {
    const specFiles = [
      'endpoints.json',
      'variables.schema.json',
      'capabilities.json',
      'events.json',
    ];

    for (const filename of specFiles) {
      const filePath = path.join(projectDir, filename);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      try {
        JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON in ${filename}: ${message}`);
      }
    }
  }

  /**
   * Validate that schema files needed by controller-core are present and
   * well-formed.  Returns a warning string (empty if everything is fine).
   *
   * Controller-core web console uses:
   *  - variables.schema.json ({"variables": [...]}) for Control/Telemetry tabs
   *  - config.schema.json  (JSON Schema) for Settings tab
   */
  private validateSchemaContents(projectDir: string): string {
    const warnings: string[] = [];

    // --- variables.schema.json ---
    const varsPath = path.join(projectDir, 'variables.schema.json');
    if (!fs.existsSync(varsPath)) {
      warnings.push('⚠ variables.schema.json not found – Control and Telemetry tabs will be empty in web console.');
    } else {
      try {
        const varsData = JSON.parse(fs.readFileSync(varsPath, 'utf-8'));

        // Preferred format: { "variables": [ { key, type, writable, ... } ] }
        if (Array.isArray(varsData?.variables)) {
          let writableCount = 0;
          let readOnlyCount = 0;

          for (const v of varsData.variables) {
            if (!v.key || !v.type) {
              warnings.push(`⚠ variables.schema.json: entry missing "key" or "type" field.`);
              break;
            }
            if (v.writable === true) {
              writableCount++;
            } else {
              readOnlyCount++;
            }
          }

          if (varsData.variables.length > 0 && writableCount === 0) {
            warnings.push('⚠ variables.schema.json: no variables with "writable": true – Control tab will be empty.');
          }
          if (varsData.variables.length > 0 && readOnlyCount === 0) {
            warnings.push('⚠ variables.schema.json: no variables with "writable": false – Telemetry tab will be empty.');
          }
        } else if (varsData?.type === 'object' && varsData?.properties) {
          // JSON Schema format — all fields treated as writable by web console
          log('variables.schema.json uses JSON Schema format – all fields will appear as writable (Control tab only).');
        } else if (Array.isArray(varsData)) {
          // Flat array format — supported by the web console (wrapped in { variables: [...] } internally).
          log('variables.schema.json uses flat array format – fully supported.');
        } else {
          warnings.push('⚠ variables.schema.json: unrecognized format. Expected { "variables": [ { key, type, writable, ... } ] }.');
        }
      } catch {
        // JSON parse errors already caught by validateSpecJsonFiles
      }
    }

    // --- config.schema.json ---
    const cfgPath = path.join(projectDir, 'config.schema.json');
    if (!fs.existsSync(cfgPath)) {
      warnings.push('⚠ config.schema.json not found – Settings tab will be empty in web console.');
    } else {
      try {
        const cfgData = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        if (!cfgData?.properties || typeof cfgData.properties !== 'object') {
          warnings.push('⚠ config.schema.json: missing "properties" object – Settings tab may be empty.');
        }
      } catch {
        // JSON parse errors already caught by validateSpecJsonFiles
      }
    }

    if (warnings.length > 0) {
      const msg = warnings.join('\n');
      log(`Schema validation warnings:\n${msg}`);
      return msg;
    }
    return '';
  }

  private hasGoGenerateDirectives(projectDir: string): boolean {
    const stack = [projectDir];

    while (stack.length > 0) {
      const currentDir = stack.pop();
      if (!currentDir) {
        continue;
      }

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name === '.git' || entry.name === 'bin' || entry.name === 'vendor') {
            continue;
          }
          stack.push(fullPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.go')) {
          continue;
        }

        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.includes('//go:generate')) {
            return true;
          }
        } catch {
          continue;
        }
      }
    }

    return false;
  }

  /**
   * Bootstrap spec generation for a project.  Creates cmd/specgen/main.go,
   * adds //go:generate directive, and wires Endpoints()/Variables() to use
   * the generated functions.  Returns true if any files were changed.
   */
  bootstrapLegacyJsonSync(projectDir: string): boolean {
    const driverGoPath = path.join(projectDir, 'internal', 'driver', 'driver.go');
    if (!fs.existsSync(driverGoPath)) {
      return false;
    }

    const endpointsPath = path.join(projectDir, 'endpoints.json');
    const variablesPath = path.join(projectDir, 'variables.schema.json');
    if (!fs.existsSync(endpointsPath) || !fs.existsSync(variablesPath)) {
      return false;
    }

    let changed = false;

    const specGenPath = path.join(projectDir, 'cmd', 'specgen', 'main.go');
    const desiredSpecGenSource = this.getLegacySpecGeneratorSource();
    const currentSpecGenSource = fs.existsSync(specGenPath)
      ? fs.readFileSync(specGenPath, 'utf-8')
      : '';

    if (currentSpecGenSource !== desiredSpecGenSource) {
      fs.mkdirSync(path.dirname(specGenPath), { recursive: true });
      fs.writeFileSync(specGenPath, desiredSpecGenSource, 'utf-8');
      changed = true;
    }

    const originalDriverSource = fs.readFileSync(driverGoPath, 'utf-8');
    let driverSource = originalDriverSource;

    if (!driverSource.includes('//go:generate go run ../../cmd/specgen/main.go')) {
      driverSource = driverSource.replace(
        /^(package\s+\w+\s*\r?\n)/,
        '$1\n//go:generate go run ../../cmd/specgen/main.go\n\n'
      );
    }

    const endpointMethodPattern = /func\s+\(([A-Za-z_][A-Za-z0-9_]*)\s+\*([A-Za-z0-9_]+)\)\s+Endpoints\(\)\s+\(\[\]driversdk\.Endpoint,\s*error\)\s*\{[\s\S]*?\n\}/m;
    driverSource = driverSource.replace(
      endpointMethodPattern,
      'func ($1 *$2) Endpoints() ([]driversdk.Endpoint, error) {\n\treturn generatedEndpoints(), nil\n}'
    );

    const variableMethodPattern = /func\s+\(([A-Za-z_][A-Za-z0-9_]*)\s+\*([A-Za-z0-9_]+)\)\s+Variables\(\)\s+\(\[\]driversdk\.Variable,\s*error\)\s*\{[\s\S]*?\n\}/m;
    driverSource = driverSource.replace(
      variableMethodPattern,
      'func ($1 *$2) Variables() ([]driversdk.Variable, error) {\n\treturn generatedVariables(), nil\n}'
    );

    if (driverSource !== originalDriverSource) {
      fs.writeFileSync(driverGoPath, driverSource, 'utf-8');
      changed = true;
    }

    return changed;
  }

  private getLegacySpecGeneratorSource(): string {
    return `package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"go/format"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type endpointSpec struct {
  ID           string            \`json:"id"\`
	Key          string            \`json:"key"\`
	Name         string            \`json:"name"\`
	Direction    string            \`json:"direction"\`
  Type         string            \`json:"type"\`
	Kind         string            \`json:"kind"\`
	Connection   string            \`json:"connection"\`
	Icon         string            \`json:"icon"\`
	MultiBinding bool              \`json:"multi_binding"\`
	ControlType  string            \`json:"control_type"\`
	ValueSchema  any               \`json:"value_schema"\`
	Meta         map[string]string \`json:"meta"\`
}

type endpointsFileSpec struct {
  Endpoints []endpointSpec \`json:"endpoints"\`
}

type variablesFileSpec struct {
  Variables []variableSpec \`json:"variables"\`
}

type variableSpec struct {
	Key      string            \`json:"key"\`
	Type     string            \`json:"type"\`
	Unit     string            \`json:"unit"\`
	Readable bool              \`json:"readable"\`
	Writable bool              \`json:"writable"\`
	ReadOnly bool              \`json:"read_only"\`
	Meta     map[string]string \`json:"meta"\`
}

func main() {
	projectDir := flag.String("project", "", "Driver project root directory")
	flag.Parse()

	root, err := resolveProjectRoot(*projectDir)
	if err != nil {
		fatal(err)
	}

	endpointsPath := filepath.Join(root, "endpoints.json")
	variablesPath := filepath.Join(root, "variables.schema.json")
	outputPath := filepath.Join(root, "internal", "driver", "specs_gen.go")

  endpoints, err := loadEndpoints(endpointsPath)
  if err != nil {
		fatal(fmt.Errorf("read endpoints.json: %w", err))
	}

  variables, err := loadVariables(variablesPath)
  if err != nil {
		fatal(fmt.Errorf("read variables.schema.json: %w", err))
	}

	src, err := buildGeneratedFile(endpoints, variables)
	if err != nil {
		fatal(err)
	}

	if err := os.WriteFile(outputPath, src, 0o644); err != nil {
		fatal(fmt.Errorf("write %s: %w", outputPath, err))
	}

	fmt.Printf("generated %s from endpoints.json and variables.schema.json\\n", outputPath)
}

func resolveProjectRoot(explicit string) (string, error) {
	if explicit != "" {
		return filepath.Abs(explicit)
	}

	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	current := cwd
	for {
		manifestPath := filepath.Join(current, "manifest.json")
		if _, err := os.Stat(manifestPath); err == nil {
			return current, nil
		}

		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}

	return "", fmt.Errorf("could not locate project root (manifest.json not found from %s)", cwd)
}

func readJSON(path string, out any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, out); err != nil {
		return err
	}
	return nil
}

func loadEndpoints(path string) ([]endpointSpec, error) {
  var raw any
  if err := readJSON(path, &raw); err != nil {
    return nil, err
  }

  if list, ok := raw.([]any); ok {
    bytes, _ := json.Marshal(list)
    var endpoints []endpointSpec
    if err := json.Unmarshal(bytes, &endpoints); err != nil {
      return nil, err
    }
    return endpoints, nil
  }

  record, ok := raw.(map[string]any)
  if !ok {
    return nil, fmt.Errorf("invalid endpoints format")
  }

  bytes, _ := json.Marshal(record)
  var wrapper endpointsFileSpec
  if err := json.Unmarshal(bytes, &wrapper); err != nil {
    return nil, err
  }

  return wrapper.Endpoints, nil
}

func loadVariables(path string) ([]variableSpec, error) {
  var raw any
  if err := readJSON(path, &raw); err != nil {
    return nil, err
  }

  if list, ok := raw.([]any); ok {
    bytes, _ := json.Marshal(list)
    var variables []variableSpec
    if err := json.Unmarshal(bytes, &variables); err != nil {
      return nil, err
    }
    return variables, nil
  }

  record, ok := raw.(map[string]any)
  if !ok {
    return nil, fmt.Errorf("invalid variables format")
  }

  bytes, _ := json.Marshal(record)
  var wrapper variablesFileSpec
  if err := json.Unmarshal(bytes, &wrapper); err != nil {
    return nil, err
  }

  return wrapper.Variables, nil
}

func buildGeneratedFile(endpoints []endpointSpec, variables []variableSpec) ([]byte, error) {
	var b bytes.Buffer
	hasValueSchemas := false
	for _, ep := range endpoints {
		if ep.ValueSchema != nil {
			hasValueSchemas = true
			break
		}
	}

	b.WriteString("// Code generated by nx-driver-creator specgen. DO NOT EDIT.\\n")
	b.WriteString("\\n")
	b.WriteString("package driver\\n")
	b.WriteString("\\n")
	b.WriteString("import (\\n")
	if hasValueSchemas {
		b.WriteString("\\t\\\"encoding/json\\\"\\n")
		b.WriteString("\\n")
	}
	b.WriteString("\\tdriversdk \\\"github.com/NotrixInc/nx-driver-sdk\\\"\\n")
	b.WriteString(")\\n")
	b.WriteString("\\n")
	b.WriteString("func generatedEndpoints() []driversdk.Endpoint {\\n")
	b.WriteString("\\treturn []driversdk.Endpoint{\\n")
	for _, ep := range endpoints {
    endpointKey := strings.TrimSpace(ep.Key)
    if endpointKey == "" {
      endpointKey = strings.TrimSpace(ep.ID)
    }
    if endpointKey == "" {
			continue
		}
    endpointKind := strings.TrimSpace(ep.Kind)
    if endpointKind == "" {
      endpointKind = strings.TrimSpace(ep.Type)
    }
    if endpointKind == "" {
      endpointKind = "Control"
    }
    controlType := strings.TrimSpace(ep.ControlType)
    if controlType == "" {
      controlType = inferControlType(ep.ValueSchema)
    }
		b.WriteString("\\t\\t{\\n")
    b.WriteString(fmt.Sprintf("\\t\\t\\tKey: %q,\\n", endpointKey))
		b.WriteString(fmt.Sprintf("\\t\\t\\tName: %q,\\n", ep.Name))
		b.WriteString(fmt.Sprintf("\\t\\t\\tDirection: driversdk.EndpointDirection(%q),\\n", ep.Direction))
    b.WriteString(fmt.Sprintf("\\t\\t\\tKind: driversdk.EndpointKind(%q),\\n", endpointKind))
		b.WriteString(fmt.Sprintf("\\t\\t\\tConnection: driversdk.EndpointConnection(%q),\\n", ep.Connection))
		b.WriteString(fmt.Sprintf("\\t\\t\\tIcon: %q,\\n", ep.Icon))
		b.WriteString(fmt.Sprintf("\\t\\t\\tMultiBinding: %t,\\n", ep.MultiBinding))
    b.WriteString(fmt.Sprintf("\\t\\t\\tControlType: %q,\\n", controlType))
    if controlType != "" {
      b.WriteString(fmt.Sprintf("\\t\\t\\tType: %q,\\n", controlType))
		}
		if valueSchemaLiteral := rawJSONLiteral(ep.ValueSchema); valueSchemaLiteral != "" {
			b.WriteString(fmt.Sprintf("\\t\\t\\tValueSchema: %s,\\n", valueSchemaLiteral))
		}
		b.WriteString(fmt.Sprintf("\\t\\t\\tMeta: %s,\\n", mapLiteral(ep.Meta)))
		b.WriteString("\\t\\t},\\n")
	}
	b.WriteString("\\t}\\n")
	b.WriteString("}\\n")
	b.WriteString("\\n")
	b.WriteString("func generatedVariables() []driversdk.Variable {\\n")
	b.WriteString("\\treturn []driversdk.Variable{\\n")
	for _, v := range variables {
		if strings.TrimSpace(v.Key) == "" {
			continue
		}
		b.WriteString("\\t\\t{\\n")
		b.WriteString(fmt.Sprintf("\\t\\t\\tKey: %q,\\n", v.Key))
		b.WriteString(fmt.Sprintf("\\t\\t\\tType: %s,\\n", mapVariableType(v.Type)))
		b.WriteString(fmt.Sprintf("\\t\\t\\tUnit: %q,\\n", v.Unit))
		b.WriteString(fmt.Sprintf("\\t\\t\\tReadable: %t,\\n", v.Readable))
		b.WriteString(fmt.Sprintf("\\t\\t\\tWritable: %t,\\n", v.Writable))
		b.WriteString(fmt.Sprintf("\\t\\t\\tReadOnly: %t,\\n", v.ReadOnly))
		b.WriteString(fmt.Sprintf("\\t\\t\\tMeta: %s,\\n", mapLiteral(v.Meta)))
		b.WriteString("\\t\\t},\\n")
	}
	b.WriteString("\\t}\\n")
	b.WriteString("}\\n")

	formatted, err := format.Source(b.Bytes())
	if err != nil {
		return nil, fmt.Errorf("format generated code: %w", err)
	}
	return formatted, nil
}

func mapVariableType(t string) string {
	switch strings.ToLower(strings.TrimSpace(t)) {
	case "boolean":
		return "driversdk.VariableTypeBoolean"
	case "number":
		return "driversdk.VariableTypeNumber"
	case "range":
		return "driversdk.VariableTypeRange"
	case "password":
		return "driversdk.VariableTypePassword"
	case "image":
		return "driversdk.VariableTypeImage"
	case "video":
		return "driversdk.VariableTypeVideo"
	case "text":
		fallthrough
	default:
		return "driversdk.VariableTypeText"
	}
}

func rawJSONLiteral(value any) string {
	if value == nil {
		return ""
	}

	bytes, err := json.Marshal(value)
	if err != nil {
		return ""
	}

	return fmt.Sprintf("json.RawMessage(%q)", string(bytes))
}

func mapLiteral(values map[string]string) string {
	if len(values) == 0 {
		return "map[string]string{}"
	}

	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%q: %q", key, values[key]))
	}

	return fmt.Sprintf("map[string]string{%s}", strings.Join(parts, ", "))
}

func inferControlType(valueSchema any) string {
  record, ok := valueSchema.(map[string]any)
  if !ok {
    return "button"
  }

  typeName, _ := record["type"].(string)
  switch strings.ToLower(strings.TrimSpace(typeName)) {
  case "boolean":
    return "switch"
  case "number", "integer":
    return "dimmer"
  default:
    return "button"
  }
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err.Error())
	os.Exit(1)
}
`;
  }
}
