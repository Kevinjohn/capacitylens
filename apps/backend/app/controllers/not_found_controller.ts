import type { HttpContext } from '@adonisjs/core/http';

/** Answers an API path that no route matches. */
export default class NotFoundController {
  handle({ response }: HttpContext) {
    return response.notFound({ error: 'Not found' });
  }
}
