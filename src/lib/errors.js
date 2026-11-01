/** An error carrying an HTTP status and a message that is safe to show to users. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

export const notFound = (message = 'The page you requested could not be found.') => new HttpError(404, message);
export const forbidden = (message = 'You do not have permission to access this page.') => new HttpError(403, message);

/** A business-rule violation raised by a service, shown to the user as a flash message. */
export class DomainError extends Error {}
