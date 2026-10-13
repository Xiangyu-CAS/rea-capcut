import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
const iframe = document.querySelector('iframe')!;
const bridge = new AppBridge(null, { name: 'ReaCut local validation host', version: '1' }, { serverTools: {} }, { hostContext: { displayMode: 'fullscreen', availableDisplayModes: ['fullscreen'], theme: 'dark' } });
bridge.oncalltool = async params => {
  const response = await fetch(location.pathname + 'rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  return response.json();
};
bridge.onrequestdisplaymode = async () => ({ mode: 'fullscreen' });
await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
iframe.src = location.pathname + 'widget';
