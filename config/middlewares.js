module.exports = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
      name: 'strapi::cors',
      config: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        headers: '*',
        keepHeaderOnError: true,
      },
    },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
