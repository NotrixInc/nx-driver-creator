import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DriverPackagerService } from '../services/driverPackagerService';
import { DriverSdkService } from '../services/driverSdkService';
import { findDriverProjects, getExtensionConfig, log } from '../utils';

/**
 * Command: Package a driver project into an .nxpkg file.
 * Builds the driver first, then packages it.
 */
export async function packageDriverCommand(
  packagerService: DriverPackagerService,
  sdkService: DriverSdkService,
  projectPath?: string
): Promise<void> {
  // Resolve the project directory
  const projectDir = projectPath || (await selectDriverProject());
  if (!projectDir) {
    return;
  }

  // Prompt to bump version before packaging.
  // The controller skips re-installing a driver when the same (id, version) is
  // already present and the binary is compatible — meaning any file changes
  // (config.schema.json, capabilities.json, etc.) would be silently ignored.
  const shouldContinue = await promptVersionBump(projectDir);
  if (!shouldContinue) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Packaging NX Driver...',
      cancellable: false,
    },
    async (progress) => {
      // Step 1: Build
      progress.report({ message: 'Building driver...' });
      const buildResult = await sdkService.buildDriverForPackaging(projectDir);

      if (!buildResult.success) {
        vscode.window.showErrorMessage(`Build failed:\n${buildResult.output}`);
        return;
      }

      // Step 2: Package
      progress.report({ message: 'Creating .nxpkg package...' });
      const packageResult = await packagerService.packageDriver(projectDir);

      if (packageResult.success) {
        const action = await vscode.window.showInformationMessage(
          `Package created: ${path.basename(packageResult.packagePath || '')}`,
          'Open Containing Folder',
          'Verify Package'
        );

        if (action === 'Open Containing Folder' && packageResult.packagePath) {
          await vscode.commands.executeCommand(
            'revealFileInOS',
            vscode.Uri.file(packageResult.packagePath)
          );
        } else if (action === 'Verify Package' && packageResult.packagePath) {
          await verifyPackageCommand(packagerService, packageResult.packagePath, projectDir);
        }
      } else {
        vscode.window.showErrorMessage(`Packaging failed:\n${packageResult.output}`);
      }
    }
  );
}

/**
 * Command: Verify an .nxpkg package file.
 */
export async function verifyPackageCommand(
  packagerService: DriverPackagerService,
  packagePath?: string,
  sourceDir?: string
): Promise<void> {
  // Select package file
  if (!packagePath) {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'NX Driver Package': ['nxpkg'] },
      title: 'Select .nxpkg package to verify',
    });

    if (!fileUri || fileUri.length === 0) {
      return;
    }
    packagePath = fileUri[0].fsPath;
  }

  // Optionally select source directory for comparison
  if (!sourceDir) {
    const compareAction = await vscode.window.showQuickPick(
      [
        { label: 'Verify Only', description: 'Check package integrity', compare: false },
        { label: 'Verify & Compare', description: 'Also compare against source directory', compare: true },
      ],
      { placeHolder: 'How would you like to verify?' }
    );

    if (!compareAction) {
      return;
    }

    if (compareAction.compare) {
      const dirUri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Select source directory to compare against',
      });
      sourceDir = dirUri?.[0]?.fsPath;
    }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Verifying package...',
      cancellable: false,
    },
    async () => {
      const result = await packagerService.verifyPackage(packagePath!, sourceDir);

      if (result.success) {
        vscode.window.showInformationMessage(result.output);
      } else {
        vscode.window.showErrorMessage(`Verification failed:\n${result.output}`);
      }
    }
  );
}

/**
 * Command: Build a driver project.
 */
export async function buildDriverCommand(
  sdkService: DriverSdkService,
  projectPath?: string
): Promise<void> {
  const projectDir = projectPath || (await selectDriverProject());
  if (!projectDir) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Building NX Driver...',
      cancellable: false,
    },
    async () => {
      const result = await sdkService.buildDriver(projectDir);
      if (result.success) {
        vscode.window.showInformationMessage(result.output);
      } else {
        vscode.window.showErrorMessage(`Build failed:\n${result.output}`);
      }
    }
  );
}

/**
 * Command: Run a driver locally.
 */
export async function runDriverCommand(
  sdkService: DriverSdkService,
  projectPath?: string
): Promise<void> {
  const projectDir = projectPath || (await selectDriverProject());
  if (!projectDir) {
    return;
  }

  // Ask for device ID
  const deviceId = await vscode.window.showInputBox({
    prompt: 'Enter a test device ID (UUID)',
    value: generateTestUUID(),
    placeHolder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  });

  if (!deviceId) {
    return;
  }

  const configPath = await resolveRunConfigPath(projectDir);
  if (!configPath) {
    return;
  }

  const configReady = await validateRuntimeConfig(configPath);
  if (!configReady) {
    return;
  }

  const runEnv = await resolveRunEnvironment(configPath, deviceId);
  if (!runEnv) {
    return;
  }

  // Build first
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Building driver...',
      cancellable: false,
    },
    async () => {
      const buildResult = await sdkService.buildDriver(projectDir);
      if (!buildResult.success) {
        vscode.window.showErrorMessage(`Build failed:\n${buildResult.output}`);
        throw new Error('Build failed');
      }
    }
  );

  // Run in terminal
  const runCmd = await sdkService.getRunCommand(projectDir, deviceId, configPath);
  const terminal = vscode.window.createTerminal({
    name: `NX Driver: ${path.basename(projectDir)}`,
    cwd: projectDir,
    env: {
      CORE_GRPC_ADDR: runEnv.coreGrpcAddr,
      CONTROLLER_CORE_GRPC_ADDR: runEnv.coreGrpcAddr,
      EXTERNAL_DEVICE_KEY: runEnv.externalDeviceKey,
    },
  });
  terminal.show();
  terminal.sendText(runCmd);
}

/**
 * Prompt the user to optionally bump the patch version in manifest.json before
 * packaging.  Returns false only if the user explicitly cancels the prompt.
 *
 * Background: the controller skips re-installing a driver when `(id, version)`
 * already exists on disk and the binary matches the host. Any file changes
 * (config.schema.json, variables.schema.json, etc.) in a same-version package
 * are therefore silently ignored.  Bumping the patch version forces a fresh
 * extraction of every file in the package.
 */
async function promptVersionBump(projectDir: string): Promise<boolean> {
  const manifestPath = path.join(projectDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return true; // No manifest — let the packager deal with it
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return true; // Can't parse — proceed anyway
  }

  const currentVersion = (typeof manifest.version === 'string' ? manifest.version : '').trim();
  if (!currentVersion) {
    return true;
  }

  const nextPatch = bumpPatchVersion(currentVersion);

  const pick = await vscode.window.showQuickPick(
    [
      {
        label: `$(arrow-up) Bump to ${nextPatch}`,
        description: 'Recommended — forces the controller to re-install all package files',
        action: 'bump' as const,
      },
      {
        label: `$(package) Keep ${currentVersion}`,
        description: 'The controller may skip re-installing if this version is already present',
        action: 'keep' as const,
      },
    ],
    {
      title: 'NX Driver: Package Version',
      placeHolder: `Current version is ${currentVersion}. Bump before packaging?`,
    }
  );

  if (!pick) {
    return false; // User dismissed — cancel
  }

  if (pick.action === 'bump') {
    manifest.version = nextPatch;
    try {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
      log(`Bumped manifest version ${currentVersion} → ${nextPatch}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to update manifest.json: ${err}`);
      return false;
    }
  }

  return true;
}

function bumpPatchVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length < 3) {
    // e.g. "1.0" → "1.0.1"
    return `${version}.1`;
  }
  const patch = parseInt(parts[2], 10);
  if (isNaN(patch)) {
    return version; // Non-numeric patch — don't touch it
  }
  parts[2] = String(patch + 1);
  return parts.join('.');
}

/**
 * Prompt user to select a driver project from workspace.
 */
async function selectDriverProject(): Promise<string | undefined> {
  const projects = await findDriverProjects();

  if (projects.length === 0) {
    vscode.window.showWarningMessage(
      'No NX driver projects found in workspace. Create one with "NX Driver: Create New Driver".'
    );
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

/**
 * Generate a test UUID for local development.
 */
function generateTestUUID(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const seg = (len: number) => Array.from({ length: len }, hex).join('');
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${seg(4)}-${seg(12)}`;
}

async function resolveRunConfigPath(projectDir: string): Promise<string | undefined> {
  const candidates = [
    path.join(projectDir, 'config.local.json'),
    path.join(projectDir, 'config.json'),
    path.join(projectDir, 'driver.config.json'),
  ];

  const existing = candidates.find(filePath => fs.existsSync(filePath));
  if (existing) {
    return existing;
  }

  const action = await vscode.window.showQuickPick(
    [
      {
        label: 'Create config.local.json',
        description: 'Create an empty local config file in the driver project',
        value: 'create',
      },
      {
        label: 'Select existing config file...',
        description: 'Choose a JSON config file from disk',
        value: 'select',
      },
    ],
    {
      title: 'Run Driver — Config File',
      placeHolder: 'Driver runtime requires -config <path>',
    }
  );

  if (!action) {
    return undefined;
  }

  if (action.value === 'create') {
    const configPath = path.join(projectDir, 'config.local.json');

    const ip = await vscode.window.showInputBox({
      title: 'Run Driver — Device IP',
      prompt: 'Enter device IP address for local run',
      placeHolder: '192.168.1.50',
      validateInput: value => value?.trim() ? undefined : 'IP is required',
    });

    if (!ip) {
      return undefined;
    }

    const initialConfig = {
      ip: ip.trim(),
      port: 80,
      username: '',
      password: '',
    };
    fs.writeFileSync(configPath, `${JSON.stringify(initialConfig, null, 2)}\n`, 'utf-8');
    log(`Created local run config: ${configPath}`);
    return configPath;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(projectDir),
    filters: { 'JSON files': ['json'] },
    title: 'Select driver config file',
  });

  const selectedPath = picked?.[0]?.fsPath;
  if (!selectedPath) {
    return undefined;
  }

  if (path.basename(selectedPath).toLowerCase() === 'config.schema.json') {
    vscode.window.showErrorMessage('config.schema.json is a schema, not a runtime config. Select config.local.json/config.json instead.');
    return undefined;
  }

  return selectedPath;
}

async function validateRuntimeConfig(configPath: string): Promise<boolean> {
  const fileName = path.basename(configPath).toLowerCase();
  if (fileName === 'config.schema.json') {
    vscode.window.showErrorMessage('Cannot run with config.schema.json. Use a runtime config file with concrete values.');
    return false;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    if (typeof parsed.ip === 'string' && parsed.ip.trim()) {
      return true;
    }

    const action = await vscode.window.showErrorMessage(
      'config.ip is required for runtime. Please set a valid ip in your config file.',
      'Open Config',
      'Run Anyway'
    );

    if (action === 'Open Config') {
      const doc = await vscode.workspace.openTextDocument(configPath);
      await vscode.window.showTextDocument(doc);
      return false;
    }

    return action === 'Run Anyway';
  } catch {
    vscode.window.showErrorMessage('Selected config file is not valid JSON.');
    return false;
  }
}

async function resolveRunEnvironment(
  configPath: string,
  deviceId: string
): Promise<{ coreGrpcAddr: string; externalDeviceKey: string } | undefined> {
  const extensionConfig = getExtensionConfig();

  const defaultCoreGrpcAddr = extensionConfig.runCoreGrpcAddr
    || process.env.CORE_GRPC_ADDR
    || process.env.CONTROLLER_CORE_GRPC_ADDR
    || '127.0.0.1:50051';

  const inferredExternalKey = inferExternalDeviceKeyFromConfig(configPath);
  const defaultExternalDeviceKey = extensionConfig.runExternalDeviceKey
    || process.env.EXTERNAL_DEVICE_KEY
    || inferredExternalKey
    || `device:${deviceId}`;

  if (!extensionConfig.runPromptForEnv) {
    return {
      coreGrpcAddr: defaultCoreGrpcAddr.trim() || '127.0.0.1:50051',
      externalDeviceKey: defaultExternalDeviceKey.trim() || `device:${deviceId}`,
    };
  }

  const coreGrpcAddr = await vscode.window.showInputBox({
    title: 'Run Driver — CORE_GRPC_ADDR',
    prompt: 'Address of controller/host gRPC endpoint used by local driver run',
    value: defaultCoreGrpcAddr,
    validateInput: value => value?.trim() ? undefined : 'CORE_GRPC_ADDR is required',
  });

  if (!coreGrpcAddr) {
    return undefined;
  }

  const externalDeviceKey = await vscode.window.showInputBox({
    title: 'Run Driver — EXTERNAL_DEVICE_KEY',
    prompt: 'External device key (e.g. ip:192.168.1.50)',
    value: defaultExternalDeviceKey,
    validateInput: value => value?.trim() ? undefined : 'EXTERNAL_DEVICE_KEY is required',
  });

  if (!externalDeviceKey) {
    return undefined;
  }

  await saveRunEnvironmentSettings(coreGrpcAddr.trim(), externalDeviceKey.trim());

  return {
    coreGrpcAddr: coreGrpcAddr.trim(),
    externalDeviceKey: externalDeviceKey.trim(),
  };
}

async function saveRunEnvironmentSettings(coreGrpcAddr: string, externalDeviceKey: string): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration('nxDriver');
    await config.update('runCoreGrpcAddr', coreGrpcAddr, vscode.ConfigurationTarget.Workspace);
    await config.update('runExternalDeviceKey', externalDeviceKey, vscode.ConfigurationTarget.Workspace);
  } catch (error) {
    log(`Unable to persist run environment settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function inferExternalDeviceKeyFromConfig(configPath: string): string | undefined {
  try {
    if (!fs.existsSync(configPath)) {
      return undefined;
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    if (typeof parsed.ip === 'string' && parsed.ip.trim()) {
      return `ip:${parsed.ip.trim()}`;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
