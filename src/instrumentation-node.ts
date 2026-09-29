import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

// Node's fetch ignores HTTP(S)_PROXY on its own; this makes it honor them (and NO_PROXY).
if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
