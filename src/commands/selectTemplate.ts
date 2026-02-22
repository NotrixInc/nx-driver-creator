import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  EndpointDefinition,
  EndpointDirection,
  EndpointKind,
  EndpointConnection,
  ControlType,
  VariableDefinition,
  VariableType,
  EventDefinition,
  EventSeverity,
} from '../types';
import { findDriverProjects, log } from '../utils';
import { DriverSdkService } from '../services/driverSdkService';

/**
 * Command: Edit the manifest.json of a driver project interactively.
 */
export async function editManifestCommand(projectPath?: string): Promise<void> {
  const projectDir = projectPath || (await selectDriverProject());
  if (!projectDir) {
    return;
  }

  const manifestPath = path.join(projectDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    vscode.window.showErrorMessage('manifest.json not found in the selected project.');
    return;
  }

  // Open the manifest in the editor with JSON language for syntax highlighting
  const doc = await vscode.workspace.openTextDocument(manifestPath);
  await vscode.window.showTextDocument(doc);
}

/**
 * Command: Add an endpoint to a driver project.
 */
export async function addEndpointCommand(projectPath?: string): Promise<void> {
  const projectDir = projectPath || (await selectDriverProject());
  if (!projectDir) {
    return;
  }

  // Gather endpoint information
  const key = await vscode.window.showInputBox({
    title: 'Add Endpoint — Key',
    prompt: 'Endpoint key (e.g. "power", "brightness", "volume")',
    validateInput: v => v ? undefined : 'Key is required',
  });
  if (!key) { return; }

  const name = await vscode.window.showInputBox({
    title: 'Add Endpoint — Name',
    prompt: 'Human-readable name',
    value: key.charAt(0).toUpperCase() + key.slice(1),
  });
  if (!name) { return; }

  const directionPick = await vscode.window.showQuickPick(
    (['Input', 'Output', 'BIDIR'] as EndpointDirection[]).map(d => ({ label: d })),
    { title: 'Add Endpoint — Direction', placeHolder: 'Select endpoint direction' }
  );
  if (!directionPick) { return; }

  const kindPick = await vscode.window.showQuickPick(
    (['Control', 'Audio', 'Video'] as EndpointKind[]).map(k => ({ label: k })),
    { title: 'Add Endpoint — Kind', placeHolder: 'Select endpoint kind' }
  );
  if (!kindPick) { return; }

  const connections: EndpointConnection[] = [
    'IP', 'HDMI', 'VGA', 'Component', 'Composite', 'Stereo', 'Speaker',
    'Digital_Optical', 'Digital_Coax', 'IR', 'ZigBee', 'RS485', 'Serial',
    'Relay', 'Contact', 'DC_Dimmer', 'Analog', 'Digital', 'ZWave', 'Bluetooth',
  ];
  const connectionPick = await vscode.window.showQuickPick(
    connections.map(c => ({ label: c })),
    { title: 'Add Endpoint — Connection', placeHolder: 'Select connection type' }
  );
  if (!connectionPick) { return; }

  const controlTypes: ControlType[] = [
    'switch', 'dimmer', 'cct', 'color', 'level', 'position',
    'temperature', 'humidity', 'motion', 'contact', 'text', 'select', 'button', 'relay', 'ir',
  ];
  const controlPick = await vscode.window.showQuickPick(
    controlTypes.map(c => ({ label: c })),
    { title: 'Add Endpoint — Control Type', placeHolder: 'Select control type' }
  );
  if (!controlPick) { return; }

  const endpoint: EndpointDefinition = {
    id: key,
    name: name,
    direction: directionPick.label as EndpointDirection,
    type: kindPick.label as EndpointKind,
    connection: connectionPick.label as EndpointConnection,
    control_type: controlPick.label as ControlType,
    multi_binding: false,
  };

  // Update endpoints.json
  const endpointsPath = path.join(projectDir, 'endpoints.json');
  const endpointsSchema = loadEndpointsSchema(endpointsPath);

  // Check for duplicate key
  if (endpointsSchema.endpoints.some(e => (e.id || e.key) === key)) {
    vscode.window.showErrorMessage(`Endpoint with key "${key}" already exists.`);
    return;
  }

  endpointsSchema.endpoints.push(endpoint);
  fs.writeFileSync(endpointsPath, JSON.stringify({ endpoints: endpointsSchema.endpoints }, null, 2), 'utf-8');

  log(`Added endpoint "${key}" to ${projectDir}`);
  vscode.window.showInformationMessage(`Endpoint "${key}" added to endpoints.json`);

  // Offer to open the file
  const action = await vscode.window.showInformationMessage(
    'Would you like to also add the endpoint to the Go source code?',
    'Open driver.go',
    'Skip'
  );

  if (action === 'Open driver.go') {
    const driverGoPath = path.join(projectDir, 'internal', 'driver', 'driver.go');
    if (fs.existsSync(driverGoPath)) {
      const doc = await vscode.workspace.openTextDocument(driverGoPath);
      await vscode.window.showTextDocument(doc);
    }
  }
}

/**
 * Command: Add a variable to a driver project.
 */
export async function addVariableCommand(projectPath?: string): Promise<void> {
  const projectDir = projectPath || (await selectDriverProject());
  if (!projectDir) {
    return;
  }

  const key = await vscode.window.showInputBox({
    title: 'Add Variable — Key',
    prompt: 'Variable key (e.g. "rssi", "temperature", "device_name")',
    validateInput: v => v ? undefined : 'Key is required',
  });
  if (!key) { return; }

  const variableTypes: VariableType[] = ['Boolean', 'Number', 'Range', 'Text', 'Password', 'Image', 'Video'];
  const typePick = await vscode.window.showQuickPick(
    variableTypes.map(t => ({ label: t })),
    { title: 'Add Variable — Type', placeHolder: 'Select variable type' }
  );
  if (!typePick) { return; }

  const unit = await vscode.window.showInputBox({
    title: 'Add Variable — Unit',
    prompt: 'Unit of measurement (e.g. "dBm", "°C", or leave empty)',
    placeHolder: 'Optional',
  });

  const readWritePick = await vscode.window.showQuickPick(
    [
      { label: 'Read Only', description: 'Sensor/status value', readable: true, writable: false, readOnly: true },
      { label: 'Read/Write', description: 'Configurable value', readable: true, writable: true, readOnly: false },
      { label: 'Write Only', description: 'Command-only value', readable: false, writable: true, readOnly: false },
    ],
    { title: 'Add Variable — Access', placeHolder: 'Select access mode' }
  );
  if (!readWritePick) { return; }

  const variable: VariableDefinition = {
    key,
    type: typePick.label as VariableType,
    unit: unit || undefined,
    readable: readWritePick.readable,
    writable: readWritePick.writable,
    read_only: readWritePick.readOnly,
  };

  // Update variables.schema.json
  const variablesPath = path.join(projectDir, 'variables.schema.json');
  const variablesSchema = loadVariablesSchema(variablesPath);

  if (variablesSchema.variables.some(v => v.key === key)) {
    vscode.window.showErrorMessage(`Variable with key "${key}" already exists.`);
    return;
  }

  variablesSchema.variables.push(variable);
  fs.writeFileSync(variablesPath, JSON.stringify({ variables: variablesSchema.variables }, null, 2), 'utf-8');

  log(`Added variable "${key}" to ${projectDir}`);
  vscode.window.showInformationMessage(`Variable "${key}" added to variables.schema.json`);
}

/**
 * Command: Add an event to a driver project.
 */
export async function addEventCommand(projectPath?: string): Promise<void> {
  const projectDir = projectPath || (await selectDriverProject());
  if (!projectDir) {
    return;
  }

  const eventType = await vscode.window.showInputBox({
    title: 'Add Event — Type',
    prompt: 'Event type (e.g. "OVER_TEMPERATURE", "DISCONNECTED", "STATE_CHANGED")',
    validateInput: v => v ? undefined : 'Type is required',
  });
  if (!eventType) { return; }

  const name = await vscode.window.showInputBox({
    title: 'Add Event — Name',
    prompt: 'Human-readable event name',
    value: eventType
      .toLowerCase()
      .split('_')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
  });
  if (!name) { return; }

  const description = await vscode.window.showInputBox({
    title: 'Add Event — Description',
    prompt: 'Description for this event',
    placeHolder: 'Optional',
  });

  const severityPick = await vscode.window.showQuickPick(
    (['INFO', 'WARNING', 'ERROR'] as EventSeverity[]).map(severity => ({ label: severity })),
    { title: 'Add Event — Severity', placeHolder: 'Select event severity' }
  );
  if (!severityPick) { return; }

  const eventsPath = path.join(projectDir, 'events.json');
  const eventsFile = loadEventsSchema(eventsPath);

  if (eventsFile.events.some(e => e.type === eventType)) {
    vscode.window.showErrorMessage(`Event with type "${eventType}" already exists.`);
    return;
  }

  const event: EventDefinition = {
    type: eventType,
    name,
    severity: severityPick.label as EventSeverity,
  };

  if (description) {
    event.description = description;
  }

  eventsFile.events.push(event);
  fs.writeFileSync(eventsPath, JSON.stringify(eventsFile, null, 2), 'utf-8');

  log(`Added event "${eventType}" to ${projectDir}`);
  vscode.window.showInformationMessage(`Event "${eventType}" added to events.json`);
}

/**
 * Command: Add a capability to a driver project.
 */
export async function addCapabilityCommand(projectPath?: string): Promise<void> {
  const projectDir = projectPath || (await selectDriverProject());
  if (!projectDir) {
    return;
  }

  const key = await vscode.window.showInputBox({
    title: 'Add Capability — Key',
    prompt: 'Capability key (e.g. "supports_discovery", "supports_streaming")',
    validateInput: v => v ? undefined : 'Key is required',
  });
  if (!key) { return; }

  const valuePick = await vscode.window.showQuickPick(
    [
      { label: 'true', value: true },
      { label: 'false', value: false },
    ],
    { title: 'Add Capability — Value', placeHolder: 'Select capability value' }
  );
  if (!valuePick) { return; }

  const capabilitiesPath = path.join(projectDir, 'capabilities.json');
  const capabilities = loadJsonObject(capabilitiesPath);

  if (Object.prototype.hasOwnProperty.call(capabilities, key)) {
    vscode.window.showErrorMessage(`Capability with key "${key}" already exists.`);
    return;
  }

  capabilities[key] = valuePick.value;
  fs.writeFileSync(capabilitiesPath, JSON.stringify(capabilities, null, 2), 'utf-8');

  log(`Added capability "${key}" to ${projectDir}`);
  vscode.window.showInformationMessage(`Capability "${key}" added to capabilities.json`);
}

function loadJsonObject(filePath: string): Record<string, unknown> {
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Return empty object for invalid JSON
    }
  }

  return {};
}

function loadEndpointsSchema(filePath: string): { endpoints: EndpointDefinition[]; isFlatArray: boolean } {
  const defaultSchema = { endpoints: [] as EndpointDefinition[], isFlatArray: false };

  if (!fs.existsSync(filePath)) {
    return defaultSchema;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (Array.isArray(parsed)) {
      return { endpoints: parsed as EndpointDefinition[], isFlatArray: true };
    }

    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.endpoints)) {
        return { endpoints: record.endpoints as EndpointDefinition[], isFlatArray: false };
      }
    }

    return defaultSchema;
  } catch {
    return defaultSchema;
  }
}

function loadVariablesSchema(filePath: string): { variables: VariableDefinition[]; isFlatArray: boolean } {
  const defaultSchema = { variables: [] as VariableDefinition[], isFlatArray: false };

  if (!fs.existsSync(filePath)) {
    return defaultSchema;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (Array.isArray(parsed)) {
      return { variables: parsed as VariableDefinition[], isFlatArray: true };
    }

    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.variables)) {
        return { variables: record.variables as VariableDefinition[], isFlatArray: false };
      }
    }

    return defaultSchema;
  } catch {
    return defaultSchema;
  }
}

function loadEventsSchema(filePath: string): { schema_version: number; events: EventDefinition[] } {
  const defaultSchema = { schema_version: 1, events: [] as EventDefinition[] };

  if (!fs.existsSync(filePath)) {
    return defaultSchema;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      return defaultSchema;
    }

    const record = parsed as Record<string, unknown>;
    const schemaVersion = typeof record.schema_version === 'number' ? record.schema_version : 1;
    const rawEvents = Array.isArray(record.events) ? record.events : [];

    const events = rawEvents
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry): EventDefinition | undefined => {
        if (typeof entry.type !== 'string' || typeof entry.name !== 'string' || typeof entry.severity !== 'string') {
          return undefined;
        }

        if (!['INFO', 'WARNING', 'ERROR'].includes(entry.severity)) {
          return undefined;
        }

        return {
          type: entry.type,
          name: entry.name,
          description: typeof entry.description === 'string' ? entry.description : undefined,
          severity: entry.severity as EventSeverity,
        };
      })
      .filter((entry): entry is EventDefinition => !!entry);

    if (events.length > 0 || Array.isArray(record.events)) {
      return {
        schema_version: schemaVersion,
        events,
      };
    }

    const legacyEvents: EventDefinition[] = Object.entries(record)
      .filter(([key]) => key !== 'schema_version')
      .map(([key, value]) => {
        const eventValue = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        const legacyName = typeof eventValue.name === 'string' ? eventValue.name : key;
        const legacyDescription = typeof eventValue.description === 'string' ? eventValue.description : undefined;
        const legacySeverity = typeof eventValue.severity === 'string' && ['INFO', 'WARNING', 'ERROR'].includes(eventValue.severity)
          ? (eventValue.severity as EventSeverity)
          : 'INFO';

        return {
          type: key,
          name: legacyName,
          description: legacyDescription,
          severity: legacySeverity,
        };
      });

    return {
      schema_version: schemaVersion,
      events: legacyEvents,
    };
  } catch {
    return defaultSchema;
  }
}

/**
 * Command: Enable spec code generation for a driver project.
 * Sets up cmd/specgen/main.go and wires Endpoints()/Variables() to use generated code.
 * After enabling, the build will auto-generate Go code from endpoints.json and variables.schema.json.
 */
export async function enableSpecgenCommand(
  sdkService: DriverSdkService,
  projectPath?: string
): Promise<void> {
  const projectDir = projectPath || (await selectDriverProject());
  if (!projectDir) {
    return;
  }

  const specGenPath = path.join(projectDir, 'cmd', 'specgen', 'main.go');
  if (fs.existsSync(specGenPath)) {
    vscode.window.showInformationMessage('Spec generation is already enabled for this project.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    'This will modify driver.go to use auto-generated Endpoints()/Variables() from JSON schemas. ' +
    'Your existing method implementations will be replaced. This cannot be undone automatically.',
    { modal: true },
    'Enable Spec Generation'
  );

  if (confirm !== 'Enable Spec Generation') {
    return;
  }

  try {
    const applied = sdkService.bootstrapLegacyJsonSync(projectDir);
    if (applied) {
      vscode.window.showInformationMessage(
        'Spec generation enabled! The next build will auto-generate Go code from endpoints.json and variables.schema.json.'
      );
      log(`Spec generation enabled for ${projectDir}`);
    } else {
      vscode.window.showWarningMessage(
        'Could not enable spec generation. Ensure the project has internal/driver/driver.go, endpoints.json, and variables.schema.json.'
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to enable spec generation: ${message}`);
  }
}

/**
 * Prompt user to select a driver project from workspace.
 */
async function selectDriverProject(): Promise<string | undefined> {
  const projects = await findDriverProjects();

  if (projects.length === 0) {
    vscode.window.showWarningMessage('No NX driver projects found in workspace.');
    return undefined;
  }

  if (projects.length === 1) {
    return projects[0].rootPath;
  }

  const pick = await vscode.window.showQuickPick(
    projects.map(p => ({
      label: p.manifest.name || p.manifest.id,
      description: `${p.manifest.id} v${p.manifest.version}`,
      detail: p.rootPath,
      rootPath: p.rootPath,
    })),
    { placeHolder: 'Select a driver project' }
  );

  return pick?.rootPath;
}
