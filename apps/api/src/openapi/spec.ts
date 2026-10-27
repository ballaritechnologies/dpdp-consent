const SHARED_SCHEMAS = {
  ConsentRecord: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      visitorId: { type: 'string' },
      profileId: { type: 'string' },
      profileVersion: { type: 'integer', description: 'Profile version in force when this consent was last given; with `profileId` it pins the exact on-disk snapshot (the banner text shown). Absent on records created before it was tracked.' },
      locale: { type: 'string' },
      consentJson: { type: 'object', additionalProperties: { type: 'string', enum: ['granted', 'denied', 'objected'] } },
      gpcDetected: { type: 'boolean' },
      source: { type: 'string', enum: ['banner', 'api', 'import'] },
      ageVerified: { type: 'boolean' },
      tcfString: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  TenantSettings: {
    type: 'object',
    properties: {
      allowedOrigins: { type: 'array', items: { type: 'string' } },
      adminAllowedOrigins: { type: 'array', items: { type: 'string' } },
      setupCompleted: { type: 'boolean' },
      profilesSeeded: { type: 'boolean' },
      regime: { type: 'string', enum: ['dpdp', 'dpdp_gdpr', 'strictest_global'], description: 'Per-site consent regime applied by geo routing. Absent → plain jurisdiction-map routing.' },
      regimeDefaultGroup: { type: 'string', description: '`dpdp_gdpr` only: compliance group for visitors outside India and the EU/EEA/UK, and for unknown locations. Absent → `opt-in`.' },
    },
  },
  CreateConsentInput: {
    type: 'object',
    required: ['visitorId', 'profileId', 'consentJson'],
    properties: {
      visitorId: { type: 'string' },
      profileId: { type: 'string' },
      consentJson: { type: 'object', additionalProperties: { type: 'string' } },
      gpcDetected: { type: 'boolean', default: false },
      source: { type: 'string', enum: ['banner', 'api', 'import'], default: 'banner' },
      ageVerified: { type: 'boolean' },
      parentalConsentToken: { type: 'string' },
      tcfString: { type: 'string' },
    },
  },
}

export const OPENAPI_PUBLIC_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Consenti Public API',
    version: '0.1.0',
    description: 'Visitor-facing endpoints for reading consent profiles and submitting/verifying consent. Rate-limited; no authentication required.',
    license: { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  },
  servers: [
    { url: '/consenti/api', description: 'Consenti Public API' },
  ],
  paths: {
    '/v1/profiles/{id}': {
      get: {
        tags: ['Profile'],
        summary: 'Get profile in its default locale',
        description: 'Returns the resolved profile with banner and modal content for the profile\'s default locale. Includes `currentLocale`, `locales`, `cookies`, `mainBanner`, `preferenceModal`, and optionally `gpcBanner`.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Resolved profile for the default locale' },
          '404': { description: 'Profile not found' },
        },
      },
    },
    '/v1/profiles/{id}/{locale}': {
      get: {
        tags: ['Profile'],
        summary: 'Get profile resolved for a specific locale',
        description: 'Same response shape as `GET /v1/profiles/{id}` but resolved for the requested locale, falling back to the default locale for any missing translations.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'locale', in: 'path', required: true, schema: { type: 'string', example: 'fr' } },
        ],
        responses: {
          '200': { description: 'Resolved profile for the requested locale' },
          '404': { description: 'Profile not found' },
        },
      },
    },
    '/v1/resolve-profile': {
      get: {
        tags: ['Profile'],
        summary: 'Resolve the profile for this visitor (geo routing)',
        description: 'Used by widgets with `compliance.type: \'auto\'`. Resolves the visitor\'s country from the configured `geoDataProvider`, maps it to a compliance group via the jurisdiction map, then applies the site\'s consent regime if one is set (`dpdp` → every visitor gets `opt-in-dpdpa`; `dpdp_gdpr` → India gets `opt-in-dpdpa`, EU/EEA/UK get `opt-in`, everyone else and unknown locations get the configured default group). Returns where to fetch the active profile for that group. Only available when the server runs with `compliance.type: \'auto\'`.',
        parameters: [
          { name: 'data', in: 'query', schema: { type: 'string' }, description: 'Base64-encoded JSON geo hints from the widget: `{ timezone, language, languages, locale }`.' },
          { name: 'tenant', in: 'query', schema: { type: 'string' }, description: 'Site/tenant id. Honoured only when `multiTenant.enabled`; otherwise the default tenant is always used. Must be 1–64 letters, digits, `-` or `_`.' },
          { name: 'tz', in: 'query', schema: { type: 'string' }, description: 'Legacy: IANA timezone hint.' },
          { name: 'lang', in: 'query', schema: { type: 'string' }, description: 'Legacy: language hint.' },
          { name: 'locale', in: 'query', schema: { type: 'string' }, description: 'Legacy: requested locale.' },
        ],
        responses: {
          '200': {
            description: 'Resolution result. `found: false` with `path: null` means no active profile exists for the resolved group.',
            content: { 'application/json': { schema: { type: 'object', properties: {
              path: { type: ['string', 'null'] },
              complianceGroup: { type: 'string' },
              locale: { type: 'string' },
              found: { type: 'boolean' },
              requiresSensitiveOptIn: { type: 'boolean' },
            } } } },
          },
          '400': { description: 'Invalid tenant id' },
          '501': { description: 'Geo routing not configured, or the site\'s regime is not implemented yet (`strictest_global`)' },
        },
      },
    },
    '/v1/consent': {
      post: {
        tags: ['Consent'],
        summary: 'Submit consent',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateConsentInput' },
            },
          },
        },
        responses: {
          '200': { description: 'Consent created or updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConsentRecord' } } } },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/v1/consent/{visitorId}': {
      get: {
        tags: ['Consent'],
        summary: 'Get consent for visitor',
        parameters: [{ name: 'visitorId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Consent record', content: { 'application/json': { schema: { $ref: '#/components/schemas/ConsentRecord' } } } },
          '404': { description: 'Not found' },
        },
      },
      put: {
        tags: ['Consent'],
        summary: 'Update consent',
        parameters: [{ name: 'visitorId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated consent' } },
      },
      delete: {
        tags: ['Consent'],
        summary: 'GDPR erasure — delete all consent data for visitor',
        parameters: [{ name: 'visitorId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Erased successfully' } },
      },
    },
    '/v1/consent/{visitorId}/verify': {
      get: {
        tags: ['Consent'],
        summary: 'Verify consent validity',
        parameters: [{ name: 'visitorId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Verification result' } },
      },
    },
    '/v1/consent/{visitorId}/erasure-request': {
      post: {
        tags: ['Consent'],
        summary: 'Open a deletion request for this visitor',
        description: 'Adds a request to the dashboard\'s deletion-request inbox (channel `widget`), due after the site\'s response period (30 days by default). Unlike `DELETE /v1/consent/{visitorId}`, nothing is erased straight away. Needs the visitor\'s ownership cookie.',
        parameters: [{ name: 'visitorId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
          contact: { type: 'string', maxLength: 254, description: 'How to reach the requester, e.g. an email' },
          message: { type: 'string', maxLength: 2000 },
        } } } } },
        responses: {
          '201': { description: 'Request opened', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, dueAt: { type: 'string', format: 'date-time' } } } } } },
          '400': { description: 'Validation error' },
          '403': { description: 'Visitor ownership check failed' },
        },
      },
    },
    '/v1/consent/{visitorId}/parental-consent-request': {
      post: {
        tags: ['Consent'],
        summary: 'Request a parental-consent token (stateless hook)',
        description: 'Issues a token — signed with `compliance.dataSigningHash` when configured, otherwise unsigned — for a host\'s own out-of-band parental-verification flow. Emits `consent.parentalConsentRequired`. Not by itself sufficient verifiable parental consent (COPPA-style VPC is left to the host).',
        parameters: [{ name: 'visitorId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['profileId'], properties: { profileId: { type: 'string' }, locale: { type: 'string' } } } } },
        },
        responses: {
          '200': { description: 'Token issued. The request is also recorded (and started with the configured `parentalConsentProvider`, if any): `requestId`, `status`, and the provider\'s `redirectUrl` / `message` when it gives them.', content: { 'application/json': { schema: { type: 'object', properties: {
            token: { type: 'string' }, requestId: { type: 'string' }, status: { type: 'string', enum: ['pending', 'verified', 'failed'] }, redirectUrl: { type: 'string' }, message: { type: 'string' },
          } } } } },
          '502': { description: 'The parental-consent provider failed' },
          '400': { description: 'Validation error' },
          '403': { description: 'Visitor ownership check failed' },
          '404': { description: 'Profile not found' },
        },
      },
    },
    '/v1/consent/{visitorId}/parental-consent': {
      get: {
        tags: ['Consent'],
        summary: 'Parental-consent status for this visitor',
        description: 'The latest parental-consent request for a visitor who answered the age gate as under age, refreshed from the provider while pending. `none` when there is no request. Needs the visitor\'s ownership cookie.',
        parameters: [{ name: 'visitorId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Status', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['none', 'pending', 'verified', 'failed'] }, requestId: { type: 'string' }, redirectUrl: { type: 'string' } } } } } },
          '403': { description: 'Visitor ownership check failed' },
        },
      },
    },
    '/v1/consent/parental-consent-resolve': {
      post: {
        tags: ['Consent'],
        summary: 'Resolve a parental-consent token',
        description: 'Recovers `visitorId`/`profileId` from a token issued by the request route above and emits `consent.parentalConsentGranted` — the host\'s own backend listener decides what "granted" means for stored consent. No visitor-ownership cookie required, since this is typically called from the parent\'s own device. Token replay is not prevented (stateless by design).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } } } },
        },
        responses: {
          '200': { description: 'Token resolved', content: { 'application/json': { schema: { type: 'object', properties: { visitorId: { type: 'string' }, profileId: { type: 'string' } } } } } },
          '400': { description: 'Validation error' },
          '403': { description: 'Invalid, tampered, or expired token' },
        },
      },
    },
    '/v1/notice-shown': {
      post: {
        tags: ['Consent'],
        summary: 'Record proof that the consent banner was shown',
        description: 'Lightweight, fire-and-forget ping recording that the banner was rendered to a visitor, independent of whether they ever interact with it. Called automatically by `@consenti/ui` on banner mount when `api.enabled` is configured.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['visitorId', 'profileId', 'locale'],
                properties: {
                  visitorId: { type: 'string' },
                  profileId: { type: 'string' },
                  locale: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Recorded' },
          '400': { description: 'Validation error' },
        },
      },
    },
  },
  components: {
    schemas: SHARED_SCHEMAS,
  },
}

export const OPENAPI_ADMIN_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Consenti Admin API',
    version: '0.1.0',
    description: 'Authenticated endpoints for managing profiles, consent records, users, analytics, and exports. All routes (except `/auth/login`) require `Authorization: Bearer <JWT>`. Obtain a token via `POST /auth/login`.',
    license: { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  },
  servers: [
    { url: '/consenti/admin/v1', description: 'Consenti Admin API' },
  ],
  paths: {
    // ── Auth ──────────────────────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email + password',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } } } } } },
        responses: { '200': { description: 'JWT token' } },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current user',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Current admin user info' } },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Invalidate session',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Logged out' } },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Reissue a fresh token from the current one, extending the session',
        description: 'Used by the dashboard on user activity to implement a sliding inactivity timeout instead of a flat expiry from login.',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'New JWT token' },
          '401': { description: 'Current token is missing, invalid, or already expired' },
        },
      },
    },
    '/auth/oidc/authorize': {
      get: {
        tags: ['Auth'],
        summary: 'Start OIDC authorization (PKCE)',
        responses: { '302': { description: 'Redirect to OIDC provider' } },
      },
    },
    '/auth/oidc/callback': {
      get: {
        tags: ['Auth'],
        summary: 'OIDC callback — exchange code for token',
        responses: { '200': { description: 'JWT token' } },
      },
    },
    '/auth/saml/metadata': {
      get: {
        tags: ['Auth'],
        summary: 'SAML SP metadata XML',
        responses: { '200': { description: 'SAML metadata XML', content: { 'application/xml': {} } } },
      },
    },
    '/auth/saml/acs': {
      post: {
        tags: ['Auth'],
        summary: 'SAML Assertion Consumer Service',
        responses: { '200': { description: 'JWT token' } },
      },
    },
    '/auth/totp/setup': {
      post: {
        tags: ['Auth'],
        summary: 'Setup TOTP MFA',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'TOTP secret and QR URL' } },
      },
    },
    '/auth/totp/verify': {
      post: {
        tags: ['Auth'],
        summary: 'Verify and enable TOTP',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'TOTP enabled' } },
      },
    },
    // ── Profiles ──────────────────────────────────────────────────────────
    '/profiles': {
      get: {
        tags: ['Profiles'],
        summary: 'List profiles',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Array of profiles' } },
      },
      post: {
        tags: ['Profiles'],
        summary: 'Create profile',
        security: [{ BearerAuth: [] }],
        responses: { '201': { description: 'Created profile' } },
      },
    },
    // ── Consent Templates ─────────────────────────────────────────────────
    '/consent-templates': {
      get: {
        tags: ['Consent Templates'],
        summary: 'List consent templates',
        description: 'A Consent Template groups parameters (`cookies`, keyed by id) with the categories that own their legal basis (`categories`, keyed by id).',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Array of consent templates' } },
      },
      post: {
        tags: ['Consent Templates'],
        summary: 'Create consent template',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'cookies', 'categories'],
                properties: {
                  name: { type: 'string' },
                  cookies: { type: 'object', description: 'Keyed by parameter id.' },
                  categories: { type: 'object', description: 'Keyed by category id. Every parameter id must appear in exactly one category.' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created consent template' }, '400': { description: 'Validation error' } },
      },
    },
    '/consent-templates/{id}': {
      get: {
        tags: ['Consent Templates'],
        summary: 'Get consent template',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Consent template' }, '404': { description: 'Not found' } },
      },
      put: {
        tags: ['Consent Templates'],
        summary: 'Update consent template',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated consent template' }, '422': { description: 'Change would break compliance for profiles using this template' } },
      },
      delete: {
        tags: ['Consent Templates'],
        summary: 'Delete consent template',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '422': { description: 'Template is still used by profiles' } },
      },
    },
    '/consent-templates/{id}/copy': {
      post: {
        tags: ['Consent Templates'],
        summary: 'Duplicate a consent template',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Copied consent template' } },
      },
    },
    '/consent-templates/{id}/profile-usage': {
      get: {
        tags: ['Consent Templates'],
        summary: 'List profiles using this consent template',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Array of profile summaries' } },
      },
    },
    // ── Consents ──────────────────────────────────────────────────────────
    '/consents': {
      get: {
        tags: ['Consents'],
        summary: 'List consent records',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'profileId', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Free-text search across visitorId, profileId, locale, source' },
        ],
        responses: { '200': { description: 'Paginated consent records' } },
      },
    },
    // ── Stats ─────────────────────────────────────────────────────────────
    '/stats/overview': {
      get: {
        tags: ['Stats'],
        summary: 'Overview statistics',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Totals and acceptance rates' } },
      },
    },
    '/stats/timeline': {
      get: {
        tags: ['Stats'],
        summary: 'Daily consent timeline',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 30 } }],
        responses: { '200': { description: 'Array of date+count' } },
      },
    },
    '/stats/countries': {
      get: {
        tags: ['Stats'],
        summary: 'Consent by country',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Country counts' } },
      },
    },
    '/stats/gpc': {
      get: {
        tags: ['Stats'],
        summary: 'GPC detection stats',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'GPC rate and counts' } },
      },
    },
    // ── Export ────────────────────────────────────────────────────────────
    '/export/consents': {
      get: {
        tags: ['Export'],
        summary: 'Export consent records',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'] } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { '200': { description: 'CSV or JSON download' } },
      },
    },
    // ── Records (receipts, notice versions, deletion requests, retention) ──
    '/receipts': {
      get: {
        tags: ['Records'],
        summary: 'List consent receipts',
        description: 'One signed receipt per consent decision (given, updated, withdrawn, expired, erased), newest first. `verified` is false when a receipt no longer matches its signature. Needs `consent:view`.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
          { name: 'visitorId', in: 'query', schema: { type: 'string' }, description: 'Full visitor ID; matched through its hash' },
          { name: 'action', in: 'query', schema: { type: 'string', enum: ['given', 'updated', 'withdrawn', 'expired', 'erased'] } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }],
        responses: { '200': { description: '{ items: (ServerConsentReceipt & { verified })[], total, page, limit }' }, '400': { description: 'Invalid filter' }, '403': { description: 'Missing permission, or tenant not allowed' } },
      },
    },
    '/notice-versions': {
      get: {
        tags: ['Records'],
        summary: 'List notice versions',
        description: 'One entry per saved profile version: profile version, DPDP notice version and review status, and a SHA-256 of the profile JSON. Needs `consent:view`.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } }, { name: 'profileId', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: '{ items: NoticeVersion[], total, page, limit }' } },
      },
    },
    '/erasure-requests': {
      get: {
        tags: ['Records'],
        summary: 'List deletion requests',
        description: 'With `overdue=1`, only open requests past their due date. The response also carries `open` and `overdue` counts. Needs `consent:view`.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['received', 'verifying', 'in_progress', 'completed', 'rejected'] } },
          { name: 'overdue', in: 'query', schema: { type: 'string', enum: ['1'] } }],
        responses: { '200': { description: '{ items: ErasureRequest[], total, page, limit, open, overdue, now }' } },
      },
      post: {
        tags: ['Records'],
        summary: 'Log a deletion request',
        description: 'For requests that came in by email or another channel. Needs `settings:update`. A contact, a visitor ID, or both.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
          channel: { type: 'string', enum: ['widget', 'email', 'dashboard', 'api', 'other'], default: 'dashboard' },
          contact: { type: 'string', maxLength: 254 }, visitorId: { type: 'string' }, message: { type: 'string', maxLength: 2000 },
        } } } } },
        responses: { '201': { description: 'ErasureRequest' }, '400': { description: 'Validation error' } },
      },
    },
    '/erasure-requests/{id}': {
      get: {
        tags: ['Records'], summary: 'Get a deletion request', security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }],
        responses: { '200': { description: 'ErasureRequest' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['Records'],
        summary: 'Change a deletion request\'s status',
        description: 'received → verifying → in_progress → completed / rejected (steps can be skipped; closed requests cannot change). Rejecting needs a `note`. With `status: completed` and `eraseConsent: true`, the visitor\'s consent record is erased too. Every change is added to the request\'s history and the audit log. Needs `settings:update`.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: {
          status: { type: 'string', enum: ['verifying', 'in_progress', 'completed', 'rejected'] }, note: { type: 'string', maxLength: 2000 }, eraseConsent: { type: 'boolean' },
        } } } } },
        responses: { '200': { description: 'Updated ErasureRequest' }, '400': { description: 'Validation error' }, '404': { description: 'Not found' }, '409': { description: 'Transition not allowed' } },
      },
    },
    '/retention/policy': {
      get: { tags: ['Records'], summary: 'Get the retention policy', security: [{ BearerAuth: [] }], parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }], responses: { '200': { description: 'RetentionPolicy (empty object = keep everything)' } } },
      put: {
        tags: ['Records'],
        summary: 'Replace the retention policy',
        description: 'All fields optional, whole days from 1 to 36500. `purposeExpiryDays` maps purpose (category) IDs to days. Needs `settings:update`.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
          purposeExpiryDays: { type: 'object', additionalProperties: { type: 'integer' } },
          receiptDays: { type: 'integer' }, closedErasureRequestDays: { type: 'integer' }, erasureResponseDays: { type: 'integer' },
        } } } } },
        responses: { '200': { description: 'Saved RetentionPolicy' }, '400': { description: 'Validation error' } },
      },
    },
    '/retention/run': {
      post: {
        tags: ['Records'],
        summary: 'Run retention now',
        description: 'A dry run unless the body has `dryRun: false`. The same job runs daily for every site. Needs `settings:update`.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { dryRun: { type: 'boolean', default: true } } } } } },
        responses: { '200': { description: 'RetentionRunResult' } },
      },
    },
    '/parental-consents': {
      get: {
        tags: ['Records'],
        summary: 'List parental-consent requests',
        description: 'Requests opened when a visitor answers the age gate as under age, with their outcome (from the provider, the signed token, or the dashboard). `provider` names the configured provider. Needs `consent:view`.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'verified', 'failed'] } }, { name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: { '200': { description: '{ items: ParentalConsentRequest[], total, page, limit, provider }' } },
      },
    },
    '/parental-consents/{id}': {
      patch: {
        tags: ['Records'],
        summary: 'Record a parental-consent outcome verified outside Ijazat',
        description: 'Only for a pending request. Needs `settings:update`.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['verified', 'failed'] }, note: { type: 'string', maxLength: 2000 } } } } } },
        responses: { '200': { description: 'Updated request' }, '400': { description: 'Validation error' }, '404': { description: 'Not found' }, '409': { description: 'Already decided' } },
      },
    },
    '/export/receipts': {
      get: { tags: ['Export'], summary: 'Export consent receipts', description: 'Same filters as GET /receipts. Needs `export:run`.', security: [{ BearerAuth: [] }],
        parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'], default: 'csv' } }, { name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }, { name: 'visitorId', in: 'query', schema: { type: 'string' } }, { name: 'action', in: 'query', schema: { type: 'string' } }, { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }],
        responses: { '200': { description: 'CSV or JSON download' } } },
    },
    '/export/erasure-requests': {
      get: { tags: ['Export'], summary: 'Export deletion requests', description: 'Includes contact details. Needs `export:run`.', security: [{ BearerAuth: [] }],
        parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'], default: 'csv' } }, { name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }, { name: 'status', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'CSV or JSON download' } } },
    },
    '/export/notice-versions': {
      get: { tags: ['Export'], summary: 'Export notice versions', security: [{ BearerAuth: [] }],
        parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'], default: 'csv' } }, { name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }, { name: 'profileId', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'CSV or JSON download' } } },
    },
    // ── Breach incidents ──────────────────────────────────────────────────
    '/incidents': {
      get: {
        tags: ['Incidents'], summary: 'List breach incidents',
        description: 'Each incident\'s `dueAt` is the Board report deadline: 72 hours after `discoveredAt`. Needs `audit:view`.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'contained', 'reported', 'closed'] } }, { name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: { '200': { description: '{ items: BreachIncident[], total, page, limit, now }' } },
      },
      post: {
        tags: ['Incidents'], summary: 'Log a breach incident',
        description: '`title`, `description`, `discoveredAt` and `severity` are required. Needs `settings:update`.',
        security: [{ BearerAuth: [] }], parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
          title: { type: 'string', maxLength: 200 }, description: { type: 'string', maxLength: 10000 },
          discoveredAt: { type: 'string', format: 'date-time' }, occurredAt: { type: ['string', 'null'], format: 'date-time' }, containedAt: { type: ['string', 'null'], format: 'date-time' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, cause: { type: 'string' },
          dataCategories: { type: 'array', items: { type: 'string' } }, affectedCount: { type: ['integer', 'null'] }, affectedRegions: { type: 'array', items: { type: 'string' } },
          systems: { type: 'string' }, likelyImpact: { type: 'string' }, containment: { type: 'string' }, userSteps: { type: 'string' },
          organisation: { type: 'string' }, contactName: { type: 'string' }, contactEmail: { type: 'string' },
        } } } } },
        responses: { '201': { description: 'BreachIncident' }, '400': { description: 'Validation error' } },
      },
    },
    '/incidents/{id}': {
      get: { tags: ['Incidents'], summary: 'Get a breach incident', security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }], responses: { '200': { description: 'BreachIncident' }, '404': { description: 'Not found' } } },
      patch: {
        tags: ['Incidents'], summary: 'Update a breach incident',
        description: 'Any of the fields, plus `status` (open, contained, reported, closed). Changing `discoveredAt` moves the deadline and resets reminders. Needs `settings:update`.',
        security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
          title: { type: 'string', maxLength: 200 }, description: { type: 'string', maxLength: 10000 },
          discoveredAt: { type: 'string', format: 'date-time' }, occurredAt: { type: ['string', 'null'], format: 'date-time' }, containedAt: { type: ['string', 'null'], format: 'date-time' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, cause: { type: 'string' },
          dataCategories: { type: 'array', items: { type: 'string' } }, affectedCount: { type: ['integer', 'null'] }, affectedRegions: { type: 'array', items: { type: 'string' } },
          systems: { type: 'string' }, likelyImpact: { type: 'string' }, containment: { type: 'string' }, userSteps: { type: 'string' },
          organisation: { type: 'string' }, contactName: { type: 'string' }, contactEmail: { type: 'string' },
        } } } } },
        responses: { '200': { description: 'BreachIncident' }, '400': { description: 'Validation error' }, '404': { description: 'Not found' } },
      },
    },
    '/incidents/{id}/milestones': {
      post: {
        tags: ['Incidents'], summary: 'Record that a notice was sent',
        description: 'Recording `boardReportSentAt` stops the deadline reminders. Needs `settings:update`.',
        security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['milestone'], properties: { milestone: { type: 'string', enum: ['boardIntimatedAt', 'boardReportSentAt', 'usersNotifiedAt'] }, at: { type: 'string', format: 'date-time' } } } } } },
        responses: { '200': { description: 'BreachIncident' } },
      },
    },
    '/incidents/{id}/notices': {
      post: {
        tags: ['Incidents'], summary: 'Draft a notice from the templates',
        description: 'Fills the editable template (`board-intimation`, `board-report`, `user-notice`) for the locale, falling back to English. The text always starts with DRAFT - REQUIRES LEGAL REVIEW. Ijazat sends nothing. Needs `audit:view`.',
        security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['board-intimation', 'board-report', 'user-notice'] }, locale: { type: 'string', default: 'en' } } } } } },
        responses: { '200': { description: '{ kind, locale, template, text }' } },
      },
    },
    '/export/incidents': {
      get: { tags: ['Export'], summary: 'Export breach incidents', description: 'Needs `export:run`.', security: [{ BearerAuth: [] }],
        parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'], default: 'csv' } }, { name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }, { name: 'status', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'CSV or JSON download' } } },
    },
    // ── Settings ──────────────────────────────────────────────────────────
    '/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get site settings (origin allowlists, consent regime)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' }, description: 'Site/tenant to read. Must be in the caller\'s allowed tenants.' }],
        responses: {
          '200': { description: 'TenantSettings', content: { 'application/json': { schema: { $ref: '#/components/schemas/TenantSettings' } } } },
          '403': { description: 'Missing `settings:update`, or tenant not allowed' },
          '404': { description: 'Tenant not found' },
        },
      },
      patch: {
        tags: ['Settings'],
        summary: 'Update site settings',
        description: 'Partial update — only the fields sent change. Send `regime: null` to clear the regime (back to plain jurisdiction-map routing). Every regime change is recorded in the audit log as `settings:regime_updated`.',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', default: 'default' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
          allowedOrigins: { type: 'array', items: { type: 'string' } },
          adminAllowedOrigins: { type: 'array', items: { type: 'string' } },
          regime: { type: ['string', 'null'], enum: ['dpdp', 'dpdp_gdpr', 'strictest_global', null] },
          regimeDefaultGroup: { type: ['string', 'null'], enum: ['opt-in', 'opt-out', 'opt-out-strict', 'opt-in-dpdpa', 'opt-in-china', 'opt-in-brazil', 'general-privacy-consent', 'notice-only', null] },
        } } } } },
        responses: {
          '200': { description: 'Updated TenantSettings', content: { 'application/json': { schema: { $ref: '#/components/schemas/TenantSettings' } } } },
          '400': { description: 'Validation error' },
          '403': { description: 'Missing `settings:update`, or tenant not allowed' },
          '404': { description: 'Tenant not found' },
          '501': { description: '`strictest_global` is not implemented yet' },
        },
      },
    },
    // ── Tenants ───────────────────────────────────────────────────────────
    '/tenants': {
      get: {
        tags: ['Sites'],
        summary: 'List all sites/tenants',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Array of tenants' } },
      },
      post: {
        tags: ['Sites'],
        summary: 'Create a site/tenant',
        security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, slug: { type: 'string' } }, required: ['name', 'slug'] } } } },
        responses: { '201': { description: 'Created tenant' } },
      },
    },
    '/tenants/{id}': {
      put: {
        tags: ['Sites'],
        summary: 'Update a site/tenant',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated tenant' } },
      },
      delete: {
        tags: ['Sites'],
        summary: 'Delete a site/tenant',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    // ── Setup Wizard ──────────────────────────────────────────────────────
    // One-time first-run flow, gated by tenant_settings.setup_completed — see
    // plans/PENDING-api-setup-wizard.md. Never reset from the dashboard once complete.
    '/setup/status': {
      get: {
        tags: ['Setup'],
        summary: 'Whether the first-run setup wizard has been completed for this tenant',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: '{ completed: boolean }' } },
      },
    },
    '/setup/config': {
      get: {
        tags: ['Setup'],
        summary: 'Resolved server config (secrets redacted) plus production-readiness flags',
        description: 'The same merged `DEFAULT_CONFIG` + user config `createConsenti` computes at boot. `auth.adminPassword`, `auth.masterSecret`, `compliance.dataSigningHash`, `compliance.dataSigningHash`, storage credentials, and OIDC/SAML secrets are replaced with a redaction marker.',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: '{ config: object, usingJsonStorage: boolean, usingDefaultCredentials: boolean }' } },
      },
    },
    '/setup/compliance-groups': {
      get: {
        tags: ['Setup'],
        summary: 'The 8 built-in compliance groups with label/description/regulation metadata',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Array of compliance group descriptors' } },
      },
    },
    '/setup/seed-profiles': {
      post: {
        tags: ['Setup'],
        summary: 'Seed default profiles for the selected compliance groups',
        description: 'Idempotent — skips any group that already has an active profile. `groups` must be a subset of the 8 built-in compliance group ids.',
        security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { groups: { type: 'array', items: { type: 'string' } } }, required: ['groups'] } } } },
        responses: {
          '200': { description: '{ seeded: string[] }' },
          '400': { description: 'groups is missing, not an array of strings, or contains an unknown compliance group id' },
          '409': { description: 'Setup has already been completed for this tenant' },
        },
      },
    },
    '/setup/complete': {
      post: {
        tags: ['Setup'],
        summary: 'Mark the first-run setup wizard as complete for this tenant',
        description: 'Called on both wizard finish and skip. Never reset from the dashboard once true.',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Updated tenant settings' },
          '409': { description: 'Setup has already been completed for this tenant' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: SHARED_SCHEMAS,
  },
}
