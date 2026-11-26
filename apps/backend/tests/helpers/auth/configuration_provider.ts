import env from '#start/env';

export const bootstrapEmail = 'admin@admin.admin';
export const bootstrapPassword = 'batman-local-bootstrap-2026';
export const originalCreateAdmin = env.get('CAPACITYLENS_CREATE_ADMIN_ADMIN');
export const originalBootstrapPassword = env.get('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD');
