import { createRequire } from 'node:module';
import { Server as HttpServer } from 'node:http';

let armed = false;
let releaseVerification = Promise.withResolvers();
let armedBeforeHandler = false;
let releaseBeforeHandler = Promise.withResolvers();
let armBufferedConnection = false;
let bufferedDispatches = 0;
const coreRequire = createRequire(import.meta.resolve('@adonisjs/core'));
const { Server } = coreRequire('@adonisjs/http-server');
const emit = HttpServer.prototype.emit;
HttpServer.prototype.emit = function (event, ...args) {
  if (event === 'connection' && armBufferedConnection) {
    armBufferedConnection = false;
    args[0]._handle.readStop();
    process.send?.({ type: 'buffered-socket-held' });
  }
  return emit.call(this, event, ...args);
};
const handle = Server.prototype.handle;
Server.prototype.handle = async function (...args) {
  if (args[0]?.url?.includes('bufferedNativeProbe=1')) bufferedDispatches += 1;
  if (armedBeforeHandler) {
    armedBeforeHandler = false;
    process.send?.({ type: 'entered-native-handler' });
    await releaseBeforeHandler.promise;
  }
  return handle.apply(this, args);
};

process.on('message', async (message) => {
  if (message?.type === 'install') {
    const { default: hash } = await import('@adonisjs/core/services/hash');
    const verify = hash.verify;
    hash.verify = async function (...args) {
      if (armed) {
        armed = false;
        process.send?.({ type: 'entered-verification' });
        await releaseVerification.promise;
      }
      return verify.apply(this, args);
    };
    process.send?.({ type: 'instrumented' });
  }
  if (message?.type === 'arm') armed = true;
  if (message?.type === 'release') releaseVerification.resolve();
  if (message?.type === 'arm-before-handler') armedBeforeHandler = true;
  if (message?.type === 'release-before-handler') releaseBeforeHandler.resolve();
  if (message?.type === 'arm-buffered-connection') armBufferedConnection = true;
  if (message?.type === 'buffered-dispatch-count')
    process.send?.({ type: 'buffered-dispatch-count', count: bufferedDispatches });
});

await import('../bin/server.ts');
