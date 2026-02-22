import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionConfig, DriverManifest, DriverProject, EndpointDefinition, VariableDefinition, EventsFileSchema, EndpointsFileSchema, VariablesFileSchema } from '../types';

/**
 * Read extension configuration from VS Code settings.
 */
export function getExtensionConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('nxDriver');
  return {
    sdkPath: cfg.get<string>('sdkPath', ''),
    templatesPath: cfg.get<string>('templatesPath', ''),
    packagerPath: cfg.get<string>('packagerPath', ''),
    defaultVendor: cfg.get<string>('defaultVendor', 'com.example'),
    goPath: cfg.get<string>('goPath', 'go'),
    autoDetectProjects: cfg.get<boolean>('autoDetectProjects', true),
    preBuildSyncCommand: cfg.get<string>('preBuildSyncCommand', 'go generate ./...'),
    packageTargetOs: cfg.get<string>('packageTargetOs', 'linux'),
    packageTargetArch: cfg.get<string>('packageTargetArch', 'amd64'),
    runPromptForEnv: cfg.get<boolean>('runPromptForEnv', true),
    runCoreGrpcAddr: cfg.get<string>('runCoreGrpcAddr', '127.0.0.1:50051'),
    runExternalDeviceKey: cfg.get<string>('runExternalDeviceKey', ''),
  };
}

/**
 * Find all driver projects in the workspace by looking for manifest.json files.
 */
export async function findDriverProjects(): Promise<DriverProject[]> {
  const manifestUris = await vscode.workspace.findFiles('**/manifest.json', '**/node_modules/**');
  const projects: DriverProject[] = [];

  for (const uri of manifestUris) {
    try {
      const project = await loadDriverProject(path.dirname(uri.fsPath));
      if (project) {
        projects.push(project);
      }
    } catch {
      // Skip invalid manifest files
    }
  }

  return projects;
}

/**
 * Load a driver project from its root directory.
 */
export async function loadDriverProject(rootPath: string): Promise<DriverProject | null> {
  const manifestPath = path.join(rootPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as DriverManifest;

    // Normalize legacy format
    if (!manifest.id && (manifest as unknown as Record<string, unknown>)['driver_id']) {
      manifest.id = (manifest as unknown as Record<string, unknown>)['driver_id'] as string;
    }

    if (!manifest.id || !manifest.version) {
      return null;
    }

    const project: DriverProject = { rootPath, manifest };

    // Load optional files
    project.endpoints = loadEndpointDefinitions(rootPath);
    project.variables = loadVariableDefinitions(rootPath);
    project.configSchema = loadJsonFile<Record<string, unknown>>(rootPath, 'config.schema.json');
    project.capabilities = loadJsonFile<Record<string, unknown>>(rootPath, 'capabilities.json');
    project.events = loadJsonFile<EventsFileSchema>(rootPath, 'events.json');

    return project;
  } catch {
    return null;
  }
}

/**
 * Load a JSON file from a directory, returning undefined if it doesn't exist.
 */
function loadJsonFile<T>(dir: string, filename: string): T | undefined {
  const filePath = path.join(dir, filename);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    }
  } catch {
    // Ignore parse errors
  }
  return undefined;
}

function loadEndpointDefinitions(dir: string): EndpointDefinition[] | undefined {
  const parsed = loadJsonFile<EndpointDefinition[] | EndpointsFileSchema>(dir, 'endpoints.json');
  if (!parsed) {
    return undefined;
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed.endpoints)) {
    return parsed.endpoints;
  }

  return undefined;
}

function loadVariableDefinitions(dir: string): VariableDefinition[] | undefined {
  const parsed = loadJsonFile<VariableDefinition[] | VariablesFileSchema>(dir, 'variables.schema.json');
  if (!parsed) {
    return undefined;
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed.variables)) {
    return parsed.variables;
  }

  return undefined;
}

/**
 * Validate a driver ID is in reverse-DNS format.
 */
export function isValidDriverId(id: string): boolean {
  return /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){2,}$/.test(id);
}

/**
 * Validate a semver version string.
 */
export function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version);
}

/**
 * Generate a Go module path from a driver ID.
 */
export function driverIdToModulePath(driverId: string, org: string = 'github.com/NotrixInc'): string {
  const parts = driverId.split('.');
  const name = parts.slice(1).join('-');
  return `${org}/${name}`;
}

/**
 * Show an output channel message.
 */
let _outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!_outputChannel) {
    _outputChannel = vscode.window.createOutputChannel('NX Driver Creator');
  }
  return _outputChannel;
}

/**
 * Log a message to the output channel.
 */
export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  getOutputChannel().appendLine(line);
  console.log(`[NX Driver Creator] ${line}`);
}

/**
 * Execute a shell command and return stdout.
 */
export function execCommand(
  command: string,
  cwd: string,
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string }> {
  const { exec } = require('child_process');
  return new Promise((resolve, reject) => {
    exec(
      command,
      { cwd, maxBuffer: 10 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env },
      (error: Error | null, stdout: string, stderr: string) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
      }
    );
  });
}

/**
 * Execute a shell command with a timeout. Kills the process if it exceeds the timeout.
 */
export function execCommandWithTimeout(command: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const { exec } = require('child_process');
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error: Error | null, stdout: string, stderr: string) => {
      clearTimeout(timer);
      if (settled) { return; }
      settled = true;
      if (error) {
        reject(new Error(`${error.message}\n${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });

    const timer = setTimeout(() => {
      if (settled) { return; }
      settled = true;
      // On Windows, child.kill() only kills the shell, not the spawned process tree.
      // Use taskkill /T /F to force-kill the entire process tree.
      if (process.platform === 'win32' && child.pid) {
        try {
          exec(`taskkill /pid ${child.pid} /T /F`, () => {});
        } catch {
          child.kill();
        }
      } else {
        child.kill();
      }
      resolve({ stdout: '', stderr: `Command timed out after ${timeoutMs / 1000}s (this is OK — you can run 'go mod tidy' manually later)` });
    }, timeoutMs);
  });
}

/**
 * Replace template placeholders in a string.
 */
export function replacePlaceholders(content: string, replacements: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(escapeRegex(key), 'g'), value);
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Copy a directory recursively, applying placeholder replacements to text files.
 */
export async function copyDirectoryWithReplacements(
  src: string,
  dest: string,
  replacements: Record<string, string>
): Promise<void> {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'bin') {
        continue;
      }
      await copyDirectoryWithReplacements(srcPath, destPath, replacements);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      const textExts = ['.go', '.json', '.md', '.mod', '.sum', '.yaml', '.yml', '.txt', '.sh', ''];

      if (textExts.includes(ext)) {
        let content = fs.readFileSync(srcPath, 'utf-8');
        content = replacePlaceholders(content, replacements);
        fs.writeFileSync(destPath, content, 'utf-8');
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
