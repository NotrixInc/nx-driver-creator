import * as vscode from 'vscode';
import * as path from 'path';
import { DriverProject, EndpointDefinition, VariableDefinition, EventDefinition } from '../types';
import { findDriverProjects, loadDriverProject } from '../utils';

/**
 * Tree data provider for the NX Driver Explorer sidebar view.
 * Shows all detected driver projects with their endpoints, variables, and config files.
 */
export class DriverTreeProvider implements vscode.TreeDataProvider<DriverTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DriverTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projects: DriverProject[] = [];

  async refresh(): Promise<void> {
    this.projects = await findDriverProjects();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DriverTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DriverTreeItem): Promise<DriverTreeItem[]> {
    if (!element) {
      // Root: show all driver projects
      if (this.projects.length === 0) {
        await this.refresh();
      }

      if (this.projects.length === 0) {
        return [
          new DriverTreeItem(
            'No driver projects found',
            vscode.TreeItemCollapsibleState.None,
            'noProjects'
          ),
        ];
      }

      return this.projects.map(project => {
        const item = new DriverTreeItem(
          project.manifest.name || project.manifest.id,
          vscode.TreeItemCollapsibleState.Collapsed,
          'driverProject'
        );
        item.description = `v${project.manifest.version}`;
        item.tooltip = `${project.manifest.id}\nType: ${project.manifest.driver_type}\nPath: ${project.rootPath}`;
        item.iconPath = this.getDriverIcon(project.manifest.driver_type);
        item.resourceUri = vscode.Uri.file(project.rootPath);
        item.project = project;
        return item;
      });
    }

    // Children of a driver project
    if (element.contextValue === 'driverProject' && element.project) {
      return this.getProjectChildren(element.project);
    }

    // Children of endpoints node
    if (element.contextValue === 'endpointsNode' && element.project) {
      return this.getEndpointChildren(element.project);
    }

    // Children of variables node
    if (element.contextValue === 'variablesNode' && element.project) {
      return this.getVariableChildren(element.project);
    }

    // Children of capabilities node
    if (element.contextValue === 'capabilitiesNode' && element.project) {
      return this.getCapabilityChildren(element.project);
    }

    // Children of events node
    if (element.contextValue === 'eventsNode' && element.project) {
      return this.getEventChildren(element.project);
    }

    // Children of config files node
    if (element.contextValue === 'configFilesNode' && element.project) {
      return this.getConfigFileChildren(element.project);
    }

    return [];
  }

  private getProjectChildren(project: DriverProject): DriverTreeItem[] {
    const children: DriverTreeItem[] = [];

    // Info node
    const infoItem = new DriverTreeItem(
      `${project.manifest.driver_type} | ${(project.manifest.protocols || []).join(', ')}`,
      vscode.TreeItemCollapsibleState.None,
      'infoNode'
    );
    infoItem.iconPath = new vscode.ThemeIcon('info');
    children.push(infoItem);

    // Endpoints
    const endpointsCount = project.endpoints?.length || 0;
    const endpointsItem = new DriverTreeItem(
      `Endpoints (${endpointsCount})`,
      endpointsCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      'endpointsNode'
    );
    endpointsItem.iconPath = new vscode.ThemeIcon('plug');
    endpointsItem.project = project;
    children.push(endpointsItem);

    // Variables
    const variablesCount = project.variables?.length || 0;
    const variablesItem = new DriverTreeItem(
      `Variables (${variablesCount})`,
      variablesCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      'variablesNode'
    );
    variablesItem.iconPath = new vscode.ThemeIcon('symbol-variable');
    variablesItem.project = project;
    children.push(variablesItem);

    // Capabilities
    const capabilitiesCount = project.capabilities ? Object.keys(project.capabilities).length : 0;
    const capabilitiesItem = new DriverTreeItem(
      `Capabilities (${capabilitiesCount})`,
      capabilitiesCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      'capabilitiesNode'
    );
    capabilitiesItem.iconPath = new vscode.ThemeIcon('symbol-boolean');
    capabilitiesItem.project = project;
    children.push(capabilitiesItem);

    // Events
    const eventsCount = project.events?.events?.length || 0;
    const eventsItem = new DriverTreeItem(
      `Events (${eventsCount})`,
      eventsCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      'eventsNode'
    );
    eventsItem.iconPath = new vscode.ThemeIcon('symbol-event');
    eventsItem.project = project;
    children.push(eventsItem);

    // Config Files
    const configItem = new DriverTreeItem(
      'Configuration Files',
      vscode.TreeItemCollapsibleState.Collapsed,
      'configFilesNode'
    );
    configItem.iconPath = new vscode.ThemeIcon('settings-gear');
    configItem.project = project;
    children.push(configItem);

    return children;
  }

  private getEndpointChildren(project: DriverProject): DriverTreeItem[] {
    if (!project.endpoints) {
      return [];
    }

    return project.endpoints.map((ep: EndpointDefinition) => {
      const endpointId = ep.key || ep.id || '(missing-id)';
      const endpointKind = ep.kind || ep.type || 'Control';
      const endpointControl = ep.control_type || '';
      const item = new DriverTreeItem(
        endpointId,
        vscode.TreeItemCollapsibleState.None,
        'endpoint'
      );
      item.description = endpointControl
        ? `${ep.direction} ${endpointKind} (${endpointControl})`
        : `${ep.direction} ${endpointKind}`;
      item.tooltip = `Key: ${endpointId}\nName: ${ep.name}\nDirection: ${ep.direction}\nKind: ${endpointKind}\nConnection: ${ep.connection}${endpointControl ? `\nControl: ${endpointControl}` : ''}`;
      item.iconPath = new vscode.ThemeIcon('symbol-interface');
      return item;
    });
  }

  private getVariableChildren(project: DriverProject): DriverTreeItem[] {
    if (!project.variables) {
      return [];
    }

    return project.variables.map((v: VariableDefinition) => {
      const item = new DriverTreeItem(
        v.key,
        vscode.TreeItemCollapsibleState.None,
        'variable'
      );
      const access = v.read_only ? 'RO' : v.writable ? 'RW' : 'R';
      item.description = `${v.type} ${v.unit || ''} [${access}]`.trim();
      item.tooltip = `Key: ${v.key}\nType: ${v.type}\nUnit: ${v.unit || 'none'}\nAccess: ${access}`;
      item.iconPath = new vscode.ThemeIcon('symbol-variable');
      return item;
    });
  }

  private getCapabilityChildren(project: DriverProject): DriverTreeItem[] {
    if (!project.capabilities) {
      return [];
    }

    return Object.entries(project.capabilities).map(([key, value]) => {
      const item = new DriverTreeItem(
        key,
        vscode.TreeItemCollapsibleState.None,
        'capability'
      );
      item.description = String(value);
      item.tooltip = `Capability: ${key}\nValue: ${JSON.stringify(value)}`;
      item.iconPath = new vscode.ThemeIcon('symbol-boolean');
      return item;
    });
  }

  private getEventChildren(project: DriverProject): DriverTreeItem[] {
    if (!project.events?.events) {
      return [];
    }

    return project.events.events.map((event: EventDefinition) => {
      const item = new DriverTreeItem(
        event.type,
        vscode.TreeItemCollapsibleState.None,
        'event'
      );
      item.description = event.name;
      item.tooltip = `Type: ${event.type}\nName: ${event.name}\nSeverity: ${event.severity}${event.description ? `\nDescription: ${event.description}` : ''}`;
      item.iconPath = new vscode.ThemeIcon('symbol-event');
      return item;
    });
  }

  private getConfigFileChildren(project: DriverProject): DriverTreeItem[] {
    const files = [
      { name: 'manifest.json', required: true },
      { name: 'config.schema.json', required: false },
      { name: 'capabilities.json', required: false },
      { name: 'events.json', required: false },
      { name: 'endpoints.json', required: false },
      { name: 'variables.schema.json', required: false },
    ];

    const fs = require('fs');

    return files.map(f => {
      const filePath = path.join(project.rootPath, f.name);
      const exists = fs.existsSync(filePath);

      const item = new DriverTreeItem(
        f.name,
        vscode.TreeItemCollapsibleState.None,
        'configFile'
      );
      item.description = exists ? '' : '(missing)';
      item.iconPath = new vscode.ThemeIcon(exists ? 'json' : 'warning');

      if (exists) {
        item.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(filePath)],
        };
      }

      return item;
    });
  }

  private getDriverIcon(driverType: string): vscode.ThemeIcon {
    switch (driverType) {
      case 'HUB':
        return new vscode.ThemeIcon('server');
      case 'CHILD':
        return new vscode.ThemeIcon('server-process');
      case 'UI':
        return new vscode.ThemeIcon('browser');
      default:
        return new vscode.ThemeIcon('circuit-board');
    }
  }
}

/**
 * Custom tree item with driver project context.
 */
export class DriverTreeItem extends vscode.TreeItem {
  project?: DriverProject;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string
  ) {
    super(label, collapsibleState);
  }
}
