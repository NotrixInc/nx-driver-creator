import * as path from 'path';
import * as fs from 'fs';
import { TemplateInfo, TemplateType, CreateDriverInput } from '../types';
import { getExtensionConfig, copyDirectoryWithReplacements, replacePlaceholders } from '../utils';

/**
 * Template source directory mapping.
 */
const TEMPLATES: TemplateInfo[] = [
  {
    type: 'device',
    label: 'Device Driver (Direct IP)',
    description: 'A standalone driver that communicates directly with a device over IP. Implements the Driver interface.',
    sourceDir: 'driver-template-go',
  },
  {
    type: 'hub',
    label: 'Hub Driver',
    description: 'A driver that manages child devices. Implements HubDriver interface with DiscoverChildren and ProxyCommand.',
    sourceDir: 'driver-template-hub-go',
  },
  {
    type: 'child',
    label: 'Child Driver (Via Hub)',
    description: 'A driver that connects through a hub. Implements ChildDriver interface with BindHub.',
    sourceDir: 'driver-template-child-go',
  },
];

/**
 * Service for managing driver templates and scaffolding new driver projects.
 */
export class DriverTemplateService {
  /**
   * Returns the list of available templates.
   */
  getTemplates(): TemplateInfo[] {
    return TEMPLATES;
  }

  /**
   * Get template info by type.
   */
  getTemplate(type: TemplateType): TemplateInfo | undefined {
    return TEMPLATES.find(t => t.type === type);
  }

  /**
   * Resolve the path to the templates repository.
   */
  getTemplatesRepoPath(searchFromDir?: string): string {
    const config = getExtensionConfig();
    if (config.templatesPath) {
      if (fs.existsSync(config.templatesPath)) {
        return config.templatesPath;
      }
    }
    // Try to auto-detect from workspace folders
    const workspaceFolders = require('vscode').workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        if (folder.name === 'nx-driver-templates' || folder.uri.fsPath.endsWith('nx-driver-templates')) {
          return folder.uri.fsPath;
        }
      }
      // Check sibling directories
      for (const folder of workspaceFolders) {
        const sibling = path.join(path.dirname(folder.uri.fsPath), 'nx-driver-templates');
        if (fs.existsSync(sibling)) {
          return sibling;
        }
      }
    }

    if (searchFromDir) {
      const found = this.findSiblingDirInParentChain(searchFromDir, 'nx-driver-templates', 5);
      if (found) {
        return found;
      }
    }

    return '';
  }

  /**
   * Scaffold a new driver project from a template.
   */
  async scaffoldDriver(input: CreateDriverInput): Promise<string> {
    const template = this.getTemplate(input.template);
    if (!template) {
      throw new Error(`Unknown template type: ${input.template}`);
    }

    const templatesRepo = this.getTemplatesRepoPath(input.targetDir);
    if (!templatesRepo) {
      throw new Error(
        `Cannot find nx-driver-templates near "${input.targetDir}". Set nxDriver.templatesPath in settings or add the nx-driver-templates folder to your workspace.`
      );
    }

    const templateDir = path.join(templatesRepo, template.sourceDir);
    if (!fs.existsSync(templateDir)) {
      throw new Error(`Template directory not found: ${templateDir}`);
    }

    const projectDir = path.join(input.targetDir, input.driverId.split('.').pop() || input.driverId);

    if (fs.existsSync(projectDir)) {
      throw new Error(`Target directory already exists: ${projectDir}`);
    }

    // Build placeholder replacements based on template type
    const replacements = this.buildReplacements(input, template);

    // Copy template with replacements
    await copyDirectoryWithReplacements(templateDir, projectDir, replacements);

    // Update manifest.json with actual driver info
    await this.updateManifest(projectDir, input);

    // Update go.mod with the actual module path
    await this.updateGoMod(projectDir, input);

    // Create bin directory
    const binDir = path.join(projectDir, 'bin');
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, '.gitkeep'), '', 'utf-8');
    }

    return projectDir;
  }

  /**
   * Search for a sibling directory while walking up parent directories.
   */
  private findSiblingDirInParentChain(startDir: string, siblingName: string, maxDepth: number): string | null {
    let current = path.resolve(startDir);
    for (let depth = 0; depth <= maxDepth; depth++) {
      const sibling = path.join(current, siblingName);
      if (fs.existsSync(sibling) && fs.statSync(sibling).isDirectory()) {
        return sibling;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return null;
  }

  /**
   * Build placeholder replacement map for template scaffolding.
   */
  private buildReplacements(input: CreateDriverInput, template: TemplateInfo): Record<string, string> {
    // Map template-specific identifiers based on template type
    const templateIds: Record<TemplateType, { id: string; structPrefix: string }> = {
      device: { id: 'com.example.template.ip-device', structPrefix: 'ExampleIP' },
      hub: { id: 'com.example.template.hub', structPrefix: 'ExampleHub' },
      child: { id: 'com.example.template.child.zigbee-dimmer', structPrefix: 'ExampleChild' },
    };

    const { id: templateId, structPrefix } = templateIds[template.type];
    const driverStructName = toPascalCase(input.driverId.split('.').pop() || 'Driver');

    // Build the module path for the template
    const templateModulePaths: Record<TemplateType, string> = {
      device: 'github.com/NotrixInc/nx-driver-templates/driver-template-go',
      hub: 'github.com/NotrixInc/nx-driver-templates/driver-template-hub-go',
      child: 'github.com/NotrixInc/nx-driver-templates/driver-template-child-go',
    };

    return {
      [templateId]: input.driverId,
      [templateModulePaths[template.type]]: input.modulePath,
      [`${structPrefix}Driver`]: `${driverStructName}Driver`,
      [`${structPrefix}Config`]: `${driverStructName}Config`,
      ['"Example IP Device Driver"']: `"${input.driverName}"`,
      ['"Example Template Driver"']: `"${input.driverName}"`,
      ['"Example Hub Driver"']: `"${input.driverName}"`,
      ['"Example Child Driver"']: `"${input.driverName}"`,
      ['"0.1.0"']: `"${input.version}"`,
    };
  }

  /**
   * Update the manifest.json in the scaffolded project.
   */
  private async updateManifest(projectDir: string, input: CreateDriverInput): Promise<void> {
    const manifestPath = path.join(projectDir, 'manifest.json');

    const driverTypeMap: Record<TemplateType, string> = {
      device: 'DEVICE',
      hub: 'HUB',
      child: 'CHILD',
    };

    const manifest = {
      id: input.driverId,
      name: input.driverName,
      version: input.version,
      driver_type: driverTypeMap[input.template],
      device_types: input.deviceTypes.length > 0 ? input.deviceTypes : undefined,
      capabilities: input.capabilities.length > 0 ? input.capabilities : undefined,
      supported_topologies: input.topologies,
      protocols: input.protocols,
      entrypoint: {
        runtime: 'go',
        path: 'bin/driver',
      },
      ...(input.hubRequirement ? { requires_hub: [input.hubRequirement] } : {}),
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  /**
   * Update go.mod in the scaffolded project.
   * Keeps or adds a replace directive pointing to the local SDK.
   */
  private async updateGoMod(projectDir: string, input: CreateDriverInput): Promise<void> {
    const goModPath = path.join(projectDir, 'go.mod');
    if (!fs.existsSync(goModPath)) {
      return;
    }

    let content = fs.readFileSync(goModPath, 'utf-8');
    const sdkModule = 'github.com/NotrixInc/nx-driver-sdk';

    // Find the local SDK path
    const sdkPath = this.findLocalSdkPath(projectDir);

    if (sdkPath) {
      // Remove any existing replace directive
      content = content.replace(/\nreplace\s+github\.com\/NotrixInc\/nx-driver-sdk\s+=>.*/g, '');
      // Add correct replace directive with relative path from new project
      const relativeSdkPath = path.relative(projectDir, sdkPath).replace(/\\/g, '/');
      content = content.trimEnd() + `\n\nreplace ${sdkModule} => ${relativeSdkPath}\n`;
    }
    // If no local SDK found, keep whatever replace directive was in the template

    fs.writeFileSync(goModPath, content, 'utf-8');
  }

  /**
   * Attempt to find the local nx-driver-sdk directory.
   */
  private findLocalSdkPath(projectDir: string): string | null {
    const config = getExtensionConfig();

    // 1. Explicit config
    if (config.sdkPath && fs.existsSync(config.sdkPath)) {
      return config.sdkPath;
    }

    // 2. Check workspace folders
    const vscode = require('vscode');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        if (folder.name === 'nx-driver-sdk' || folder.uri.fsPath.endsWith('nx-driver-sdk')) {
          return folder.uri.fsPath;
        }
      }
      // Check sibling directories of workspace folders
      for (const folder of workspaceFolders) {
        const sibling = path.join(path.dirname(folder.uri.fsPath), 'nx-driver-sdk');
        if (fs.existsSync(sibling)) {
          return sibling;
        }
      }
    }

    // 3. Check siblings of project dir and its parents
    let dir = projectDir;
    for (let i = 0; i < 3; i++) {
      const parent = path.dirname(dir);
      const sibling = path.join(parent, 'nx-driver-sdk');
      if (fs.existsSync(sibling)) {
        return sibling;
      }
      dir = parent;
    }

    return null;
  }
}

/**
 * Convert a kebab-case or dot-separated string to PascalCase.
 */
function toPascalCase(str: string): string {
  return str
    .split(/[-._]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}
