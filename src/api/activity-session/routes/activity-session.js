
const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::activity-session.activity-session', {
  config: {
    create: {
      policies: ['global::bind-user-therapist'],
    },
    update: {
      policies: ['global::bind-user-therapist'],
    },
  },
});