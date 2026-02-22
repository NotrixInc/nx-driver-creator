import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Extension should be present', () => {
    assert.ok(vscode.extensions.getExtension('notrix.nx-driver-creator'));
  });

  test('Extension should activate', async () => {
    const ext = vscode.extensions.getExtension('notrix.nx-driver-creator');
    if (ext) {
      await ext.activate();
      assert.ok(ext.isActive);
    }
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes('nxDriver.createDriver'), 'createDriver command missing');
    assert.ok(commands.includes('nxDriver.packageDriver'), 'packageDriver command missing');
    assert.ok(commands.includes('nxDriver.buildDriver'), 'buildDriver command missing');
    assert.ok(commands.includes('nxDriver.runDriver'), 'runDriver command missing');
    assert.ok(commands.includes('nxDriver.verifyPackage'), 'verifyPackage command missing');
    assert.ok(commands.includes('nxDriver.editManifest'), 'editManifest command missing');
    assert.ok(commands.includes('nxDriver.addEndpoint'), 'addEndpoint command missing');
    assert.ok(commands.includes('nxDriver.addVariable'), 'addVariable command missing');
    assert.ok(commands.includes('nxDriver.addEvent'), 'addEvent command missing');
    assert.ok(commands.includes('nxDriver.addCapability'), 'addCapability command missing');
    assert.ok(commands.includes('nxDriver.refreshExplorer'), 'refreshExplorer command missing');
  });
});
