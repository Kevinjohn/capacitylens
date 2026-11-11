let armed = false;
let releaseVerification = Promise.withResolvers();
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
});

await import('../bin/server.ts');
