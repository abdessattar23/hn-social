import { HTTPException } from "hono/http-exception";

export class NotFoundError extends HTTPException {
  constructor(message = "Not found") {
    super(404, { message });
  }
}

export class ForbiddenError extends HTTPException {
  constructor(message = "Forbidden") {
    super(403, { message });
  }
}

export class ConflictError extends HTTPException {
  constructor(message = "Conflict") {
    super(409, { message });
  }
}

export class BadRequestError extends HTTPException {
  constructor(message = "Bad request") {
    super(400, { message });
  }
}
