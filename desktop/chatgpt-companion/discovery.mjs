import { wire } from './wire.mjs';

const DISCOVERY_MS = 1000; // Milliseconds per loopback greeting; concurrent candidates do not multiply startup latency.
const EXTENSION_HEADER = 'x-ankita-extension'; // Chrome may omit Origin on extension-owned fetch; ordinary web origins are still rejected.
const HTTP_CONFLICT = 409; // Explicit host Disconnect or a different paired browser; never silently replace its owner.
export async function discoverCompanion({ browserId, extensionId, preferredAddress, preferredHostId, ports = wire.discoveryPorts, fetcher = fetch } = {}) {
  if (!/^[a-p]{32}$/.test(extensionId) || typeof browserId !== 'string' || !browserId) throw new Error('Companion browser identity is unavailable');
  const headers = { Origin: `chrome-extension://${extensionId}`, [EXTENSION_HEADER]: extensionId, 'Content-Type': wire.jsonContentType };
  const addresses = ports.map(port => `${wire.localProtocol}//${wire.loopbackHost}:${port}`);
  const hello = async address => {
    if (!addresses.includes(address)) return null;
    try {
      const response = await fetcher(address + wire.routes.hello, { headers, cache: 'no-store', signal: AbortSignal.timeout(DISCOVERY_MS) });
      const result = response.ok && await response.json();
      return result?.app === wire.appId && result.version === wire.version && typeof result.hostId === 'string' && result.hostId && result.hostId.length <= wire.maxIdChars && !result.disconnected ? { address, hostId: result.hostId } : null;
    } catch { return null; }
  };
  let selected = preferredAddress && preferredHostId && await hello(preferredAddress);
  if (selected?.hostId !== preferredHostId) selected = null;
  if (!selected) {
    const candidates = (await Promise.all(addresses.map(hello))).filter(Boolean);
    if (candidates.length > 1) throw new Error('More than one ANKITA app is waiting. Close the extra app, then connect again.');
    selected = candidates[0];
  }
  if (!selected) return null;
  const { address, hostId } = selected;
  const response = await fetcher(address + wire.routes.provision, { method: 'POST', headers,
    body: JSON.stringify({ browserId, extensionId, hostId, version: wire.version }), signal: AbortSignal.timeout(DISCOVERY_MS) });
  if (!response.ok) throw new Error(response.status === HTTP_CONFLICT ? 'This ANKITA connection is stopped or belongs to another browser.' : 'ANKITA could not connect its companion.');
  const result = await response.json();
  if (result.version !== wire.version || result.hostId !== hostId || typeof result.key !== 'string' || !result.key) throw new Error('ANKITA companion versions or app profiles do not match');
  return { address, hostId, key: result.key, browserId };
}
