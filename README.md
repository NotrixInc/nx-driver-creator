# NX Driver Creator

A VS Code extension for creating, scaffolding, building, and packaging Notrix drivers using the **nx-driver-sdk**, **nx-driver-templates**, and **nx-driver-packager**.

## Features

### Create New Drivers

Use the **Create New Driver** wizard to scaffold a driver project from one of three templates:

| Template | Source Directory | Description |
|----------|-----------------|-------------|
| **Device Driver** | `driver-template-go` | Standalone driver communicating directly with a device over IP |
| **Hub Driver** | `driver-template-hub-go` | Driver that manages child devices via `DiscoverChildren` + `ProxyCommand` |
| **Child Driver** | `driver-template-child-go` | Driver that connects through a hub via `BindHub` |

The wizard walks you through:

1. **Template selection** — choose device, hub, or child
2. **Driver ID** — reverse-DNS identifier (e.g. `com.vendor.product`)
3. **Display name** — human-readable name
4. **Version** — initial semver version
5. **Protocols & topologies** — IP, ZigBee, RS485, Modbus, IR, etc., plus `DIRECT_IP` / `VIA_HUB` topologies
6. **Device types & capabilities** — controller-core device type identifiers and capability tags
7. **Hub requirement** — hub driver dependency (child template only)
8. **Target directory** — where to create the project

After scaffolding, the extension automatically sets up a local SDK `replace` directive in `go.mod` and runs `go mod tidy`.

### Build, Package & Run

- **Build Driver** — compiles the Go binary for the native platform (`go build -o bin/driver ./cmd/driver`)
- **Package Driver** — cross-compiles for the target OS/arch (default `linux/amd64`, `CGO_ENABLED=0`), then packages into an `.nxpkg` archive using `nx-driver-packager`. Prompts for a patch-version bump before packaging since the controller skips re-install for identical `(id, version)` pairs. Validates `variables.schema.json` and `config.schema.json` schemas before packing.
- **Verify Package** — validates an `.nxpkg` package's integrity, optionally comparing it against the source project
- **Run Driver Locally** — builds the driver, then launches it in a VS Code terminal with `CORE_GRPC_ADDR` and `EXTERNAL_DEVICE_KEY` environment variables. Prompts for a device ID, config file, and runtime environment.

All build, package, and run commands execute the configurable pre-build sync command first (default: `go generate ./...`), so changes in `endpoints.json`, `variables.schema.json`, `capabilities.json`, and `events.json` are always applied before compilation.

### Manage Endpoints, Variables, Events & Capabilities

Interactive wizards for editing driver project spec files directly from the Command Palette or tree context menu:

- **Add Endpoint** — add an endpoint to `endpoints.json` (key, name, direction, kind, connection type, control type)
- **Add Variable** — add a variable to `variables.schema.json` (key, type, unit, readable/writable/read-only access)
- **Add Event** — add an event to `events.json` (type, name, description, severity)
- **Add Capability** — add a boolean capability to `capabilities.json`
- **Edit Manifest** — open `manifest.json` directly in the editor

### Enable Spec Generation (Legacy Bootstrap)

The **Enable Spec Generation** command bootstraps `cmd/specgen/main.go` — a Go code generator that reads `endpoints.json` and `variables.schema.json` and outputs `specs_gen.go` with `generatedEndpoints()` / `generatedVariables()` functions. It rewires the `driver.go` `Endpoints()` and `Variables()` methods to use the generated code, then runs `go generate ./...`.

This is intended for legacy drivers that still hardcode descriptor methods. For new projects scaffolded by this extension, `go generate` directives are already in place.

### Explorer Sidebar

The **NX Drivers** panel in the activity bar provides:

- Auto-detection of all driver projects in the workspace (via `manifest.json`)
- Tree nodes for endpoints, variables, capabilities, events, and configuration files with item counts
- Distinct icons per driver type (DEVICE, HUB, CHILD, UI)
- Click to open any configuration file
- Right-click context menu for build, package, run, and spec management
- File watchers that automatically refresh the tree when `manifest.json`, `endpoints.json`, `variables.schema.json`, `capabilities.json`, or `events.json` change

### Template Picker Webview

A sidebar webview panel renders styled template cards for each driver type. Clicking a card or the **Create Driver** button starts the creation wizard. The panel also links to the nx-driver-sdk documentation.

## Requirements

- **VS Code 1.85+**
- **Go 1.22+** — for building drivers
- **nx-driver-templates** — template repository (resolved from config, workspace folder, sibling directories, or parent-chain walk)
- **nx-driver-packager** — packaging tool (resolved the same way, or built from source automatically)
- **nx-driver-sdk** — driver SDK (referenced via Go modules; local `replace` directive set up during scaffolding)

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `nxDriver.sdkPath` | `""` | Path to the nx-driver-sdk repository (for local `replace` directives) |
| `nxDriver.templatesPath` | `""` | Path to the nx-driver-templates repository |
| `nxDriver.packagerPath` | `""` | Path to the nx-driver-packager binary or repository |
| `nxDriver.defaultVendor` | `"com.example"` | Default vendor prefix for reverse-DNS driver IDs |
| `nxDriver.goPath` | `"go"` | Path to the Go binary |
| `nxDriver.autoDetectProjects` | `true` | Automatically detect driver projects in the workspace |
| `nxDriver.preBuildSyncCommand` | `"go generate ./..."` | Command run before every build/package/run to regenerate code from JSON specs. Supports `${goPath}` and `${projectDir}` placeholders |
| `nxDriver.packageTargetOs` | `"linux"` | Target OS for cross-compiled package builds |
| `nxDriver.packageTargetArch` | `"amd64"` | Target architecture for cross-compiled package builds |
| `nxDriver.runPromptForEnv` | `true` | Prompt for `CORE_GRPC_ADDR` and `EXTERNAL_DEVICE_KEY` when running a driver locally |
| `nxDriver.runCoreGrpcAddr` | `"127.0.0.1:50051"` | Default `CORE_GRPC_ADDR` value for local driver runs |
| `nxDriver.runExternalDeviceKey` | `""` | Default `EXTERNAL_DEVICE_KEY` value for local driver runs |

## Commands

All commands are accessible via the Command Palette (`Ctrl+Shift+P`) and, where applicable, from the NX Drivers tree context menu:

| Command | Description |
|---------|-------------|
| `NX Driver: Create New Driver` | Launch the driver creation wizard |
| `NX Driver: Build Driver` | Build the selected driver project |
| `NX Driver: Package Driver (.nxpkg)` | Cross-compile, version-bump, and package into `.nxpkg` |
| `NX Driver: Verify Package` | Verify a `.nxpkg` package |
| `NX Driver: Run Driver Locally` | Build and run with environment configuration |
| `NX Driver: Edit Manifest` | Open `manifest.json` in the editor |
| `NX Driver: Add Endpoint` | Add an endpoint interactively |
| `NX Driver: Add Variable` | Add a variable interactively |
| `NX Driver: Add Event` | Add an event interactively |
| `NX Driver: Add Capability` | Add a capability interactively |
| `NX Driver: Enable Spec Generation` | Bootstrap `specgen` for legacy drivers |
| `NX Driver: Refresh Explorer` | Refresh the driver project tree |

## Getting Started

1. Ensure **Go 1.22+** is installed and the `nx-driver-templates` repository is accessible (in the workspace, a sibling directory, or configured via `nxDriver.templatesPath`)
2. Open VS Code with your workspace
3. Run **NX Driver: Create New Driver** from the Command Palette (`Ctrl+Shift+P`)
4. Follow the wizard to select a template, enter driver metadata, and choose a target directory
5. Implement your device protocol in `internal/driver/`
6. Define endpoints, variables, events, and capabilities using the interactive wizards or by editing the JSON files directly
7. Run **NX Driver: Build Driver** to compile
8. Run **NX Driver: Package Driver** to create the `.nxpkg` package
9. Run **NX Driver: Verify Package** to validate the package before deployment

## Generated Project Structure

Scaffolded driver projects follow this structure:

```
your-driver/
├── manifest.json           # Package manifest (id, name, version, driver_type, entrypoint)
├── capabilities.json       # Driver capabilities specification
├── config.schema.json      # JSON Schema for driver configuration
├── endpoints.json          # Endpoint definitions
├── events.json             # Event definitions
├── variables.schema.json   # Variable definitions
├── go.mod / go.sum         # Go module files
├── Makefile                # Build convenience targets
├── cmd/driver/main.go      # CLI entrypoint
├── internal/driver/
│   ├── driver.go           # Driver implementation (Endpoints, Variables, lifecycle)
│   ├── config.go           # Typed configuration struct
│   └── httpclient.go       # Protocol client (device template)
└── bin/driver              # Compiled binary (created by build)
```

## Development

```bash
# Install dependencies
npm install

# Compile the extension
npm run compile

# Watch for changes during development
npm run watch

# Launch the Extension Development Host
# Press F5 in VS Code, or run:
npm run devhost

# Run tests
npm test
```

## Architecture

```
src/
├── extension.ts                        # Activation, service wiring, command registration, file watchers
├── commands/
│   ├── createDriver.ts                 # Multi-step driver creation wizard
│   ├── packageDriver.ts               # Build, package, verify, and run commands
│   └── selectTemplate.ts              # Endpoint/variable/event/capability wizards, manifest editing, specgen bootstrap
├── providers/
│   ├── driverTreeProvider.ts           # TreeDataProvider for the NX Drivers sidebar
│   └── templatePickerProvider.ts       # WebviewViewProvider for the template picker panel
├── services/
│   ├── driverPackagerService.ts        # nx-driver-packager integration (pack, verify, binary resolution)
│   ├── driverSdkService.ts            # Go build, cross-compile, run, mod tidy, specgen bootstrap
│   └── driverTemplateService.ts        # Template discovery, scaffolding, placeholder replacement
├── types/
│   └── index.ts                        # TypeScript type definitions mirroring nx-driver-sdk Go types
└── utils/
    └── index.ts                        # Config loading, project discovery, validation, shell helpers, file copy
```

## License

MIT
