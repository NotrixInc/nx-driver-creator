import * as vscode from 'vscode';
import { DriverTemplateService } from '../services/driverTemplateService';
import { DriverSdkService } from '../services/driverSdkService';
import { DriverPackagerService } from '../services/driverPackagerService';
import { getExtensionConfig, findDriverProjects, log } from '../utils';

/**
 * Template picker provider - shown as a webview panel when creating a new driver.
 * Provides a richer UI than the standard QuickPick for template selection.
 */
export class TemplatePickerProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _templateService: DriverTemplateService
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlContent();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'selectTemplate':
          await vscode.commands.executeCommand('nxDriver.createDriver');
          break;
        case 'openDocs':
          vscode.env.openExternal(vscode.Uri.parse('https://github.com/NotrixInc/nx-driver-sdk'));
          break;
      }
    });
  }

  private _getHtmlContent(): string {
    const templates = this._templateService.getTemplates();

    const templateCards = templates.map(t => `
      <div class="template-card" onclick="selectTemplate('${t.type}')">
        <h3>${t.label}</h3>
        <p>${t.description}</p>
        <span class="badge">${t.type.toUpperCase()}</span>
      </div>
    `).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      padding: 10px;
    }
    .template-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .template-card:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .template-card h3 {
      margin: 0 0 6px 0;
      font-size: 14px;
    }
    .template-card p {
      margin: 0 0 8px 0;
      font-size: 12px;
      opacity: 0.8;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .actions {
      margin-top: 16px;
      text-align: center;
    }
    button {
      padding: 6px 16px;
      border: none;
      border-radius: 4px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-size: 13px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <h2>Create New Driver</h2>
  ${templateCards}
  <div class="actions">
    <button onclick="createDriver()">Create Driver</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function selectTemplate(type) {
      vscode.postMessage({ command: 'selectTemplate', type });
    }
    function createDriver() {
      vscode.postMessage({ command: 'selectTemplate' });
    }
  </script>
</body>
</html>`;
  }
}
