const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Collects cleaned values and per-field error messages from a request body.
 *
 *   const form = new Form(req.body);
 *   form.text('name', { label: 'Full name', min: 2, max: 100 });
 *   if (!form.valid) return res.render(..., { errors: form.errors, values: form.values });
 */
export class Form {
  constructor(body = {}) {
    this.body = body;
    this.values = {};
    this.errors = {};
  }

  get valid() {
    return Object.keys(this.errors).length === 0;
  }

  fail(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
    return this;
  }

  raw(field) {
    const value = this.body[field];
    return typeof value === 'string' ? value.trim() : '';
  }

  text(field, { label = field, required = true, min = 0, max = 255 } = {}) {
    const value = this.raw(field);
    this.values[field] = value;
    if (!value) {
      if (required) this.fail(field, `${label} is required.`);
      return this;
    }
    if (value.length < min) this.fail(field, `${label} must be at least ${min} characters.`);
    if (value.length > max) this.fail(field, `${label} must be at most ${max} characters.`);
    return this;
  }

  email(field, { label = 'Email address' } = {}) {
    this.text(field, { label, max: 254 });
    this.values[field] = this.values[field].toLowerCase();
    if (this.values[field] && !EMAIL_PATTERN.test(this.values[field])) {
      this.fail(field, `${label} is not a valid email address.`);
    }
    return this;
  }

  password(field, { label = 'Password', confirmField } = {}) {
    const value = typeof this.body[field] === 'string' ? this.body[field] : '';
    this.values[field] = value;
    if (!value) return this.fail(field, `${label} is required.`);
    if (value.length < 8) this.fail(field, `${label} must be at least 8 characters.`);
    if (value.length > 128) this.fail(field, `${label} must be at most 128 characters.`);
    if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) this.fail(field, `${label} must contain letters and numbers.`);
    if (confirmField && this.body[confirmField] !== value) this.fail(confirmField, 'Passwords do not match.');
    return this;
  }

  oneOf(field, allowed, { label = field, required = true } = {}) {
    const value = this.raw(field);
    const values = allowed.map((item) => String(typeof item === 'object' ? item.value : item));
    this.values[field] = value;
    if (!value) {
      if (required) this.fail(field, `Please choose a ${label.toLowerCase()}.`);
      return this;
    }
    if (!values.includes(value)) this.fail(field, `${label} is not a valid choice.`);
    return this;
  }

  integer(field, { label = field, min = -Infinity, max = Infinity, required = true } = {}) {
    const raw = this.raw(field).replace(/,/g, '');
    if (!raw) {
      this.values[field] = null;
      if (required) this.fail(field, `${label} is required.`);
      return this;
    }
    const value = Number(raw);
    this.values[field] = value;
    if (!Number.isInteger(value)) return this.fail(field, `${label} must be a whole number.`);
    if (value < min || value > max) this.fail(field, `${label} must be between ${min} and ${max}.`);
    return this;
  }
}

/** Parses a positive integer route parameter, returning null when it is not one. */
export function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
