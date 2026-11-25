import presetConfig from '@adonisjs/prettier-config';

// The AdonisJS preset drops semicolons; the repository keeps them everywhere, so only that
// option is overridden and the rest of the preset (quotes, width, plugin) applies as published.
export default { ...presetConfig, semi: true };
