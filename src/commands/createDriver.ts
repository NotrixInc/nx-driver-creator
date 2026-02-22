import * as vscode from 'vscode';
import * as path from 'path';
import { DriverTemplateService } from '../services/driverTemplateService';
import { DriverSdkService } from '../services/driverSdkService';
import {
  CreateDriverInput,
  TemplateType,
  Protocol,
  Topology,
  HubRequirement,
} from '../types';
import { getExtensionConfig, isValidDriverId, isValidVersion, log } from '../utils';

/**
 * Multi-step wizard command for creating a new driver project.
 */
export async function createDriverCommand(
  templateService: DriverTemplateService,
  sdkService: DriverSdkService
): Promise<void> {
  const MOD_TIDY_MAX_WAIT_MS = 20000;
  // Step 1: Select template type
  const templates = templateService.getTemplates();
  const templatePick = await vscode.window.showQuickPick(
    templates.map(t => ({
      label: t.label,
      description: t.type.toUpperCase(),
      detail: t.description,
      type: t.type,
    })),
    {
      placeHolder: 'Select a driver template',
      title: 'NX Driver Creator — Step 1/6: Template',
    }
  );

  if (!templatePick) {
    return;
  }
  const template = templatePick.type as TemplateType;

  // Step 2: Driver ID
  const config = getExtensionConfig();
  const driverId = await vscode.window.showInputBox({
    title: 'NX Driver Creator — Step 2/6: Driver ID',
    prompt: 'Enter a reverse-DNS driver ID (e.g. com.vendor.product)',
    value: `${config.defaultVendor}.`,
    validateInput: (value) => {
      if (!value) {
        return 'Driver ID is required';
      }
      if (!isValidDriverId(value)) {
        return 'Must be reverse-DNS format: com.vendor.product (lowercase, dots, at least 3 segments)';
      }
      return undefined;
    },
  });

  if (!driverId) {
    return;
  }

  // Step 3: Driver name
  const defaultName = driverId.split('.').pop() || '';
  const driverName = await vscode.window.showInputBox({
    title: 'NX Driver Creator — Step 3/6: Display Name',
    prompt: 'Enter a human-readable name for the driver',
    value: defaultName.charAt(0).toUpperCase() + defaultName.slice(1) + ' Driver',
    validateInput: (value) => value ? undefined : 'Name is required',
  });

  if (!driverName) {
    return;
  }

  // Step 4: Version
  const version = await vscode.window.showInputBox({
    title: 'NX Driver Creator — Step 4/6: Version',
    prompt: 'Enter the initial version (semver)',
    value: '0.1.0',
    validateInput: (value) => {
      if (!value) {
        return 'Version is required';
      }
      if (!isValidVersion(value)) {
        return 'Must be valid semver: X.Y.Z';
      }
      return undefined;
    },
  });

  if (!version) {
    return;
  }

  // Step 5: Protocols
  const allProtocols: Protocol[] = ['IP', 'ZIGBEE', 'IR', 'RS485', 'MODBUS', 'OTHER'];
  const defaultProtocol = template === 'child' ? 'ZIGBEE' : 'IP';
  const protocolPicks = await vscode.window.showQuickPick(
    allProtocols.map(p => ({
      label: p,
      picked: p === defaultProtocol,
    })),
    {
      placeHolder: 'Select protocols this driver uses',
      title: 'NX Driver Creator — Step 5/6: Protocols',
      canPickMany: true,
    }
  );

  if (!protocolPicks || protocolPicks.length === 0) {
    return;
  }
  const protocols = protocolPicks.map(p => p.label as Protocol);

  // Step 5b: Topology (auto-derived for child)
  let topologies: Topology[];
  if (template === 'child') {
    topologies = ['VIA_HUB'];
  } else {
    const allTopologies: Topology[] = ['DIRECT_IP', 'VIA_HUB'];
    const topoPicks = await vscode.window.showQuickPick(
      allTopologies.map(t => ({
        label: t,
        picked: t === 'DIRECT_IP',
      })),
      {
        placeHolder: 'Select supported topologies',
        title: 'NX Driver Creator — Step 5b/6: Topologies',
        canPickMany: true,
      }
    );
    if (!topoPicks || topoPicks.length === 0) {
      return;
    }
    topologies = topoPicks.map(t => t.label as Topology);
  }

  // Step 5c: Hub requirement (child only)
  let hubRequirement: HubRequirement | undefined;
  if (template === 'child') {
    const hubDriverId = await vscode.window.showInputBox({
      title: 'NX Driver Creator — Hub Requirement',
      prompt: 'Enter the hub driver ID this child requires (or leave empty)',
      placeHolder: 'com.vendor.hub-driver',
    });
    if (hubDriverId) {
      const hubMinVersion = await vscode.window.showInputBox({
        prompt: 'Minimum hub driver version required',
        value: '0.1.0',
      });
      hubRequirement = {
        hub_driver_id: hubDriverId,
        min_version: hubMinVersion || '0.1.0',
      };
    }
  }

  // Step 5d: Device type(s)
  const commonDeviceTypes = [
    'Switch', 'Dimmer', 'DC_Dimmer', 'Relay', 'Control', 'Light', 'Fan',
    'Climate', 'Thermostat', 'Sensor', 'Contact', 'Motion',
    'Camera', 'AV_Receiver', 'Display', 'Gateway', 'Other',
  ];
  const deviceTypePicks = await vscode.window.showQuickPick(
    commonDeviceTypes.map(t => ({ label: t })),
    {
      placeHolder: 'Select the device type(s) this driver manages (used by controller-core)',
      title: 'NX Driver Creator — Step 5d/6: Device Types',
      canPickMany: true,
    }
  );

  if (!deviceTypePicks || deviceTypePicks.length === 0) {
    return;
  }
  const deviceTypes = deviceTypePicks.map(p => p.label);

  // Step 5e: Capabilities
  const commonCapabilities = [
    { label: 'control', description: 'Driver accepts commands (shows Control tab)' },
    { label: 'telemetry', description: 'Driver publishes state (shows Telemetry tab)' },
    { label: 'discovery', description: 'Driver can discover child devices' },
    { label: 'events', description: 'Driver emits events' },
  ];
  const capabilityPicks = await vscode.window.showQuickPick(
    commonCapabilities.map(c => ({ label: c.label, description: c.description, picked: c.label === 'control' || c.label === 'telemetry' })),
    {
      placeHolder: 'Select capabilities (control + telemetry enable Control & Telemetry tabs)',
      title: 'NX Driver Creator — Step 5e/6: Capabilities',
      canPickMany: true,
    }
  );

  if (!capabilityPicks || capabilityPicks.length === 0) {
    return;
  }
  const capabilities = capabilityPicks.map(p => p.label);

  // Step 6: Target directory
  const targetFolderUri = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Select Parent Folder',
    title: 'NX Driver Creator — Step 6/6: Target Directory',
  });

  if (!targetFolderUri || targetFolderUri.length === 0) {
    return;
  }

  const targetDir = targetFolderUri[0].fsPath;

  // Build the Go module path
  const modulePath = `github.com/NotrixInc/${driverId.split('.').slice(1).join('-')}`;

  const input: CreateDriverInput = {
    template,
    driverId,
    driverName: driverName,
    version: version,
    modulePath,
    targetDir,
    protocols,
    topologies,
    hubRequirement,
    deviceTypes,
    capabilities,
  };

  // Execute scaffolding
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Creating NX Driver...',
      cancellable: true,
    },
    async (progress, token) => {
      try {
        progress.report({ message: 'Scaffolding from template...' });
        const projectDir = await templateService.scaffoldDriver(input);

        if (token.isCancellationRequested) { return; }

        progress.report({ message: 'Setting up SDK...' });
        await sdkService.setupLocalSdk(projectDir);

        if (token.isCancellationRequested) { return; }

        progress.report({ message: 'Running go mod tidy...' });
        const tidyResult = await Promise.race([
          sdkService.modTidy(projectDir),
          new Promise<{ success: boolean; output: string }>((resolve) => {
            setTimeout(() => {
              resolve({
                success: false,
                output: `go mod tidy warning: timed out after ${Math.floor(MOD_TIDY_MAX_WAIT_MS / 1000)}s. You can run it manually later.`,
              });
            }, MOD_TIDY_MAX_WAIT_MS);
          }),
        ]);
        if (!tidyResult.success) {
          log(`Warning: ${tidyResult.output}`);
        }

        log(`Driver created at ${projectDir}`);

        const action = await vscode.window.showInformationMessage(
          `Driver "${driverName}" created successfully!`,
          'Open in New Window',
          'Add to Workspace',
          'Open Folder'
        );

        if (action === 'Open in New Window') {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectDir), true);
        } else if (action === 'Add to Workspace') {
          vscode.workspace.updateWorkspaceFolders(
            vscode.workspace.workspaceFolders?.length || 0,
            null,
            { uri: vscode.Uri.file(projectDir), name: path.basename(projectDir) }
          );
        } else if (action === 'Open Folder') {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectDir));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to create driver: ${message}`);
        log(`Error creating driver: ${message}`);
      }
    }
  );
}
