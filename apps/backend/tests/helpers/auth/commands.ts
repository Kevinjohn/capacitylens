import app from '@adonisjs/core/services/app';

/** Creates the registered ace command `name` in-process with `args` and executes it. */
export async function execCommand(name: string, args: string[]) {
  const ace = await app.container.make('ace');
  await ace.boot();
  const command = await ace.create(await ace.find(name), args);
  await command.exec();
  return command;
}
