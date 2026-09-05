// This source is fed to Node's explicit stdin entry point; the target module URL is an argument.
await import(process.argv[2]);
console.log("imported");
