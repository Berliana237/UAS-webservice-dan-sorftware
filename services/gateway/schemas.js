'use strict';
/** Skema request yang divalidasi di gateway sebelum diteruskan ke service. Kerusakan bentuk ditolak di pintu depan. */
const Ajv = require('ajv').default;

const ajv = new Ajv({ allErrors: true, removeAdditional: false, strict: false });
const id = { type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9_.:-]+$' };
const str = (max) => ({ type: 'string', maxLength: max });
const nullable = (max) => ({ type: ['string', 'null'], maxLength: max });
const role = { type: 'string', enum: ['customer', 'masinis', 'admin'] };
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
      // Tidak ada batas jumlah kursi per pesanan. 648 hanya batas teknis: kapasitas rangkaian terbesar (9 gerbong x 72 kursi).
      seats: { type: 'array', minItems: 1, maxItems: 648, uniqueItems: true, items: seatId },
      ttlSeconds: { type: 'integer', minimum: 3, maximum: 3600 },
    },
  },
  booking: {
    type: 'object', required: ['lockId', 'passengers'], additionalProperties: false,
    properties: {
      lockId: id,
      passengers: {
        type: 'array', minItems: 1, maxItems: 648,
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
    properties: { bookingId: id, method: { type: 'string', enum: ['QRIS', 'VA_BCA', 'VA_MANDIRI'] } },
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
  profile: {
    type: 'object', additionalProperties: false,
    properties: { name: str(80), phone: nullable(20), nik: nullable(16), birthDate: nullable(10) },
  },
  changePassword: {
    type: 'object', required: ['currentPassword', 'newPassword'], additionalProperties: false,
    properties: { currentPassword: str(128), newPassword: str(128) },
  },
  adminUserCreate: {
    type: 'object', required: ['name', 'email', 'password', 'role'], additionalProperties: false,
    properties: { name: str(80), email: str(120), password: str(128), role: role, phone: nullable(20), nik: nullable(16), birthDate: nullable(10) },
  },
  adminUserUpdate: {
    type: 'object', additionalProperties: false, minProperties: 1,
    properties: { name: str(80), email: str(120), role: role, phone: nullable(20), nik: nullable(16), birthDate: nullable(10), active: { type: 'boolean' } },
  },
  role: { type: 'object', required: ['role'], additionalProperties: false, properties: { role } },
  adminPassword: { type: 'object', required: ['password'], additionalProperties: false, properties: { password: str(128) } },
  settings: {
    type: 'object', required: ['seniorDiscountPercent'], additionalProperties: false,
    properties: { seniorDiscountPercent: { type: 'integer', minimum: 0, maximum: 100 } },
  },
  tripStats: {
    type: 'object', required: ['tripIds'], additionalProperties: false,
    properties: { tripIds: { type: 'array', maxItems: 200, items: id } },
  },
  transferDecision: {
    type: 'object', required: ['decision'], additionalProperties: false,
    properties: { decision: { type: 'string', enum: ['ACCEPT', 'REJECT'] }, reason: str(300) },
  },
  proof: {
    type: 'object', required: ['dataBase64'], additionalProperties: false,
    properties: { fileName: str(120), dataBase64: { type: 'string', minLength: 1, maxLength: 4500000 }, note: str(300) },
  },
  supportChat: {
    type: 'object', required: ['messages'], additionalProperties: false,
    properties: {
      messages: {
        type: 'array', minItems: 1, maxItems: 20,
        items: { type: 'object', required: ['role', 'content'], additionalProperties: false, properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string', minLength: 1, maxLength: 1000 } } },
      },
    },
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
