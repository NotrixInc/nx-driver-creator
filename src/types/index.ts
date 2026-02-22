/**
 * Core types for the NX Driver Creator extension.
 * These mirror the nx-driver-sdk Go types for TypeScript usage.
 */

// ─── Driver Types ───────────────────────────────────────────────────

export type DriverType = 'DEVICE' | 'HUB' | 'CHILD' | 'UI';

export type Topology = 'DIRECT_IP' | 'VIA_HUB';

export type Protocol = 'IP' | 'ZIGBEE' | 'IR' | 'RS485' | 'MODBUS' | 'OTHER';

export type HealthStatus = 'OK' | 'DEGRADED' | 'DOWN';

// ─── Endpoint Types ────────────────────────────────────────────────

export type EndpointDirection = 'Input' | 'Output' | 'BIDIR';

export type EndpointKind = 'Audio' | 'Video' | 'Control';

export type EndpointConnection =
  | 'HDMI' | 'VGA' | 'Component' | 'Composite'
  | 'Stereo' | 'Speaker' | 'Digital_Optical' | 'Digital_Coax'
  | 'IR' | 'IP' | 'ZigBee' | 'RS485' | 'Serial'
  | 'Relay' | 'Contact' | 'DC_Dimmer' | 'Analog' | 'Digital'
  | 'ZWave' | 'Bluetooth';

export type ControlType =
  | 'dimmer' | 'switch' | 'cct' | 'color'
  | 'level' | 'position' | 'temperature' | 'humidity'
  | 'motion' | 'contact' | 'text' | 'select' | 'button' | 'relay' | 'ir';

export type EventSeverity = 'INFO' | 'WARNING' | 'ERROR';

export type VariableType = 'Boolean' | 'Number' | 'Range' | 'Text' | 'Password' | 'Image' | 'Video';

// ─── Manifest ──────────────────────────────────────────────────────

export interface DriverManifest {
  /** Reverse-DNS identifier, e.g. "com.vendor.product" */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semver version */
  version: string;
  /** Driver archetype */
  driver_type: DriverType;
  /** Device type identifiers used by controller-core (e.g. "DC_Dimmer", "Switch") */
  device_types?: string[];
  /** Controller-core capability tags (e.g. "control", "telemetry", "dimming") */
  capabilities?: string[];
  /** Supported topologies */
  supported_topologies: Topology[];
  /** Supported protocols */
  protocols: Protocol[];
  /** Entrypoint definition */
  entrypoint: EntrypointConfig;
  /** Hub dependency (child drivers only) */
  requires_hub?: HubRequirement[];
}

export interface EntrypointConfig {
  runtime: string;
  path: string;
}

export interface HubRequirement {
  hub_driver_id: string;
  min_version: string;
}

// ─── Endpoint Definition ────────────────────────────────────────────

export interface EndpointDefinition {
  key?: string;
  id?: string;
  name: string;
  direction: EndpointDirection;
  kind?: EndpointKind;
  type?: EndpointKind;
  connection: EndpointConnection;
  icon?: string;
  multi_binding?: boolean;
  control_type?: ControlType;
  value_schema?: Record<string, unknown>;
  meta?: Record<string, string>;
}

export interface EndpointsFileSchema {
  endpoints: EndpointDefinition[];
}

// ─── Variable Definition ────────────────────────────────────────────

export interface VariableDefinition {
  key: string;
  type: VariableType;
  unit?: string;
  readable: boolean;
  writable: boolean;
  read_only: boolean;
  meta?: Record<string, string>;
}

export interface VariablesFileSchema {
  variables: VariableDefinition[];
}

export interface EventDefinition {
  type: string;
  name: string;
  description?: string;
  severity: EventSeverity;
}

export interface EventsFileSchema {
  schema_version: number;
  events: EventDefinition[];
}

// ─── Driver Project ─────────────────────────────────────────────────

export interface DriverProject {
  /** Root directory of the driver project */
  rootPath: string;
  /** Parsed manifest */
  manifest: DriverManifest;
  /** Parsed endpoints from endpoints.json (if present) */
  endpoints?: EndpointDefinition[];
  /** Parsed variables from variables.schema.json (if present) */
  variables?: VariableDefinition[];
  /** Config schema from config.schema.json (if present) */
  configSchema?: Record<string, unknown>;
  /** Capabilities from capabilities.json (if present) */
  capabilities?: Record<string, unknown>;
  /** Events from events.json (if present) */
  events?: EventsFileSchema;
}

// ─── Template Selection ─────────────────────────────────────────────

export type TemplateType = 'device' | 'hub' | 'child';

export interface TemplateInfo {
  type: TemplateType;
  label: string;
  description: string;
  /** Source directory name in templates repo */
  sourceDir: string;
}

// ─── Create Driver Wizard Input ─────────────────────────────────────

export interface CreateDriverInput {
  /** Template to scaffold from */
  template: TemplateType;
  /** Driver ID in reverse-DNS format */
  driverId: string;
  /** Human-readable name */
  driverName: string;
  /** Initial version */
  version: string;
  /** Go module path */
  modulePath: string;
  /** Target directory for the new project */
  targetDir: string;
  /** Protocols the driver uses */
  protocols: Protocol[];
  /** Topologies the driver supports */
  topologies: Topology[];
  /** Hub requirement (child drivers only) */
  hubRequirement?: HubRequirement;
  /** Device type identifiers for controller-core (e.g. "DC_Dimmer", "Switch") */
  deviceTypes: string[];
  /** Capability tags for controller-core (e.g. "control", "telemetry") */
  capabilities: string[];
}

// ─── Extension Configuration ────────────────────────────────────────

export interface ExtensionConfig {
  sdkPath: string;
  templatesPath: string;
  packagerPath: string;
  defaultVendor: string;
  goPath: string;
  autoDetectProjects: boolean;
  preBuildSyncCommand: string;
  packageTargetOs: string;
  packageTargetArch: string;
  runPromptForEnv: boolean;
  runCoreGrpcAddr: string;
  runExternalDeviceKey: string;
}
