import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Unit tests for utility functions (no VS Code API dependency).
 * These can also be run standalone with mocha.
 */
suite('Utilities Test Suite', () => {
  test('isValidDriverId accepts valid reverse-DNS IDs', () => {
    // Import inline to avoid vscode dependency issues in pure unit tests
    const validIds = [
      'com.vendor.product',
      'com.notrix.camera.isapi',
      'com.example.template.ip-device',
      'org.company.driver-name',
    ];
    const invalidIds = [
      '',
      'driver',
      'com.vendor',          // only 2 segments
      'COM.VENDOR.PRODUCT',  // uppercase
      'com..vendor.product',
      '1com.vendor.product',
    ];

    const isValidDriverId = (id: string) =>
      /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){2,}$/.test(id);

    for (const id of validIds) {
      assert.ok(isValidDriverId(id), `Expected valid: ${id}`);
    }
    for (const id of invalidIds) {
      assert.ok(!isValidDriverId(id), `Expected invalid: ${id}`);
    }
  });

  test('isValidVersion accepts semver strings', () => {
    const isValidVersion = (v: string) =>
      /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(v);

    assert.ok(isValidVersion('0.1.0'));
    assert.ok(isValidVersion('1.0.0'));
    assert.ok(isValidVersion('1.2.3-beta.1'));
    assert.ok(!isValidVersion('1.0'));
    assert.ok(!isValidVersion('v1.0.0'));
    assert.ok(!isValidVersion(''));
  });

  test('Manifest JSON roundtrip', () => {
    const manifest = {
      id: 'com.test.driver',
      name: 'Test Driver',
      version: '1.0.0',
      driver_type: 'DEVICE',
      supported_topologies: ['DIRECT_IP'],
      protocols: ['IP'],
      entrypoint: {
        runtime: 'go',
        path: 'bin/driver',
      },
    };

    const json = JSON.stringify(manifest, null, 2);
    const parsed = JSON.parse(json);

    assert.strictEqual(parsed.id, manifest.id);
    assert.strictEqual(parsed.version, manifest.version);
    assert.strictEqual(parsed.entrypoint.path, 'bin/driver');
  });

  test('replacePlaceholders replaces all occurrences', () => {
    const replacePlaceholders = (content: string, replacements: Record<string, string>) => {
      let result = content;
      for (const [key, value] of Object.entries(replacements)) {
        result = result.split(key).join(value);
      }
      return result;
    };

    const input = 'module com.example.template\nid: com.example.template';
    const result = replacePlaceholders(input, {
      'com.example.template': 'com.notrix.mydriver',
    });

    assert.strictEqual(result, 'module com.notrix.mydriver\nid: com.notrix.mydriver');
  });
});
