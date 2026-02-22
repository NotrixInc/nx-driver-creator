import * as vscode from 'vscode';
import { DriverTemplateService } from './services/driverTemplateService';
import { DriverSdkService } from './services/driverSdkService';
import { DriverPackagerService } from './services/driverPackagerService';
import { DriverTreeProvider, DriverTreeItem } from './providers/driverTreeProvider';
import { TemplatePickerProvider } from './providers/templatePickerProvider';
import { createDriverCommand } from './commands/createDriver';
import {
  packageDriverCommand,
  verifyPackageCommand,
  buildDriverCommand,
  runDriverCommand,
} from './commands/packageDriver';
import {
  editManifestCommand,
  addEndpointCommand,
  addVariableCommand,
  addEventCommand,
  addCapabilityCommand,
  enableSpecgenCommand,
} from './commands/selectTemplate';
import { log, getOutputChannel } from './utils';

/**
 * Extension activation — called when the extension is first loaded.
 */
export function activate(context: vscode.ExtensionContext): void {
  try {
    log('NX Driver Creator extension activating...');
    void vscode.window.showInformationMessage('NX Driver Creator activated');

  // ─── Services ──────────────────────────────────────────────────────
  const templateService = new DriverTemplateService();
  const sdkService = new DriverSdkService();
  const packagerService = new DriverPackagerService();

  // ─── TreeView Provider ─────────────────────────────────────────────
  const treeProvider = new DriverTreeProvider();
  const treeView = vscode.window.createTreeView('nxDriverTree', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ─── Template Picker Webview ──────────────────────────────────────
  const templatePickerProvider = new TemplatePickerProvider(
    context.extensionUri,
    templateService
  );

  // ─── Register Commands ────────────────────────────────────────────
  context.subscriptions.push(
    // Create new driver (wizard)
    vscode.commands.registerCommand('nxDriver.createDriver', () =>
      createDriverCommand(templateService, sdkService)
    ),

    // Package driver
    vscode.commands.registerCommand('nxDriver.packageDriver', (item?: DriverTreeItem) =>
      packageDriverCommand(packagerService, sdkService, item?.project?.rootPath)
    ),

    // Verify package
    vscode.commands.registerCommand('nxDriver.verifyPackage', () =>
      verifyPackageCommand(packagerService)
    ),

    // Build driver
    vscode.commands.registerCommand('nxDriver.buildDriver', (item?: DriverTreeItem) =>
      buildDriverCommand(sdkService, item?.project?.rootPath)
    ),

    // Run driver locally
    vscode.commands.registerCommand('nxDriver.runDriver', (item?: DriverTreeItem) =>
      runDriverCommand(sdkService, item?.project?.rootPath)
    ),

    // Edit manifest
    vscode.commands.registerCommand('nxDriver.editManifest', (item?: DriverTreeItem) =>
      editManifestCommand(item?.project?.rootPath)
    ),

    // Add endpoint
    vscode.commands.registerCommand('nxDriver.addEndpoint', (item?: DriverTreeItem) =>
      addEndpointCommand(item?.project?.rootPath)
    ),

    // Add variable
    vscode.commands.registerCommand('nxDriver.addVariable', (item?: DriverTreeItem) =>
      addVariableCommand(item?.project?.rootPath)
    ),

    // Add event
    vscode.commands.registerCommand('nxDriver.addEvent', (item?: DriverTreeItem) =>
      addEventCommand(item?.project?.rootPath)
    ),

    // Add capability
    vscode.commands.registerCommand('nxDriver.addCapability', (item?: DriverTreeItem) =>
      addCapabilityCommand(item?.project?.rootPath)
    ),

    // Enable spec generation
    vscode.commands.registerCommand('nxDriver.enableSpecgen', (item?: DriverTreeItem) =>
      enableSpecgenCommand(sdkService, item?.project?.rootPath)
    ),

    // Refresh explorer
    vscode.commands.registerCommand('nxDriver.refreshExplorer', () =>
      treeProvider.refresh()
    ),

    // Output channel
    getOutputChannel()
  );

  // ─── File System Watcher for manifest.json changes ───────────────
  const manifestWatcher = vscode.workspace.createFileSystemWatcher('**/manifest.json');
  manifestWatcher.onDidChange(() => treeProvider.refresh());
  manifestWatcher.onDidCreate(() => treeProvider.refresh());
  manifestWatcher.onDidDelete(() => treeProvider.refresh());
  context.subscriptions.push(manifestWatcher);

  // ─── Also watch endpoints.json and variables.schema.json ─────────
  const endpointsWatcher = vscode.workspace.createFileSystemWatcher('**/endpoints.json');
  endpointsWatcher.onDidChange(() => treeProvider.refresh());
  context.subscriptions.push(endpointsWatcher);

  const variablesWatcher = vscode.workspace.createFileSystemWatcher('**/variables.schema.json');
  variablesWatcher.onDidChange(() => treeProvider.refresh());
  context.subscriptions.push(variablesWatcher);

  const capabilitiesWatcher = vscode.workspace.createFileSystemWatcher('**/capabilities.json');
  capabilitiesWatcher.onDidChange(() => treeProvider.refresh());
  context.subscriptions.push(capabilitiesWatcher);

  const eventsWatcher = vscode.workspace.createFileSystemWatcher('**/events.json');
  eventsWatcher.onDidChange(() => treeProvider.refresh());
  context.subscriptions.push(eventsWatcher);

    // ─── Initial refresh ─────────────────────────────────────────────
    treeProvider.refresh();

    log('NX Driver Creator extension activated.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[NX Driver Creator] activation failed:', error);
    log(`Activation failed: ${message}`);
    void vscode.window.showErrorMessage(`NX Driver Creator activation failed: ${message}`);
    throw error;
  }
}

/**
 * Extension deactivation.
 */
export function deactivate(): void {
  log('NX Driver Creator extension deactivated.');
}
