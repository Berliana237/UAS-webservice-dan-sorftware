'use strict';
/** Skema request yang divalidasi di gateway sebelum diteruskan ke service. Kerusakan bentuk ditolak di pintu depan. */
const Ajv = require('ajv').default;

const ajv = new Ajv({ allErrors: true, removeAdditional: false, strict: false });
const id = { type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9_.:-]+$' };
const seatId = { type: 'string', pattern: '^[A-Z0-9]{2,6}-[0-9]{1,2}[A-D]$' };

const schemas = {
  register: {
    type: 'object', required: ['name', 'email', 'password'], additionalProperties: false,
    properties: { name: { type: 'string', maxLength: 80 }, email: { type: 'string', maxLength: 120 }, password: { type: 'string', maxLength: 128 } },
  },
  login: {
    type: 'object', required: ['auth_request', 'email', 'password'], additionalProperties: false,
    properties: { auth_request: { type: 'string', maxLength: 128 }, email: { type: 'string', maxLength: 120 }, password: { type: 'string', maxLength: 128 } },
  },
  lock: {
    type: 'object', required: ['tripId', 'from', 'to', 'seats'], additionalProperties: false,
    properties: {
      tripId: id, from: id, to: id,
      seats: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: seatId },
      ttlSeconds: { type: 'integer', minimum: 3, maximum: 3600 },
    },
  },
  booking: {
    type: 'object', required: ['lockId', 'passengers'], additionalProperties: false,
    properties: {
      lockId: id,
      passengers: {
        type: 'array', minItems: 1, maxItems: 4,
        items: {
          type: 'object', required: ['seatId', 'name', 'age'], additionalProperties: false,
          properties: {
            seatId, name: { type: 'string', minLength: 2, maxLength: 80 }, age: { type: 'integer', minimum: 0, maximum: 120 },
            nik: { type: 'string', maxLength: 16 }, phone: { type: 'string', maxLength: 20 },
          },
        },
      },
    },
  },
  payment: {
    type: 'object', required: ['bookingId'], additionalProperties: false,
    properties: { bookingId: id, method: { type: 'string', enum: ['QRIS', 'VA_BCA', 'VA_MANDIRI', 'CARD_TOKEN'] } },
  },
  checkin: {
    type: 'object', required: ['ticketCode'], additionalProperties: false,
    properties: { ticketCode: { type: 'string', minLength: 8, maxLength: 80 } },
  },
  graphql: {
    type: 'object', required: ['query'], additionalProperties: false,
    properties: { query: { type: 'string', maxLength: 8000 }, variables: { type: ['object', 'null'] }, operationName: { type: ['string', 'null'], maxLength: 100 } },
  },
  apiKey: {
    type: 'object', required: ['name'], additionalProperties: false,
    properties: { name: { type: 'string', maxLength: 60 }, scopes: { type: 'array', items: { type: 'string' } }, ratePerMin: { type: 'integer' }, expiresInDays: { type: 'integer' } },
  },
};

const compiled = Object.fromEntries(Object.entries(schemas).map(([k, s]) => [k, ajv.compile(s)]));

/** Mengembalikan null bila valid, atau daftar kesalahan yang bisa dibaca manusia. */
function check(name, body) {
  const fn = compiled[name];
  if (fn(body)) return null;
  return fn.errors.map((e) => ({ path: e.instancePath || '/', message: e.message }));
}

module.exports = { check, schemas };
