import test from 'node:test';
import assert from 'node:assert/strict';

test('connector identity comes only from a matching settled native receipt, never an unserved or ambiguous app sighting', async () => {
  const module = await import('../../src/integrations/chatgpt-browser/connector-identity.mjs').catch(() => ({}));
  assert.equal(typeof module.provenConnectorApps, 'function', 'app identity must be joined to ANKITA execution evidence');
  const proof = { phase: 'settled', owner: { requestId: 'native-request', surface: 'core' } };
  const sighting = { requestId: 'native-request', appId: 'asdk_app_owned', appName: 'ANKITA Proof' };
  assert.deepEqual(module.provenConnectorApps([sighting], [proof]), [{ surface: 'core', name: 'ANKITA Proof', path: 'app://asdk_app_owned' }]);
  assert.deepEqual(module.provenConnectorApps([{ ...sighting, requestId: 'unserved' }], [proof]), []);
  assert.deepEqual(module.provenConnectorApps([sighting], [{ ...proof, phase: 'started' }]), []);
  assert.deepEqual(module.provenConnectorApps([sighting, { ...sighting, appId: 'asdk_app_other' }], [proof]), []);
  assert.deepEqual(module.provenConnectorApps([{ ...sighting, appName: 'bad\nlabel' }], [proof]), []);
});
