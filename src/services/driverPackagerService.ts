import * as path from 'path';
import * as fs from 'fs';
import { getExtensionConfig, execCommand, log } from '../utils';

/**
 * Service for packaging and verifying driver packages using nx-driver-packager.
 */
export class DriverPackagerService {
  /**
   * Package a driver project into an .nxpkg file.
   *
   * @param projectDir - Root directory of the driver project
   * @param outputPath - Optional output path; defaults to `<projectDir>/<id>-<version>-<os>-<arch>.nxpkg`
   */
  async packageDriver(projectDir: string, outputPath?: string): Promise<{ success: boolean; output: string; packagePath?: string }> {
    const packagerBin = await this.resolvePackagerBinary(projectDir);
    if (!packagerBin) {
      return {
        success: false,
        output: 'nx-driver-packager not found. Please set nxDriver.packagerPath in settings or ensure it is on PATH.',
      };
    }

    // Determine output filename from manifest
    if (!outputPath) {
      outputPath = await this.defaultOutputPath(projectDir);
    }

    outputPath = this.ensureOutputPathOutsideProject(projectDir, outputPath);

    this.ensureManifestEntrypointFile(projectDir);

    // Warn if schema files needed by controller-core are missing
    const schemaWarnings = this.validatePackageSchemas(projectDir);
    if (schemaWarnings) {
      log(`Package schema warnings:\n${schemaWarnings}`);
    }

    log(`Packaging ${projectDir} → ${outputPath}`);

    try {
      const { stdout, stderr } = await execCommand(
        `"${packagerBin}" pack --input "${projectDir}" --out "${outputPath}"`,
        projectDir
      );

      const output = (stdout + stderr).trim();
      log(`Package created: ${outputPath}`);
      const parts = ['Package created successfully!'];
      if (output) { parts.push(output); }
      if (schemaWarnings) { parts.push(schemaWarnings); }
      return { success: true, output: parts.join('\n'), packagePath: outputPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Package failed: ${message}`);
      return { success: false, output: message };
    }
  }

  /**
   * Verify an .nxpkg package.
   */
  async verifyPackage(packagePath: string, sourceDir?: string): Promise<{ success: boolean; output: string }> {
    const packagerBin = await this.resolvePackagerBinary(sourceDir || path.dirname(packagePath));
    if (!packagerBin) {
      return {
        success: false,
        output: 'nx-driver-packager not found. Please set nxDriver.packagerPath in settings.',
      };
    }

    let cmd = `"${packagerBin}" verify --pkg "${packagePath}"`;
    if (sourceDir) {
      cmd += ` --input "${sourceDir}"`;
    }

    log(`Verifying package: ${packagePath}`);

    try {
      const { stdout, stderr } = await execCommand(cmd, path.dirname(packagePath));
      const output = (stdout + stderr).trim();
      log(`Verification passed: ${packagePath}`);
      return { success: true, output: `Package verification passed!\n${output}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Verification failed: ${message}`);
      return { success: false, output: message };
    }
  }

  /**
   * Build the packager from source if needed.
   */
  async buildPackagerFromSource(repoPath: string): Promise<string | null> {
    const config = getExtensionConfig();
    const goPath = config.goPath || 'go';
    const outputBin = process.platform === 'win32' ? 'nx-driver-packager.exe' : 'nx-driver-packager';
    const outputPath = path.join(repoPath, outputBin);

    try {
      await execCommand(
        `"${goPath}" build -o "${outputPath}" ./cmd/nx-driver-packager`,
        repoPath
      );
      log(`Built packager at ${outputPath}`);
      return outputPath;
    } catch (err) {
      log(`Failed to build packager: ${err}`);
      return null;
    }
  }

  /**
   * Check if the packager is available.
   */
  async isPackagerAvailable(): Promise<boolean> {
    const bin = await this.resolvePackagerBinary();
    return bin !== null;
  }

  /**
   * Resolve the path to the packager binary.
   */
  private async resolvePackagerBinary(searchFromDir?: string): Promise<string | null> {
    const config = getExtensionConfig();
    const binName = process.platform === 'win32' ? 'nx-driver-packager.exe' : 'nx-driver-packager';

    // 1. Check explicit config
    if (config.packagerPath) {
      const configured = path.resolve(config.packagerPath);
      if (fs.existsSync(configured)) {
        const stats = fs.statSync(configured);

        if (stats.isFile()) {
          return configured;
        }

        const fromRepo = await this.resolveFromRepoDir(configured, binName);
        if (fromRepo) {
          return fromRepo;
        }
      }
    }

    // 2. Check workspace for the packager repo
    const vscode = require('vscode');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        if (folder.name === 'nx-driver-packager' || folder.uri.fsPath.endsWith('nx-driver-packager')) {
          const fromRepo = await this.resolveFromRepoDir(folder.uri.fsPath, binName);
          if (fromRepo) {
            return fromRepo;
          }
        }
      }
      // Check siblings
      for (const folder of workspaceFolders) {
        const sibling = path.join(path.dirname(folder.uri.fsPath), 'nx-driver-packager');
        if (fs.existsSync(sibling)) {
          const fromRepo = await this.resolveFromRepoDir(sibling, binName);
          if (fromRepo) {
            return fromRepo;
          }
        }
      }
    }

    // 3. Search from selected project path upward
    if (searchFromDir) {
      const siblingRepo = this.findSiblingDirInParentChain(searchFromDir, 'nx-driver-packager', 6);
      if (siblingRepo) {
        const fromRepo = await this.resolveFromRepoDir(siblingRepo, binName);
        if (fromRepo) {
          return fromRepo;
        }
      }
    }

    // 4. Check PATH
    try {
      await execCommand('nx-driver-packager --help', process.cwd());
      return 'nx-driver-packager';
    } catch {
      // Not on PATH
    }

    return null;
  }

  private async resolveFromRepoDir(repoPath: string, binName: string): Promise<string | null> {
    const directBin = path.join(repoPath, binName);
    if (fs.existsSync(directBin)) {
      return directBin;
    }

    const distBin = path.join(repoPath, 'bin', binName);
    if (fs.existsSync(distBin)) {
      return distBin;
    }

    const built = await this.buildPackagerFromSource(repoPath);
    if (built && fs.existsSync(built)) {
      return built;
    }

    return null;
  }

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
   * Generate a default output path for a package.
   */
  private async defaultOutputPath(projectDir: string): Promise<string> {
    const manifestPath = path.join(projectDir, 'manifest.json');
    const config = getExtensionConfig();
    let id = 'driver';
    let version = '0.0.0';

    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        id = manifest.id || manifest.driver_id || id;
        version = manifest.version || version;
      } catch {
        // Use defaults
      }
    }

    const osName = (config.packageTargetOs || 'linux').toLowerCase();
    const arch = (config.packageTargetArch || 'amd64').toLowerCase();

    return path.join(path.dirname(projectDir), `${id}-${version}-${osName}-${arch}.nxpkg`);
  }

  private ensureOutputPathOutsideProject(projectDir: string, outputPath: string): string {
    const projectRoot = path.resolve(projectDir);
    const resolvedOutput = path.resolve(outputPath);
    const relative = path.relative(projectRoot, resolvedOutput);
    const outputInsideProject = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!outputInsideProject) {
      return resolvedOutput;
    }

    const safeOutput = path.join(path.dirname(projectRoot), path.basename(resolvedOutput));
    log(`Packaging output path was inside input directory and may recurse. Redirecting output to: ${safeOutput}`);
    return safeOutput;
  }

  private ensureManifestEntrypointFile(projectDir: string): void {
    const manifestPath = path.join(projectDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return;
    }

    let entrypointPath = '';
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        entrypoint?: string | { path?: string };
      };

      if (typeof manifest.entrypoint === 'string') {
        entrypointPath = manifest.entrypoint;
      } else if (manifest.entrypoint && typeof manifest.entrypoint.path === 'string') {
        entrypointPath = manifest.entrypoint.path;
      }
    } catch {
      return;
    }

    if (!entrypointPath) {
      return;
    }

    const normalizedEntrypoint = entrypointPath.replace(/\//g, path.sep);
    const expectedFile = path.join(projectDir, normalizedEntrypoint);
    if (fs.existsSync(expectedFile)) {
      return;
    }

    // The build always outputs "bin/driver" (no extension). Resolve the
    // manifest entrypoint regardless of whether it has an .exe suffix.
    const candidates: string[] = [];
    if (expectedFile.endsWith('.exe')) {
      // Manifest says "bin/driver.exe" but cross-compile produced "bin/driver"
      candidates.push(expectedFile.replace(/\.exe$/, ''));
    } else {
      // Manifest says "bin/driver" but native Windows build produced "bin/driver.exe"
      candidates.push(`${expectedFile}.exe`);
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        fs.copyFileSync(candidate, expectedFile);
        log(`Staged manifest entrypoint: copied ${path.basename(candidate)} → ${path.basename(expectedFile)}`);
        return;
      }
    }
  }

  /**
   * Validate that schema files required by controller-core are present in
   * the project and well-formed.  Returns a warning string, or empty if OK.
   *
   * Controller-core serves variables.schema.json and config.schema.json as-is
   * to the web console.  If they're missing the driver will appear with empty
   * Control / Telemetry / Settings tabs.
   */
  private validatePackageSchemas(projectDir: string): string {
    const warnings: string[] = [];

    const requiredSchemas = [
      { file: 'variables.schema.json', description: 'Control & Telemetry tabs' },
      { file: 'config.schema.json', description: 'Settings tab' },
    ];

    for (const { file, description } of requiredSchemas) {
      const filePath = path.join(projectDir, file);
      if (!fs.existsSync(filePath)) {
        warnings.push(`⚠ ${file} not found – ${description} will be empty in controller web console.`);
        continue;
      }
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (file === 'variables.schema.json') {
          const vars = Array.isArray(data?.variables) ? data.variables : (Array.isArray(data) ? data : null);
          if (!vars && !(data?.type === 'object' && data?.properties)) {
            warnings.push(`⚠ ${file}: unrecognized format – expected { "variables": [...] } or JSON Schema.`);
          }
        } else if (file === 'config.schema.json') {
          if (!data?.properties || typeof data.properties !== 'object') {
            warnings.push(`⚠ ${file}: missing "properties" – Settings tab may be empty.`);
          }
        }
      } catch {
        warnings.push(`⚠ ${file}: invalid JSON.`);
      }
    }

    return warnings.join('\n');
  }
}
